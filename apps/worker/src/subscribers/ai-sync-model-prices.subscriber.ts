import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  syncAiModelPricesCommand,
  syncOpenRouterPrices,
} from '@saas-skeleton/shared';

/**
 * Щоденна синхронізація тарифів OpenRouter (AI-5b, design.md R7). Мережа — до запису,
 * пише `saas_platform` (тарифи — control plane, `saas_app` їх лише читає).
 */
@Injectable()
@MessageSubscriber({ definition: syncAiModelPricesCommand, id: 'ai-model-price-syncer' })
export class AiSyncModelPricesSubscriber implements MessageSubscriberContract<
  typeof syncAiModelPricesCommand.schema
> {
  private readonly logger = new Logger(AiSyncModelPricesSubscriber.name);

  constructor(private readonly prisma: SystemPrismaService) {}

  async handle(): Promise<void> {
    const result = await syncOpenRouterPrices(this.prisma, { actor: 'cron' });
    if (result.errors.length > 0) {
      this.logger.warn({ errors: result.errors }, 'AI model price sync: some lists failed');
    }
    this.logger.log(
      { created: result.created, unchanged: result.unchanged, skipped: result.skipped },
      'AI model prices synced',
    );
  }
}
