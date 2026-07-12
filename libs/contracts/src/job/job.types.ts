import type { z } from 'zod';
import type {
  JobListResponseSchema,
  JobQuerySchema,
  JobResponseSchema,
  JobSchema,
  JobStateSchema,
  QueueStatSchema,
  QueueStatsResponseSchema,
} from './job.schema';

export type JobState = z.infer<typeof JobStateSchema>;
export type Job = z.infer<typeof JobSchema>;
export type JobQuery = z.infer<typeof JobQuerySchema>;
export type JobResponse = z.infer<typeof JobResponseSchema>;
export type JobListResponse = z.infer<typeof JobListResponseSchema>;
export type QueueStat = z.infer<typeof QueueStatSchema>;
export type QueueStatsResponse = z.infer<typeof QueueStatsResponseSchema>;
