import { createZodDto } from 'nestjs-zod';
import { SetConversationStatusSchema } from '@saas-skeleton/contracts';

export class SetConversationStatusDto extends createZodDto(SetConversationStatusSchema) {}
