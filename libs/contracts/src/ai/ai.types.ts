import type { z } from 'zod';
import type {
  AiCitationContentResponseSchema,
  AiCitationSchema,
  AiConversationResponseSchema,
  AiMessageErrorCodeSchema,
  AiMessageResponseSchema,
  AiMessageRoleSchema,
  AiMessageStatusSchema,
  AskAiRequestSchema,
  AskAiResponseSchema,
} from './ai.schema';

export type AiMessageRole = z.infer<typeof AiMessageRoleSchema>;
export type AiMessageStatus = z.infer<typeof AiMessageStatusSchema>;
export type AiMessageErrorCode = z.infer<typeof AiMessageErrorCodeSchema>;
export type AiMessageResponse = z.infer<typeof AiMessageResponseSchema>;
export type AiConversationResponse = z.infer<typeof AiConversationResponseSchema>;
export type AskAiRequest = z.infer<typeof AskAiRequestSchema>;
export type AskAiResponse = z.infer<typeof AskAiResponseSchema>;
export type AiCitation = z.infer<typeof AiCitationSchema>;
export type AiCitationContentResponse = z.infer<typeof AiCitationContentResponseSchema>;
