import { createZodDto } from 'nestjs-zod';
import {
  AdminChannelResponseSchema,
  ChannelContactResponseSchema,
  ChannelLogListResponseSchema,
  ChannelLogQuerySchema,
  ConnectMessagingAccountSchema,
  StartConversationSchema,
  SubscribeWebhookSchema,
  SyncResultSchema,
  WebhookEventListResponseSchema,
  WebhookEventsQuerySchema,
  WebhookStatusSchema,
  UpdateAccountCredentialsSchema,
  UpdateChannelSchema,
  ChannelListResponseSchema,
  FakeChannelSetupResponseSchema,
  InboxListResponseSchema,
  InboxQuerySchema,
  LinkContactCustomerSchema,
  MessagingAccountListResponseSchema,
  MessagingAccountResponseSchema,
  SimulateInboundResponseSchema,
  SimulateInboundSchema,
  SimulateStatusSchema,
} from '@saas-skeleton/contracts';

export class InboxQueryDto extends createZodDto(InboxQuerySchema) {}
export class InboxListResponseDto extends createZodDto(InboxListResponseSchema) {}
export class ChannelListResponseDto extends createZodDto(ChannelListResponseSchema) {}
export class ChannelContactResponseDto extends createZodDto(ChannelContactResponseSchema) {}
export class LinkContactCustomerDto extends createZodDto(LinkContactCustomerSchema) {}
export class MessagingAccountResponseDto extends createZodDto(MessagingAccountResponseSchema) {}
export class FakeChannelSetupResponseDto extends createZodDto(FakeChannelSetupResponseSchema) {}
export class SimulateInboundDto extends createZodDto(SimulateInboundSchema) {}
export class SimulateInboundResponseDto extends createZodDto(SimulateInboundResponseSchema) {}
export class MessagingAccountListResponseDto extends createZodDto(
  MessagingAccountListResponseSchema,
) {}
export class SimulateStatusDto extends createZodDto(SimulateStatusSchema) {}
export class ConnectMessagingAccountDto extends createZodDto(ConnectMessagingAccountSchema) {}
export class UpdateAccountCredentialsDto extends createZodDto(UpdateAccountCredentialsSchema) {}
export class UpdateChannelDto extends createZodDto(UpdateChannelSchema) {}
export class AdminChannelResponseDto extends createZodDto(AdminChannelResponseSchema) {}
export class SyncResultDto extends createZodDto(SyncResultSchema) {}
export class ChannelLogQueryDto extends createZodDto(ChannelLogQuerySchema) {}
export class ChannelLogListResponseDto extends createZodDto(ChannelLogListResponseSchema) {}
export class StartConversationDto extends createZodDto(StartConversationSchema) {}
export class WebhookStatusDto extends createZodDto(WebhookStatusSchema) {}
export class SubscribeWebhookDto extends createZodDto(SubscribeWebhookSchema) {}
export class WebhookEventsQueryDto extends createZodDto(WebhookEventsQuerySchema) {}
export class WebhookEventListResponseDto extends createZodDto(WebhookEventListResponseSchema) {}
