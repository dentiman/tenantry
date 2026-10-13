import { Injectable } from '@nestjs/common';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import {
  ChannelDeliveryService,
  MessageSubscriber,
  channelsDeliverOutboundCommand,
  type MessageData,
  type MessageEnvelope,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

type DeliverOutbound = MessageData<typeof channelsDeliverOutboundCommand>;

const CONSUMER_ID = 'channels-deliver';

/**
 * Відправка вихідного провайдеру (CHAT-2b, design.md D2). Без `inbox.runOnce`: виклик провайдера не
 * може сидіти в транзакції, а ідемпотентність тримає сам рядок (умовне захоплення `QUEUED →
 * SENDING`). Тому підписник — лише обгортка: послати і повідомити браузер про зміну.
 *
 * `deliver` повертається ПІСЛЯ коміту своїх транзакцій, отже сигнал «перечитай» летить, коли
 * новий стан уже видно. Повторювана відмова вилітає звідси виключенням і повторюється pg-boss.
 */
@Injectable()
@MessageSubscriber({ definition: channelsDeliverOutboundCommand, id: CONSUMER_ID })
export class ChannelsDeliverSubscriber
  implements MessageSubscriberContract<typeof channelsDeliverOutboundCommand.schema>
{
  constructor(
    private readonly delivery: ChannelDeliveryService,
    private readonly realtime: WorkerRealtimeEmitter,
  ) {}

  async handle(data: DeliverOutbound, envelope: MessageEnvelope): Promise<void> {
    const tenantId = envelope.tenantId;
    if (!tenantId) {
      throw new Error('channels.deliver-outbound without tenantId');
    }

    const { updated } = await this.delivery.deliver(data.messageId);
    for (const message of updated) {
      this.realtime.toTenant(tenantId, REALTIME_EVENTS.chatMessageUpdated, {
        conversationId: message.conversationId,
        messageId: message.messageId,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}
