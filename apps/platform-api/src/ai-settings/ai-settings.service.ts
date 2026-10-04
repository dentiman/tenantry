import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemPrismaService, type PlatformAiSettings, type Prisma } from '@saas-skeleton/database';
import type {
  PlatformAiApiKeyRevealResponse,
  PlatformAiSettingsEventListResponse,
  PlatformAiSettingsResponse,
  UpdatePlatformAiSettings,
} from '@saas-skeleton/contracts/platform';
import { loadAiConfig } from '@saas-skeleton/shared/ai/ai.config';
import { resolveGenerationSettings } from '@saas-skeleton/shared/ai/platform/platform-ai-settings';
import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  loadMasterKey,
  maskSecret,
  secretHint,
} from '@saas-skeleton/shared/ai/platform/secret-box';
import type { PlatformJwtPayload } from '../auth/decorators/current-operator.decorator';

const SETTINGS_ID = 'default';
const EVENTS_LIMIT = 50;

/**
 * Налаштування AI-асистента платформи (AI-5a, docs/ai-platform-controls.md §2). Пише лише
 * control plane під `saas_platform`; tenant-процеси читають рядок самі (SELECT-грант) і
 * розшифровують ключ лише у воркері. Ключ ніколи не логується й не повертається, крім
 * явного розкриття, яке пише подію в журнал.
 */
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);
  // env інсталяції — те, що діє, поки поле не задане в UI
  private readonly config = loadAiConfig();
  // Невалідний AI_SECRETS_KEY валить старт, а не перше збереження
  private readonly masterKey = loadMasterKey();

  constructor(private readonly prisma: SystemPrismaService) {}

  async get(): Promise<PlatformAiSettingsResponse> {
    return this.toResponse(await this.row());
  }

  async update(
    data: UpdatePlatformAiSettings,
    operator: PlatformJwtPayload,
  ): Promise<PlatformAiSettingsResponse> {
    const current = await this.row();
    let apiKeyEncrypted = current?.apiKeyEncrypted ?? null;
    let apiKeyHint = current?.apiKeyHint ?? null;
    if (data.apiKey === null) {
      apiKeyEncrypted = null;
      apiKeyHint = null;
    } else if (data.apiKey !== undefined) {
      if (!this.masterKey) {
        throw new BadRequestException({
          message: 'AI_SECRETS_KEY is not configured; the API key cannot be stored',
          fieldErrors: [
            {
              field: 'apiKey',
              message: 'Encryption is not configured',
              code: 'encryption_unavailable',
            },
          ],
        });
      }
      apiKeyEncrypted = encryptSecret(data.apiKey, this.masterKey);
      apiKeyHint = secretHint(data.apiKey);
    }

    this.assertUsable(data, apiKeyEncrypted !== null);

    const changes: Record<string, Prisma.InputJsonValue> = {};
    for (const field of ['enabled', 'provider', 'baseUrl', 'model'] as const) {
      const before = current ? current[field] : null;
      if (before !== data[field]) changes[field] = { from: before, to: data[field] };
    }
    if (data.apiKey === null && current?.apiKeyEncrypted) changes.apiKey = 'cleared';
    if (typeof data.apiKey === 'string') changes.apiKey = 'set';

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.platformAiSettings.upsert({
        where: { id: SETTINGS_ID },
        create: {
          id: SETTINGS_ID,
          enabled: data.enabled,
          provider: data.provider,
          baseUrl: data.baseUrl,
          model: data.model,
          apiKeyEncrypted,
          apiKeyHint,
          updatedBy: operator.email,
        },
        update: {
          enabled: data.enabled,
          provider: data.provider,
          baseUrl: data.baseUrl,
          model: data.model,
          apiKeyEncrypted,
          apiKeyHint,
          updatedBy: operator.email,
        },
      });
      if (Object.keys(changes).length > 0) {
        await tx.platformAiSettingsEvent.create({
          data: { type: 'updated', actorId: operator.sub, actorLabel: operator.email, changes },
        });
      }
      return saved;
    });
    // Лише назви полів — не значення ключа
    this.logger.log(
      `AI settings updated by ${operator.email}: ${Object.keys(changes).join(', ') || 'no changes'}`,
    );
    return this.toResponse(row);
  }

  /** «Око» в UI: явне розкриття, кожне — подія журналу з оператором і часом */
  async revealApiKey(operator: PlatformJwtPayload): Promise<PlatformAiApiKeyRevealResponse> {
    const row = await this.row();
    if (!row?.apiKeyEncrypted) {
      throw new NotFoundException('API key is not set in the platform settings');
    }
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted, this.masterKey);
    } catch (error) {
      const code = error instanceof SecretBoxError ? error.code : 'secret-invalid';
      throw new BadRequestException({
        message: `The stored API key cannot be decrypted (${code})`,
        fieldErrors: [{ field: 'apiKey', message: 'Cannot be decrypted', code }],
      });
    }
    await this.prisma.platformAiSettingsEvent.create({
      data: { type: 'key_revealed', actorId: operator.sub, actorLabel: operator.email },
    });
    this.logger.warn(`AI API key revealed by ${operator.email}`);
    return { apiKey };
  }

  async events(): Promise<PlatformAiSettingsEventListResponse> {
    const items = await this.prisma.platformAiSettingsEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: EVENTS_LIMIT,
    });
    return {
      items: items.map((event) => ({
        id: event.id,
        type: event.type as 'updated' | 'key_revealed',
        actorLabel: event.actorLabel,
        changes:
          typeof event.changes === 'object' &&
          event.changes !== null &&
          !Array.isArray(event.changes)
            ? (event.changes as Record<string, unknown>)
            : {},
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private row(): Promise<PlatformAiSettings | null> {
    return this.prisma.platformAiSettings.findUnique({ where: { id: SETTINGS_ID } });
  }

  /**
   * Реальний провайдер без URL, моделі чи ключа (ні в UI, ні в env) — відмова при збереженні,
   * а не FAILED на кожній відповіді потім.
   */
  private assertUsable(data: UpdatePlatformAiSettings, platformKey: boolean): void {
    const provider = data.provider ?? this.config.provider;
    if (provider !== 'openai-compat') return;
    const missing = [
      ...((data.baseUrl ?? this.config.baseUrl) ? [] : ['baseUrl']),
      ...((data.model ?? (this.config.modelConfigured ? this.config.model : null))
        ? []
        : ['model']),
      ...(platformKey || this.config.apiKey ? [] : ['apiKey']),
    ];
    if (missing.length > 0) {
      throw new BadRequestException({
        message: `openai-compat requires ${missing.join(', ')} (in the platform settings or env)`,
        fieldErrors: missing.map((field) => ({ field, message: 'Required', code: 'required' })),
      });
    }
  }

  private toResponse(row: PlatformAiSettings | null): PlatformAiSettingsResponse {
    // Без розшифрування: для відповіді досить знати, ЧИ є ключ
    const effective = resolveGenerationSettings(
      row ? { ...row, apiKeyEncrypted: null } : null,
      this.config,
      null,
    );
    const platformKey = row?.apiKeyEncrypted != null;
    return {
      enabled: row?.enabled ?? true,
      installationEnabled: this.config.enabled,
      provider: row?.provider === 'fake' || row?.provider === 'openai-compat' ? row.provider : null,
      baseUrl: row?.baseUrl ?? null,
      model: row?.model ?? null,
      apiKey: {
        configured: platformKey,
        masked: platformKey && row.apiKeyHint ? maskSecret(row.apiKeyHint) : null,
      },
      effective: {
        provider: effective.provider,
        baseUrl: effective.baseUrl,
        model: effective.model,
        apiKeyPresent: platformKey || effective.apiKey !== null,
        sources: { ...effective.sources, apiKey: platformKey ? 'platform' : 'env' },
      },
      encryptionAvailable: this.masterKey !== null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }
}
