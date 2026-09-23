import { createZodDto } from 'nestjs-zod';
import {
  ChatMessageListQuerySchema,
  ConversationListQuerySchema,
} from '@saas-skeleton/contracts';

export class ConversationListQueryDto extends createZodDto(ConversationListQuerySchema) {}
export class ChatMessageListQueryDto extends createZodDto(ChatMessageListQuerySchema) {}
