import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import { AI_CONFIG, type AiConfig } from '../ai.config';
import { readAiSettings } from '../prompt/organization-instructions';
import type { PlatformAiSettingsRow } from './platform-ai-settings';

/**
 * Скільки tenant-процес вірить закешованим налаштуванням платформи (AI-5a, design.md D5):
 * зміна в UI суперадміна діє на наступну генерацію щонайпізніше через цей час, без перезапуску.
 */
export const PLATFORM_AI_SETTINGS_TTL_MS = 5_000;

/**
 * Читання `platform_ai_settings` з tenant-процесів (worker, tenant api) під `saas_app`,
 * якому дано лише SELECT. Таблиця без RLS: рядок один і не належить жодному tenant-у.
 */
@Injectable()
export class PlatformAiSettingsReader {
  private cached: {
    readonly at: number;
    readonly value: Promise<PlatformAiSettingsRow | null>;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Скинути кеш — для тестів і майбутнього сигналу «налаштування змінились» */
  invalidate(): void {
    this.cached = null;
  }

  read(): Promise<PlatformAiSettingsRow | null> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < PLATFORM_AI_SETTINGS_TTL_MS) {
      return this.cached.value;
    }
    const value = this.prisma.platformAiSettings
      .findUnique({
        where: { id: 'default' },
        select: {
          enabled: true,
          provider: true,
          baseUrl: true,
          model: true,
          apiKeyEncrypted: true,
          apiKeyHint: true,
        },
      })
      .catch((error: unknown) => {
        // Збій читання не кешується: наступний виклик спробує знову
        this.cached = null;
        throw error;
      });
    this.cached = { at: now, value };
    return value;
  }
}

/** Чотири рівні доступності асистента для поточного tenant-а (design.md D6) */
export interface AiAvailability {
  /** `AI_ENABLED` в env — жорсткий гейт інсталяції */
  readonly installation: boolean;
  /** Вмикач суперадміна */
  readonly platform: boolean;
  /** Дозвіл суперадміна саме цьому tenant-у (немає рядка — дозволено) */
  readonly tenantAllowed: boolean;
  /** Вибір Tenant Admin у `/settings/ai` */
  readonly tenantEnabled: boolean;
  /** Усе разом — лише тоді асистент доступний користувачам tenant-а */
  readonly available: boolean;
}

@Injectable()
export class AiAvailabilityService {
  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    private readonly settings: PlatformAiSettingsReader,
    private readonly tenantContext: TenantContextService,
    private readonly transactions: TenantTransactions,
  ) {}

  /**
   * Лише в tenant-контексті: без нього `requireTenantId()` кидає, а не повертає «доступно» —
   * RLS дав би порожні рядки, і дефолти «дозволено/увімкнено» відкрили б асистента.
   */
  async forCurrentTenant(): Promise<AiAvailability> {
    const tenantId = this.tenantContext.requireTenantId();
    const [row, tenant] = await Promise.all([
      this.settings.read(),
      this.transactions.withTenantTx((tx) =>
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true, aiAccess: { select: { allowed: true } } },
        }),
      ),
    ]);
    const installation = this.config.enabled;
    const platform = row?.enabled ?? true;
    // Немає рядка tenant-а (не мав би статись у контексті) — недоступно, а не дефолт
    const tenantAllowed = tenant !== null && (tenant.aiAccess?.allowed ?? true);
    const tenantEnabled = tenant !== null && readAiSettings(tenant.settings).settings.enabled;
    return {
      installation,
      platform,
      tenantAllowed,
      tenantEnabled,
      available: installation && platform && tenantAllowed && tenantEnabled,
    };
  }
}
