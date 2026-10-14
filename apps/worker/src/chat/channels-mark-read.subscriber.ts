import { Injectable } from '@nestjs/common';
import {
  ChannelReadReceiptService,
  MessageSubscriber,
  channelsMarkReadCommand,
  type MessageData,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';

type MarkRead = MessageData<typeof channelsMarkReadCommand>;

/**
 * «Прочитано агентом» провайдеру (CHAT-3b3, design.md D2–D3). Тонка обгортка: усе рішення й журнал — у
 * `ChannelReadReceiptService`, який не кидає. Без `inbox.runOnce`: дедуп уже зробив `provider_read_at`.
 */
@Injectable()
@MessageSubscriber({ definition: channelsMarkReadCommand, id: 'channels-mark-read' })
export class ChannelsMarkReadSubscriber
  implements MessageSubscriberContract<typeof channelsMarkReadCommand.schema>
{
  constructor(private readonly receipts: ChannelReadReceiptService) {}

  async handle(data: MarkRead): Promise<void> {
    await this.receipts.send(data.messageId);
  }
}
