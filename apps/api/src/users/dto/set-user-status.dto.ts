import { createZodDto } from 'nestjs-zod';
import { SetUserStatusSchema } from '@saas-skeleton/contracts';

export class SetUserStatusDto extends createZodDto(SetUserStatusSchema) {}
