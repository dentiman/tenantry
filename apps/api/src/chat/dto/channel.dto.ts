import { createZodDto } from 'nestjs-zod';
import {
  ChannelContactResponseSchema,
  ChannelListResponseSchema,
  FakeChannelSetupResponseSchema,
  InboxListResponseSchema,
  InboxQuerySchema,
  LinkContactCustomerSchema,
  MessagingAccountListResponseSchema,
  MessagingAccountResponseSchema,
  SimulateInboundResponseSchema,
  SimulateInboundSchema,
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
