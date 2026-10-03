import { Inject, Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  MessageSubscriber,
  MessageSubscriberContract,
  purgeAiConversationsCommand,
  type AiConfig,
} from '@saas-skeleton/shared';

/**
 * Cron-чистка AI-розмов старших за `AI_RETENTION_DAYS` (ai-1e, docs/ai-assistant.md §9.2).
 * Жорстке видалення, крос-tenant, патерн `CleanupOrphanFilesSubscriber`.
 *
 * Поріг — `lastMessageAt` (а не `createdAt`): розмова лишається ЄДИНОЮ активною в юзера
 * невизначено довго (немає примусового ресету), тож видаляти за віком СТВОРЕННЯ означало б
 * стерти розмову, якою й досі щодня користуються. `lastMessageAt ?? createdAt` покриває й
 * розмову без жодного повідомлення (design.md D2). Один `deleteMany`, без циклу по BATCH_SIZE,
 * як у `files.cleanup-orphans`: тут немає зовнішнього ресурсу (S3-об'єкта) на рядок, який
 * треба прибрати ПЕРШИМ — сам SQL DELETE з `onDelete: Cascade` на `AiMessage` досить.
 */
@Injectable()
@MessageSubscriber({ definition: purgeAiConversationsCommand, id: 'ai-conversation-purger' })
export class AiPurgeConversationsSubscriber implements MessageSubscriberContract<
  typeof purgeAiConversationsCommand.schema
> {
  private readonly logger = new Logger(AiPurgeConversationsSubscriber.name);

  constructor(
    // System-scope: крос-tenant, BYPASSRLS (tenant-контексту немає свідомо)
    private readonly prisma: SystemPrismaService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.aiConversation.deleteMany({
      where: {
        OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
      },
    });

    this.logger.log(
      `Purged ${String(count)} AI conversations older than ${String(this.config.retentionDays)} days`,
    );
  }
}
