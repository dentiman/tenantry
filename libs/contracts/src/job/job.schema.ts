import { z } from 'zod';
import { PaginationQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

/** Стани pg-boss v12 (enum pgboss.job_state) */
export const JobStateSchema = z.enum([
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
]);

export const JobSchema = z.object({
  id: z.uuid(),
  /** Назва черги (= назва job-а) */
  name: z.string(),
  state: JobStateSchema,
  retryCount: z.number().int(),
  retryLimit: z.number().int(),
  singletonKey: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** Серіалізований output (для failed — текст помилки) */
  output: z.string().nullable(),
});

export const JobQuerySchema = PaginationQuerySchema.extend({
  state: JobStateSchema.optional(),
  queue: z.string().optional(),
});

export const JobResponseSchema = JobSchema;
export const JobListResponseSchema = paginatedResponseSchema(JobResponseSchema);

/** Зведення по черзі: кількість job-ів у кожному стані */
export const QueueStatSchema = z.object({
  name: z.string(),
  created: z.number().int(),
  retry: z.number().int(),
  active: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
});

export const QueueStatsResponseSchema = z.object({
  queues: z.array(QueueStatSchema),
});
