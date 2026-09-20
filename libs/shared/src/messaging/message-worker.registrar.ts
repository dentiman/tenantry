import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { TenantContextService } from '@saas-skeleton/database';
import type { Job, WorkOptions } from 'pg-boss';
import { MessageContextService } from './message-context.service';
import { messageEnvelopeSchema, SYSTEM_ACTOR, type MessageEnvelope } from './message-envelope';
import {
  MessageSubscriber,
  type MessageSubscriberContract,
  type SubscriberMetadata,
} from './message-subscriber.decorator';
import { NonRetryableMessageError } from './messaging.errors';
import { PgBossService } from './pg-boss.service';
import {
  DEAD_LETTER_QUEUE,
  MESSAGE_TOPOLOGY,
  queueNameFor,
  type ConsumerSpec,
  type TopologyEntry,
} from './topology';

interface RegisteredConsumer {
  readonly queue: string;
  readonly entry: TopologyEntry;
  readonly spec: ConsumerSpec;
  readonly handler: MessageSubscriberContract;
}

/**
 * Опції воркера з маніфесту. Будуються УМОВНО: pg-boss валідує кожен переданий
 * ключ, тому `undefined` у нього передавати не можна (`CLAUDE.md` §9). Споживач,
 * який нічого не оголосив, отримує порожній обʼєкт — тобто рівно ті дефолти
 * pg-boss, які діяли до появи цих полів.
 */
function workOptionsFor(spec: ConsumerSpec): WorkOptions {
  const options: WorkOptions = {};
  if (spec.localConcurrency !== undefined) {
    options.localConcurrency = spec.localConcurrency;
  }
  if (spec.groupConcurrency !== undefined) {
    options.groupConcurrency = spec.groupConcurrency;
  }
  if (spec.pollingIntervalSeconds !== undefined) {
    options.pollingIntervalSeconds = spec.pollingIntervalSeconds;
  }
  return options;
}

/**
 * Реєструє споживачів у pg-boss і звіряє їх із маніфестом.
 *
 * Єдиний рантайм-шлях для ПОДІЙ і КОМАНД: той самий конверт, той самий CLS,
 * той самий лог-конверт, та сама класифікація помилок і та сама DLQ.
 */
@Injectable()
export class MessageWorkerRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageWorkerRegistrar.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly pgBoss: PgBossService,
    private readonly tenantContext: TenantContextService,
    private readonly messageContext: MessageContextService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const consumers = this.resolveConsumers();

    for (const consumer of consumers) {
      // `localConcurrency` піднімає КІЛЬКА незалежних воркерів на цю чергу, кожен зі
      // своїм fetch-ом — саме тому паралельність береться звідти, а не з `batchSize`:
      // батч приїхав би в ОДИН цей хендлер, і цикл нижче виконав би його послідовно.
      await this.pgBoss.boss.work(
        consumer.queue,
        workOptionsFor(consumer.spec),
        async (jobs: Job[]) => {
          for (const job of jobs) {
            await this.runJob(consumer, job);
          }
        },
      );

      if (consumer.entry.cron) {
        // Порожній payload: конверт для cron-тіку добудовується в runJob із job.id,
        // бо статичний payload розкладу дав би однаковий messageId на кожному тіку
        // і inbox пропускав би всі запуски після першого.
        await this.pgBoss.boss.schedule(consumer.queue, consumer.entry.cron, {});
      }
    }

    this.logger.log(`Registered ${String(consumers.length)} message subscriber(s)`);
  }

  /**
   * Гейт старту: маніфест і класи мусять збігатися ТОЧНО.
   * - оголошений споживач без класу → job-и тихо копичились би в черзі, яку ніхто не читає;
   * - клас без оголошення → мертвий код, у чергу ніхто не пише.
   * Обидва випадки — краш при старті, а не тиха деградація.
   */
  private resolveConsumers(): RegisteredConsumer[] {
    const found = new Map<string, MessageSubscriberContract>();
    for (const wrapper of this.discovery.getProviders({ metadataKey: MessageSubscriber.KEY })) {
      const meta: SubscriberMetadata | undefined = this.discovery.getMetadataByDecorator(
        MessageSubscriber,
        wrapper,
      );
      if (!meta) {
        continue;
      }
      const queue = queueNameFor(meta.definition.name, meta.id);
      if (found.has(queue)) {
        throw new Error(`Two subscriber classes claim the same queue: ${queue}`);
      }
      found.set(queue, wrapper.instance as MessageSubscriberContract);
    }

    const registered: RegisteredConsumer[] = [];
    const missing: string[] = [];
    for (const entry of MESSAGE_TOPOLOGY) {
      for (const consumer of entry.consumers) {
        const queue = queueNameFor(entry.definition.name, consumer.id);
        const handler = found.get(queue);
        if (handler) {
          registered.push({ queue, entry, spec: consumer, handler });
          found.delete(queue);
        } else {
          missing.push(queue);
        }
      }
    }
    const orphaned = [...found.keys()];

    if (missing.length > 0 || orphaned.length > 0) {
      const details = [
        missing.length > 0
          ? `declared in MESSAGE_TOPOLOGY without a class: ${missing.join(', ')}`
          : '',
        orphaned.length > 0
          ? `@MessageSubscriber without a manifest entry: ${orphaned.join(', ')}`
          : '',
      ].filter(Boolean);
      throw new Error(`Message topology mismatch — ${details.join('; ')}`);
    }

    return registered;
  }

  /**
   * Лог-конверт довкола споживача: pg-boss падіння хендлера НЕ логує (пише лише в
   * pgboss.job.output), тому без цього try/catch впала робота невидима в логах.
   *
   * CLS не перетинає межу процесу — обидва контексти ВІДНОВЛЮЮТЬСЯ з конверта:
   * tenant (щоб Prisma працювала під RLS як у HTTP) і ланцюг (щоб похідна публікація
   * усередині споживача успадкувала correlationId та causationId автоматично).
   */
  private async runJob(consumer: RegisteredConsumer, job: Job): Promise<void> {
    let envelope: MessageEnvelope;
    let data: unknown;
    try {
      envelope = this.normalizeEnvelope(consumer, job);
      // Валідація доменних даних схемою повідомлення. Провал = несумісна зміна схеми
      // або зіпсований payload: ретраї гарантовано марні.
      data = consumer.entry.definition.schema.parse(envelope.data);
    } catch (error) {
      await this.sendToDeadLetter(consumer.queue, job, error);
      return;
    }

    const meta = {
      jobId: job.id,
      queue: consumer.queue,
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      ...(envelope.tenantId && { tenantId: envelope.tenantId }),
    };
    const startedAt = Date.now();
    this.logger.debug(meta, `Message started: ${envelope.name} (${job.id})`);

    try {
      await this.runInContext(envelope, data, consumer.handler);
      this.logger.log(
        { ...meta, durationMs: Date.now() - startedAt },
        `Message handled: ${envelope.name} (${job.id})`,
      );
    } catch (error) {
      if (error instanceof NonRetryableMessageError) {
        this.logger.error(
          { ...meta, err: error, durationMs: Date.now() - startedAt },
          `Message rejected as non-retryable: ${envelope.name} (${job.id})`,
        );
        await this.sendToDeadLetter(consumer.queue, job, error);
        return;
      }
      this.logger.error(
        { ...meta, err: error, durationMs: Date.now() - startedAt },
        `Message failed: ${envelope.name} (${job.id})`,
      );
      // re-throw: pg-boss позначить job failed і застосує retry-політику черги
      throw error;
    }
  }

  /**
   * Опубліковані повідомлення несуть повний конверт. Cron-тіки його не мають (розклад
   * шле порожній payload), тому конверт добудовується тут: ідентичність тіку —
   * це job.id, унікальний на кожен запуск, тож inbox працює як для звичайних повідомлень.
   */
  private normalizeEnvelope(consumer: RegisteredConsumer, job: Job): MessageEnvelope {
    const raw: unknown = job.data;
    const looksPublished =
      typeof raw === 'object' && raw !== null && 'messageId' in raw;

    if (looksPublished) {
      return messageEnvelopeSchema.parse(raw);
    }
    if (!consumer.entry.cron) {
      throw new NonRetryableMessageError(
        `Job on ${consumer.queue} carries no envelope and the message has no cron schedule`,
      );
    }
    return {
      messageId: job.id,
      name: consumer.entry.definition.name,
      occurredAt: new Date().toISOString(),
      tenantId: null,
      actor: SYSTEM_ACTOR,
      correlationId: job.id,
      causationId: null,
      data: {},
    };
  }

  private async runInContext(
    envelope: MessageEnvelope,
    data: unknown,
    handler: MessageSubscriberContract,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      this.messageContext.applyEnvelope(envelope);
      await handler.handle(data, envelope);
    };

    if (envelope.tenantId) {
      await this.tenantContext.runWith(envelope.tenantId, run);
    } else {
      await this.tenantContext.runWithout(run);
    }
  }

  /**
   * Швидкий шлях у DLQ: job завершується УСПІШНО (ретраї не спалюються), а копія
   * лягає в спільну dlq разом з ім'ям вихідної черги і причиною.
   */
  private async sendToDeadLetter(queue: string, job: Job, error: unknown): Promise<void> {
    await this.pgBoss.boss.send(DEAD_LETTER_QUEUE, {
      queue,
      jobId: job.id,
      reason: error instanceof Error ? error.message : String(error),
      data: job.data,
    });
    this.logger.error(
      { queue, jobId: job.id, err: error },
      `Job moved to ${DEAD_LETTER_QUEUE}: ${job.id}`,
    );
  }
}
