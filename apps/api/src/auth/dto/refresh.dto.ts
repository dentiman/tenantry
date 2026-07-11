import { createZodDto } from 'nestjs-zod';
import { RefreshSchema } from '@saas-skeleton/contracts';

export class RefreshDto extends createZodDto(RefreshSchema) {}
