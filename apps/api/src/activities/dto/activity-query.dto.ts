import { createZodDto } from 'nestjs-zod';
import { ActivityQuerySchema } from '@saas-skeleton/contracts';

export class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}
