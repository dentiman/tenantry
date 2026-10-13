import type { z } from 'zod';
import type {
  ChannelErrorClassSchema,
  ChatMemberRefSchema,
  ChatMessageDirectionSchema,
  ChatMessageFailureSchema,
  SetConversationAssigneeSchema,
  SetConversationStatusSchema,
  SettableConversationStatusSchema,
  ChatMessageKindSchema,
  ChatMessageListQuerySchema,
  ChatMessageListResponseSchema,
  ChatMessageResponseSchema,
  ChatMessageStatusSchema,
  ChatMessageVisibilitySchema,
  ChatSenderTypeSchema,
  ChatSystemEntryTypeSchema,
  ChatSystemPayloadSchema,
  ChatUserRefSchema,
  ConversationAccessSchema,
  ConversationKindSchema,
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  ConversationParticipantResponseSchema,
  ConversationResponseSchema,
  ConversationStatusSchema,
  CreateConversationSchema,
  MarkConversationReadSchema,
  PostChatMessageSchema,
} from './chat.schema';

export type ConversationKind = z.infer<typeof ConversationKindSchema>;
export type ConversationAccess = z.infer<typeof ConversationAccessSchema>;
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export type ChatMessageKind = z.infer<typeof ChatMessageKindSchema>;
export type ChatMessageVisibility = z.infer<typeof ChatMessageVisibilitySchema>;
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;
export type ChatSenderType = z.infer<typeof ChatSenderTypeSchema>;
export type ChatSystemEntryType = z.infer<typeof ChatSystemEntryTypeSchema>;
export type ChatMemberRef = z.infer<typeof ChatMemberRefSchema>;
export type ChatSystemPayload = z.infer<typeof ChatSystemPayloadSchema>;
export type ChatUserRef = z.infer<typeof ChatUserRefSchema>;
export type ConversationParticipantResponse = z.infer<
  typeof ConversationParticipantResponseSchema
>;
export type ChatMessageResponse = z.infer<typeof ChatMessageResponseSchema>;
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
export type CreateConversation = z.infer<typeof CreateConversationSchema>;
export type PostChatMessage = z.infer<typeof PostChatMessageSchema>;
export type MarkConversationRead = z.infer<typeof MarkConversationReadSchema>;
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;
export type ChatMessageListQuery = z.infer<typeof ChatMessageListQuerySchema>;
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;
export type ChatMessageListResponse = z.infer<typeof ChatMessageListResponseSchema>;

export type ChannelErrorClass = z.infer<typeof ChannelErrorClassSchema>;
export type ChatMessageFailure = z.infer<typeof ChatMessageFailureSchema>;
export type ChatMessageDirection = z.infer<typeof ChatMessageDirectionSchema>;
export type SettableConversationStatus = z.infer<typeof SettableConversationStatusSchema>;
export type SetConversationStatus = z.infer<typeof SetConversationStatusSchema>;
export type SetConversationAssignee = z.infer<typeof SetConversationAssigneeSchema>;
