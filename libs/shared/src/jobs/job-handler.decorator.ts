import { DiscoveryService } from '@nestjs/core';
import { z } from 'zod';
import type { JobDefinition } from './job-definition';

export interface JobContext {
  readonly id: string;
  readonly name: string;
}

/** Контракт класу-хендлера; payload вже провалідований схемою job-а */
export interface JobHandlerContract<TSchema extends z.ZodType = z.ZodType> {
  handle(payload: z.output<TSchema>, context: JobContext): Promise<void>;
}

/**
 * Позначає @Injectable()-клас як обробник job-а.
 * Воркер знаходить такі класи через DiscoveryService і реєструє їх у pg-boss.
 */
export const JobHandler = DiscoveryService.createDecorator<JobDefinition>();
