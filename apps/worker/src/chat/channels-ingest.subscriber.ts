import { Injectable, Logger } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import {
  ChannelIngestService,
  MessageInboxService,
  MessageSubscriber,
  channelsIngestWebhookCommand,
  type MessageData,
  type MessageEnvelope,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

type IngestWebhook = MessageData<typeof channelsIngestWebhookCommand>;

const CONSUMER_ID = 'channels-ingest';

/**
 * Розбір збереженого вебхука каналу (CHAT-2a, docs/whatsapp-channel.md §4.3).
 *
 * `inbox.runOnce` гарантує, що ДО-ефекти БД застосуються раз на доставку; а дублікат самого
 * повідомлення провайдера відсікає частковий UNIQUE у `ChannelIngestService`, тож повторна
 * публікація тієї ж події (новий messageId) теж нічого не подвоїть.
 *
 * Сигнал скриньці — ПІСЛЯ коміту (`onCommit`) і лише коли щось справді збережено: це
 * прискорення, стан у Postgres, втрата сигналу нічого не губить.
 */
@Injectable()
@MessageSubscriber({ definition: channelsIngestWebhookCommand, id: CONSUMER_ID })
export class ChannelsIngestSubscriber
  implements MessageSubscriberContract<typeof channelsIngestWebhookCommand.schema>
{
  private readonly logger = new Logger(ChannelsIngestSubscriber.name);

  constructor(
    private readonly inbox: MessageInboxService,
    private readonly transactions: TenantTransactions,
    private readonly ingest: ChannelIngestService,
    private readonly realtime: WorkerRealtimeEmitter,
  ) {}

  async handle(data: IngestWebhook, envelope: MessageEnvelope): Promise<void> {
    const tenantId = envelope.tenantId;
    if (!tenantId) {
      // Tenant-команда без tenantId — помилка постановки, повторювати нема сенсу
      throw new Error('channels.ingest-webhook without tenantId');
    }

    await this.inbox.runOnce(envelope, CONSUMER_ID, async (tx) => {
      const outcome = await this.ingest.ingestEvent(tx, data.eventId);
      if (outcome.state === 'FAILED' || outcome.state === 'UNROUTABLE') {
        this.logger.warn(`Webhook event ${data.eventId} ${outcome.state}: ${outcome.error ?? 'n/a'}`);
      }
      if (outcome.changedConversationIds.length === 0) return;

      this.transactions.onCommit(tx, () => {
        for (const conversationId of outcome.changedConversationIds) {
          this.realtime.toTenant(tenantId, REALTIME_EVENTS.chatInboxChanged, {
            conversationId,
            occurredAt: new Date().toISOString(),
          });
        }
      });
    });
  }
}
