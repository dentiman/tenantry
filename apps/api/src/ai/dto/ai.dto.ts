import { createZodDto } from 'nestjs-zod';
import {
  AiCitationContentResponseSchema,
  AiConversationResponseSchema,
  AskAiRequestSchema,
  AskAiResponseSchema,
} from '@saas-skeleton/contracts';

export class AiConversationResponseDto extends createZodDto(AiConversationResponseSchema) {}
export class AskAiRequestDto extends createZodDto(AskAiRequestSchema) {}
export class AskAiResponseDto extends createZodDto(AskAiResponseSchema) {}
export class AiCitationContentResponseDto extends createZodDto(AiCitationContentResponseSchema) {}
