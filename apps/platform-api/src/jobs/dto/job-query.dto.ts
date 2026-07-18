import { createZodDto } from 'nestjs-zod';
import { JobQuerySchema } from '@saas-skeleton/contracts';

export class JobQueryDto extends createZodDto(JobQuerySchema) {}
