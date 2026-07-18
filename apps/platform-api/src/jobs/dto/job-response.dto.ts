import { createZodDto } from 'nestjs-zod';
import { JobListResponseSchema, QueueStatsResponseSchema } from '@saas-skeleton/contracts';

export class JobListResponseDto extends createZodDto(JobListResponseSchema) {}
export class QueueStatsResponseDto extends createZodDto(QueueStatsResponseSchema) {}
