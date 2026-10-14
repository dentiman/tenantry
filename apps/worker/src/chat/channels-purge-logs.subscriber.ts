import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  CHANNEL_LOG_RETENTION_DAYS,
  MessageSubscriber,
  channelsPurgeLogsCommand,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';

/**
 * Щодобове прибирання журналу викликів до провайдера (CHAT-3a, chat/channel-logs). Системний scope
 * (крос-tenant, BYPASSRLS), як і решта чисток: журнал без прибирання ріс би без меж. Природно
 * ідемпотентне — inbox не потрібен.
 */
@Injectable()
@MessageSubscriber({ definition: channelsPurgeLogsCommand, id: 'channels-purge-logs' })
export class ChannelsPurgeLogsSubscriber
  implements MessageSubscriberContract<typeof channelsPurgeLogsCommand.schema>
{
  private readonly logger = new Logger(ChannelsPurgeLogsSubscriber.name);

  constructor(private readonly prisma: SystemPrismaService) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - CHANNEL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.channelLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    this.logger.log(`Deleted ${String(count)} channel log entries older than ${String(CHANNEL_LOG_RETENTION_DAYS)} days`);
  }
}
