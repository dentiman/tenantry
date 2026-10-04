import { Inject, Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  MessageSubscriber,
  MessageSubscriberContract,
  OPENROUTER_BILLING,
  PlatformAiSettingsReader,
  billingProviderFor,
  fetchOpenRouterGeneration,
  loadMasterKey,
  reconcileAiUsageCostsCommand,
  reconcilePendingUsage,
  resolveGenerationSettings,
  type AiConfig,
  type GenerationLookup,
} from '@saas-skeleton/shared';

/**
 * Добір фактичної вартості (AI-5b, docs/ai-platform-controls.md §3.1, design.md R5).
 *
 * System-scope, патерн `AiPurgeConversationsSubscriber`: крос-tenant через
 * `SystemPrismaService` — лише `saas_platform` має UPDATE на журнал. Ключ OpenRouter — з
 * налаштувань платформи (AI-5a), розшифровує воркер. `GET /generation` — поза транзакцією.
 */
@Injectable()
@MessageSubscriber({ definition: reconcileAiUsageCostsCommand, id: 'ai-usage-cost-reconciler' })
export class AiReconcileUsageCostsSubscriber implements MessageSubscriberContract<
  typeof reconcileAiUsageCostsCommand.schema
> {
  private readonly logger = new Logger(AiReconcileUsageCostsSubscriber.name);
  private readonly masterKey = loadMasterKey();

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly settings: PlatformAiSettingsReader,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  async handle(): Promise<void> {
    const result = await reconcilePendingUsage(
      this.prisma,
      await this.lookup(),
      new Date(),
      this.logger,
    );
    if (result.checked > 0) {
      this.logger.log(result, 'AI usage costs reconciled');
    }
  }

  /** `null` — OpenRouter зараз не налаштовано: спроби рядків витрачаються, а не висять */
  private async lookup(): Promise<((requestId: string) => Promise<GenerationLookup>) | null> {
    try {
      const effective = resolveGenerationSettings(
        await this.settings.read(),
        this.config,
        this.masterKey,
      );
      const { baseUrl, apiKey } = effective;
      if (
        billingProviderFor(effective.provider, baseUrl) !== OPENROUTER_BILLING ||
        !baseUrl ||
        !apiKey
      ) {
        return null;
      }
      return (requestId) => fetchOpenRouterGeneration(requestId, { baseUrl, apiKey });
    } catch (error) {
      // Без деталей: тут може бути помилка розшифрування ключа
      this.logger.warn(
        { err: error instanceof Error ? error.name : 'unknown' },
        'AI usage reconciliation: provider settings are not usable',
      );
      return null;
    }
  }
}
