import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { Queue, UpdateQueueOptions } from 'pg-boss';
import {
  DEAD_LETTER_QUEUE,
  MESSAGE_TOPOLOGY,
  queueNameFor,
  type ConsumerQueuePolicy,
  type ConsumerSpec,
} from './topology';

const DEFAULT_DATABASE_URL = 'postgresql://saas:saas@localhost:5432/saas_skeleton';

const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_SECONDS = 5;

interface DesiredQueue {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  policy: ConsumerQueuePolicy;
  deadLetter?: string;
}

/**
 * Життєвий цикл pg-boss + декларативне узгодження черг із MESSAGE_TOPOLOGY.
 * pg-boss сам мігрує власну схему `pgboss` у тій самій БД, що й Prisma.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  readonly boss: PgBoss;

  constructor() {
    this.boss = new PgBoss({
      connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    });
    this.boss.on('error', (error: Error) => {
      this.logger.error(error);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.syncQueues();
    this.logger.log('pg-boss started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  /**
   * Черги створюються ЗАЗДАЛЕГІДЬ з маніфесту, а не ліниво на першій публікації:
   * publish іде всередині доменної транзакції, і робити там DDL-суміжну роботу —
   * зайва латентність і зайвий ризик.
   *
   * Розбіжність політики з маніфестом усувається updateQueue (розрив §2.4: раніше
   * наявна черга ніколи не оновлювалась, і retryLimit у коді розходився з рантаймом).
   */
  private async syncQueues(): Promise<void> {
    // DLQ створюється ПЕРШОЮ: решта черг на неї посилаються.
    // Власного deadLetter не має — з DLQ падати вже нікуди.
    await this.ensureQueue(DEAD_LETTER_QUEUE, {
      retryLimit: 0,
      retryDelay: 0,
      retryBackoff: false,
      policy: 'standard',
    });

    for (const entry of MESSAGE_TOPOLOGY) {
      for (const consumer of entry.consumers) {
        await this.ensureQueue(
          queueNameFor(entry.definition.name, consumer.id),
          desiredQueueOf(consumer),
        );
      }
    }
  }

  private async ensureQueue(name: string, desired: DesiredQueue): Promise<void> {
    const [existing] = await this.boss.getQueues([name]);

    if (!existing) {
      await this.boss.createQueue(name, desired satisfies Omit<Queue, 'name'>);
      this.logger.debug(`Queue created: ${name}`);
      return;
    }

    // policy змінити в місці не можна (UpdateQueueOptions її не приймає) — черга
    // з іншою політикою потребує явного перестворення, тому це гучний warn, не тиша.
    if ((existing.policy ?? 'standard') !== desired.policy) {
      this.logger.warn(
        `Queue ${name} has policy "${String(existing.policy)}" but manifest declares ` +
          `"${desired.policy}" — policy cannot be altered in place; recreate the queue`,
      );
    }

    const update: UpdateQueueOptions = {
      retryLimit: desired.retryLimit,
      retryDelay: desired.retryDelay,
      retryBackoff: desired.retryBackoff,
      deadLetter: desired.deadLetter,
    };

    const drifted =
      existing.retryLimit !== update.retryLimit ||
      existing.retryDelay !== update.retryDelay ||
      existing.retryBackoff !== update.retryBackoff ||
      (existing.deadLetter ?? undefined) !== update.deadLetter;

    if (drifted) {
      await this.boss.updateQueue(name, update);
      this.logger.log(`Queue policy synced from manifest: ${name}`);
    }
  }
}

function desiredQueueOf(consumer: ConsumerSpec): DesiredQueue {
  return {
    retryLimit: consumer.retryLimit ?? DEFAULT_RETRY_LIMIT,
    retryDelay: consumer.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
    retryBackoff: consumer.retryBackoff ?? true,
    policy: consumer.policy ?? 'standard',
    deadLetter: DEAD_LETTER_QUEUE,
  };
}
