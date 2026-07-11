import { z } from 'zod';
import type { PrismaTransactionLike } from 'pg-boss';
import type { JobDefinition } from './job-definition';

export interface JobSendOptions {
  /** Дедуплікація: поки job з цим ключем у черзі — повторний send повертає null */
  singletonKey?: string;
  /** Відкласти виконання на N секунд */
  startAfterSeconds?: number;
  priority?: number;
  /**
   * Транзакційна постановка: job вставляється в тій самій Prisma-транзакції,
   * що й доменні зміни (передати tx з prisma.$transaction)
   */
  tx?: PrismaTransactionLike;
}

/**
 * Абстракція над чергою. Доменний код залежить тільки від цього класу —
 * форки можуть замінити pg-boss власною реалізацією.
 */
export abstract class JobDispatcher {
  abstract send<TSchema extends z.ZodType>(
    definition: JobDefinition<TSchema>,
    payload: z.input<TSchema>,
    options?: JobSendOptions,
  ): Promise<string | null>;
}
