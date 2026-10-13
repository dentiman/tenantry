import type { z } from 'zod';
import type {
  ChannelUnroutableEventSchema,
  ChannelUnroutableListQuerySchema,
  ChannelUnroutableListResponseSchema,
} from './channel-events.schema';

export type ChannelUnroutableEvent = z.infer<typeof ChannelUnroutableEventSchema>;
export type ChannelUnroutableListQuery = z.infer<typeof ChannelUnroutableListQuerySchema>;
export type ChannelUnroutableListResponse = z.infer<typeof ChannelUnroutableListResponseSchema>;
