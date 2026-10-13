import { Injectable, Logger } from '@nestjs/common';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import {
  ChannelPendingSweeper,
  MessageSubscriber,
  channelsSweepPendingStatusesCommand,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

/**
 * Хвилинне підмітання запаркованих квитанцій (CHAT-2b, design.md D10). Природно ідемпотентне
 * (кожен прохід лише застосовує те, що ще не застосовано) — inbox не потрібен. Сигнал браузеру —
 * після того, як `sweep()` закомітив зміни кожного тенанта.
 */
@Injectable()
@MessageSubscriber({ definition: channelsSweepPendingStatusesCommand, id: 'channels-sweep-pending' })
export class ChannelsSweepPendingSubscriber
  implements MessageSubscriberContract<typeof channelsSweepPendingStatusesCommand.schema>
{
  private readonly logger = new Logger(ChannelsSweepPendingSubscriber.name);

  constructor(
    private readonly sweeper: ChannelPendingSweeper,
    private readonly realtime: WorkerRealtimeEmitter,
  ) {}

  async handle(): Promise<void> {
    const result = await this.sweeper.sweep();
    for (const { tenantId, message } of result.updated) {
      this.realtime.toTenant(tenantId, REALTIME_EVENTS.chatMessageUpdated, {
        conversationId: message.conversationId,
        messageId: message.messageId,
        occurredAt: new Date().toISOString(),
      });
    }
    if (result.applied > 0 || result.discarded > 0) {
      this.logger.log(`Pending receipts: applied ${String(result.applied)}, discarded ${String(result.discarded)}`);
    }
  }
}
