import { createZodDto } from 'nestjs-zod';
import { ActivityListResponseSchema, ActivityResponseSchema } from '@saas-skeleton/contracts';

export class ActivityResponseDto extends createZodDto(ActivityResponseSchema) {}
export class ActivityListResponseDto extends createZodDto(ActivityListResponseSchema) {}
