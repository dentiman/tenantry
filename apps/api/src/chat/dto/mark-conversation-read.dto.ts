import { createZodDto } from 'nestjs-zod';
import { MarkConversationReadSchema } from '@saas-skeleton/contracts';

export class MarkConversationReadDto extends createZodDto(MarkConversationReadSchema) {}
