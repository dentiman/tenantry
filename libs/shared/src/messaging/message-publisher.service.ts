import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import { TenantContextService } from '@saas-skeleton/database';
import { fromPrisma } from 'pg-boss';
import type { SendOptions } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MessageContextService } from './message-context.service';
import type { MessageDefinition } from './message-definition';
import { SYSTEM_ACTOR, type MessageActor, type MessageEnvelope } from './message-envelope';
import { PgBossService } from './pg-boss.service';
import { queueNameFor, topologyFor } from './topology';

export interface PublishOptions {
  /**
   * Актор, якщо він не з CLS (напр. контролер передає @CurrentUser()).
   * Без нього береться актор із контексту ланцюга, а якщо й того немає — система.
   */
  actor?: MessageActor;
  /**
   * Дедуплікація/серіалізація на рівні черги. Для key_strict_fifo-черг ОБОВ'ЯЗКОВИЙ.
   * Увага: на звичайній черзі це дедуплікація ЩЕ НЕ ВЗЯТИХ job-ів, а не серіалізація.
   */
  singletonKey?: string;
  startAfterSeconds?: number;
  priority?: number;
}

@Injectable()
export class MessagePublisher {
  private readonly logger = new Logger(MessagePublisher.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly tenantContext: TenantContextService,
    private readonly messageContext: MessageContextService,
  ) {}

  /**
   * `tx` — ПЕРШИЙ обов'язковий аргумент за тим самим правилом, що й
   * ActivityRecorder.record: опублікувати повідомлення поза транзакцією доменної
   * зміни фізично неможливо. Або доменний факт і всі його job-и зафіксувалися разом,
   * або не сталося нічого.
   *
   * Fan-out відбувається ТУТ: один виклик → по одному job-у в чергу кожного споживача
   * з маніфесту, усі в цій же транзакції. Send-и послідовні і fail-fast (перша ж
   * помилка валить транзакцію) — свідомо НЕ Promise.allSettled, як у рідному
   * boss.publish, який ковтає часткову відмову fan-out-у.
   */
  async publish<TSchema extends z.ZodType>(
    tx: Prisma.TransactionClient,
    definition: MessageDefinition<TSchema>,
    data: z.input<TSchema>,
    options: PublishOptions = {},
  ): Promise<MessageEnvelope> {
    const entry = topologyFor(definition.name);
    const envelope = this.buildEnvelope(definition, data, options.actor);

    const sendOptions: SendOptions = { db: fromPrisma(tx) };
    // pg-boss валідує кожен переданий ключ — undefined передавати не можна
    if (options.singletonKey !== undefined) {
      sendOptions.singletonKey = options.singletonKey;
    }
    if (options.startAfterSeconds !== undefined) {
      sendOptions.startAfter = options.startAfterSeconds;
    }
    if (options.priority !== undefined) {
      sendOptions.priority = options.priority;
    }

    for (const consumer of entry.consumers) {
      const queue = queueNameFor(definition.name, consumer.id);
      if (consumer.policy === 'key_strict_fifo' && options.singletonKey === undefined) {
        throw new Error(`Queue ${queue} is key_strict_fifo and requires a singletonKey`);
      }
      await this.pgBoss.boss.send(queue, envelope, sendOptions);
    }

    this.logger.debug(
      {
        messageId: envelope.messageId,
        name: envelope.name,
        correlationId: envelope.correlationId,
        consumers: entry.consumers.length,
      },
      `Published ${definition.name} to ${String(entry.consumers.length)} consumer(s)`,
    );

    return envelope;
  }

  private buildEnvelope<TSchema extends z.ZodType>(
    definition: MessageDefinition<TSchema>,
    data: unknown,
    actor: MessageActor | undefined,
  ): MessageEnvelope {
    const messageId = randomUUID();
    return {
      messageId,
      name: definition.name,
      occurredAt: new Date().toISOString(),
      // fail-closed: tenant-повідомлення без контексту — помилка постановки,
      // а не job «у нікуди» (той самий принцип, що був у старому диспатчері)
      tenantId:
        definition.scope === 'tenant' ? this.tenantContext.requireTenantId() : null,
      // явно переданий актор > актор ланцюга з CLS > система
      actor: actor ?? this.messageContext.getActor() ?? SYSTEM_ACTOR,
      // корінь ланцюга: поза HTTP-контекстом кореляція починається з самого повідомлення
      correlationId: this.messageContext.getCorrelationId() ?? messageId,
      causationId: this.messageContext.getCausationId() ?? null,
      data: definition.schema.parse(data),
    };
  }
}
