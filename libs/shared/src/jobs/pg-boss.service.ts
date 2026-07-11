import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { JobDefinition } from './job-definition';

const DEFAULT_DATABASE_URL = 'postgresql://saas:saas@localhost:5432/saas_skeleton';

const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_SECONDS = 5;

/**
 * Життєвий цикл pg-boss: старт/стоп разом із Nest-застосунком.
 * pg-boss сам мігрує власну схему `pgboss` у тій самій БД, що й Prisma.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private readonly ensuredQueues = new Set<string>();
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
    this.logger.log('pg-boss started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  /** Ідемпотентно створює чергу з retry-політикою з JobDefinition */
  async ensureQueue(definition: JobDefinition): Promise<void> {
    if (this.ensuredQueues.has(definition.name)) {
      return;
    }
    const existing = await this.boss.getQueue(definition.name);
    if (!existing) {
      await this.boss.createQueue(definition.name, {
        retryLimit: definition.options.retryLimit ?? DEFAULT_RETRY_LIMIT,
        retryDelay: definition.options.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
        retryBackoff: definition.options.retryBackoff ?? true,
      });
    }
    this.ensuredQueues.add(definition.name);
  }
}
