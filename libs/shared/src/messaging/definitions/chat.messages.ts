import { z } from 'zod';
import { defineCommand } from '../message-definition';

/**
 * Обробка збереженого вебхука каналу (CHAT-2a, docs/whatsapp-channel.md §4.3).
 *
 * Команда з одним споживачем (`channels-ingest` у воркері). У payload лише id рядка
 * `channel_webhook_events`: сире тіло лежить у БД під RLS, а `pgboss.*` — поза нею, і
 * вміст листування там був би крос-tenant видимий (той самий принцип, що
 * `ai.generate-reply`). `tenantId` їде в конверті.
 */
export const channelsIngestWebhookCommand = defineCommand(
  'channels.ingest-webhook',
  z.object({
    eventId: z.uuid(),
  }),
);
