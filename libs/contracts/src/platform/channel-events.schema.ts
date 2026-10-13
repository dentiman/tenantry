import { z } from 'zod';

/**
 * Вебхуки каналів, що не вдалося привʼязати до тенанта (CHAT-2a, chat/inbound «Deliveries that cannot
 * be routed»). Лише control plane: таблиця без tenant_id, і тіло повідомлення в ній не зберігається.
 * Оператор відповідає на питання «чому в клієнта вебхук нічого не робить» (невідомий ключ, вимкнений акаунт).
 */
export const ChannelUnroutableEventSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  /** Хеш ключа вебхука, а не сам ключ: перелік ключів у журналі був би перелічуванням акаунтів */
  keyHash: z.string(),
  reason: z.string(),
  ip: z.string().nullable(),
  receivedAt: z.iso.datetime(),
});

export const ChannelUnroutableListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  reason: z.string().trim().min(1).max(64).optional(),
});

export const ChannelUnroutableListResponseSchema = z.object({
  items: z.array(ChannelUnroutableEventSchema),
  total: z.number().int().nonnegative(),
});
