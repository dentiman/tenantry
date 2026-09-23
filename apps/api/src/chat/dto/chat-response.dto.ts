import { createZodDto } from 'nestjs-zod';
import {
  ChatMessageListResponseSchema,
  ChatMessageResponseSchema,
  ConversationListResponseSchema,
  ConversationResponseSchema,
} from '@saas-skeleton/contracts';

export class ConversationResponseDto extends createZodDto(ConversationResponseSchema) {}
export class ConversationListResponseDto extends createZodDto(ConversationListResponseSchema) {}
export class ChatMessageResponseDto extends createZodDto(ChatMessageResponseSchema) {}
export class ChatMessageListResponseDto extends createZodDto(ChatMessageListResponseSchema) {}
