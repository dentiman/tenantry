import { Injectable } from '@nestjs/common';
import {
  ChatNotifier,
  MessageInboxService,
  MessageSubscriber,
  chatMessagePostedEvent,
  type MessageData,
  type MessageEnvelope,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';

type MessagePosted = MessageData<typeof chatMessagePostedEvent>;

const CONSUMER_ID = 'chat-notify';

/**
 * Сповіщення про внутрішню репліку (CHAT-0.2c, docs/chat.md §4.11): перший споживач
 * `chat.message-posted.v1`. Логіка «кому і що» — у `ChatNotifier` (libs/shared), тут лише
 * ідемпотентна обгортка: `runOnce` робить повторну доставку тієї самої події no-op, тож
 * ретрай pg-boss не подвоїть `group_count`.
 *
 * Збій після вичерпання ретраїв потрапляє в `dlq`; користувач втрачає лише запис у дзвінку —
 * жива репліка й бейдж непрочитаного вже в нього.
 */
@Injectable()
@MessageSubscriber({ definition: chatMessagePostedEvent, id: CONSUMER_ID })
export class ChatNotifySubscriber
  implements MessageSubscriberContract<typeof chatMessagePostedEvent.schema>
{
  constructor(
    private readonly inbox: MessageInboxService,
    private readonly notifier: ChatNotifier,
  ) {}

  async handle(data: MessagePosted, envelope: MessageEnvelope): Promise<void> {
    await this.inbox.runOnce(envelope, CONSUMER_ID, (tx) =>
      this.notifier.notifyMessagePosted(tx, data),
    );
  }
}
