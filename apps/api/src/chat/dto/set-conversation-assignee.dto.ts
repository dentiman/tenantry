import { createZodDto } from 'nestjs-zod';
import { SetConversationAssigneeSchema } from '@saas-skeleton/contracts';

export class SetConversationAssigneeDto extends createZodDto(SetConversationAssigneeSchema) {}
