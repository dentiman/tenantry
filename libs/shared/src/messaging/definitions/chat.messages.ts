import { z } from 'zod';
import { defineCommand, defineEvent } from '../message-definition';

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

/**
 * Внутрішню репліку збережено (CHAT-0.2c, docs/chat.md §4.11). Шов, який 0.1 залишив у
 * `ChatService.insert()`: перший споживач — `chat-notify` у воркері, що пише сповіщення тим
 * учасникам, які не дивляться на розмову.
 *
 * Лише id: текст реплік лежить під RLS, а `pgboss.*` — поза нею (той самий принцип, що в
 * `channels.ingest-webhook`). `viewerIds` — знімок «хто дивився, коли писали», обчислений в API ДО
 * транзакції (адаптер сокетів — зовнішній виклик, його не тримають під блокуванням розмови);
 * воркер сокетів не бачить і працює з цими даними детерміновано. `tenantId` і автор їдуть у конверті.
 */
export const chatMessagePostedEvent = defineEvent(
  'chat.message-posted.v1',
  z.object({
    conversationId: z.uuid(),
    messageId: z.uuid(),
    viewerIds: z.array(z.uuid()),
  }),
);

/**
 * Відправка збереженого вихідного повідомлення провайдеру (CHAT-2b, design.md D2). Єдиний
 * споживач — `channels-deliver` у воркері на `key_strict_fifo`-черзі з ключем `conversationId`:
 * клієнт має бачити репліки в порядку, в якому їх написав агент. У payload лише id — текст під RLS.
 */
export const channelsDeliverOutboundCommand = defineCommand(
  'channels.deliver-outbound',
  z.object({
    messageId: z.uuid(),
  }),
);

/**
 * Клієнт написав у розмову (CHAT-2b, design.md D8): публікує ingest у транзакції збереження. Єдиний
 * споживач `chat-notify-customer` сповіщає призначеного агента, якщо він не дивиться на розмову.
 */
export const chatCustomerMessageReceivedEvent = defineEvent(
  'chat.customer-message-received.v1',
  z.object({
    conversationId: z.uuid(),
    messageId: z.uuid(),
  }),
);

/**
 * Хвилинне підмітання квитанцій, що випередили запис `external_id` (CHAT-2b, design.md D10).
 * Cron, системний scope; кожен рядок обробляється під контекстом свого тенанта.
 */
export const channelsSweepPendingStatusesCommand = defineCommand(
  'channels.sweep-pending-statuses',
  z.object({}),
);

/**
 * Щодобове прибирання журналу викликів до провайдера (CHAT-3a, design.md D8): cron, системний scope,
 * природно ідемпотентне. Термін — `CHANNEL_LOG_RETENTION_DAYS`.
 */
export const channelsPurgeLogsCommand = defineCommand('channels.purge-logs', z.object({}));
