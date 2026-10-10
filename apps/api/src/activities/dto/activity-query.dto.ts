import { createZodDto } from 'nestjs-zod';
import { ActivityQuerySchema, WorkspaceActivityQuerySchema } from '@saas-skeleton/contracts';

export class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}
export class WorkspaceActivityQueryDto extends createZodDto(WorkspaceActivityQuerySchema) {}
