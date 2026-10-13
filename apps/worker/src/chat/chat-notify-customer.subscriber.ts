import { Injectable } from '@nestjs/common';
import { conversationRoom } from '@saas-skeleton/contracts';
import {
  ChatNotifier,
  MessageInboxService,
  MessageSubscriber,
  chatCustomerMessageReceivedEvent,
  type MessageData,
  type MessageEnvelope,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

type CustomerMessageReceived = MessageData<typeof chatCustomerMessageReceivedEvent>;

const CONSUMER_ID = 'chat-notify-customer';

/**
 * Сповіщення призначеному агентові про вхідне від клієнта (CHAT-2b, design.md D8). Логіка «кому і
 * що» — у `ChatNotifier`; тут — ідемпотентна обгортка й запит «хто дивиться».
 *
 * Запит до adapter-а сокетів — зовнішній виклик, тож він ДО `runOnce` (до транзакції) і
 * fail-open: збій дає `[]`, і агент отримає сповіщення, яке зніме прочитання, а не мовчанку.
 */
@Injectable()
@MessageSubscriber({ definition: chatCustomerMessageReceivedEvent, id: CONSUMER_ID })
export class ChatNotifyCustomerSubscriber
  implements MessageSubscriberContract<typeof chatCustomerMessageReceivedEvent.schema>
{
  constructor(
    private readonly inbox: MessageInboxService,
    private readonly notifier: ChatNotifier,
    private readonly realtime: WorkerRealtimeEmitter,
  ) {}

  async handle(data: CustomerMessageReceived, envelope: MessageEnvelope): Promise<void> {
    const tenantId = envelope.tenantId;
    if (!tenantId) {
      throw new Error('chat.customer-message-received without tenantId');
    }
    const viewerIds = await this.realtime.userIdsInRoom(conversationRoom(tenantId, data.conversationId));
    await this.inbox.runOnce(envelope, CONSUMER_ID, (tx) =>
      this.notifier.notifyCustomerMessage(tx, { ...data, viewerIds }),
    );
  }
}
