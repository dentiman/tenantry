import type { AiConfig } from '../ai.config';
import { decryptSecret } from './secret-box';

/**
 * Рядок `platform_ai_settings` (AI-5a) у тій формі, яку читають обидва plane-и. NULL-поле
 * означає «не задано в UI» — тоді діє env (design.md D1).
 */
export interface PlatformAiSettingsRow {
  readonly enabled: boolean;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly apiKeyEncrypted: string | null;
  readonly apiKeyHint: string | null;
}

export type AiProviderKind = AiConfig['provider'];
export type SettingSource = 'platform' | 'env';

/** Що генерація реально використовує після злиття UI поверх env */
export interface EffectiveGenerationSettings {
  readonly provider: AiProviderKind;
  readonly baseUrl: string | null;
  readonly model: string;
  /** `false` — модель не задана ніде, і реальному бекенду дефолт `fake-1` не годиться */
  readonly modelConfigured: boolean;
  readonly apiKey: string | null;
  readonly sources: {
    readonly provider: SettingSource;
    readonly baseUrl: SettingSource;
    readonly model: SettingSource;
    readonly apiKey: SettingSource;
  };
}

const PROVIDERS: readonly AiProviderKind[] = ['fake', 'openai-compat'];

function providerOf(value: string | null): AiProviderKind | null {
  return value !== null && (PROVIDERS as readonly string[]).includes(value)
    ? (value as AiProviderKind)
    : null;
}

/**
 * Злиття налаштувань платформи поверх env (design.md D1). Ключ розшифровується лише тут і
 * лише тим процесом, якому дали майстер-ключ (worker, platform-api).
 */
export function resolveGenerationSettings(
  row: PlatformAiSettingsRow | null,
  config: AiConfig,
  masterKey: Buffer | null,
): EffectiveGenerationSettings {
  const provider = providerOf(row?.provider ?? null);
  const baseUrl = row?.baseUrl ?? null;
  const model = row?.model ?? null;
  const encrypted = row?.apiKeyEncrypted ?? null;
  return {
    provider: provider ?? config.provider,
    baseUrl: baseUrl ?? config.baseUrl,
    model: model ?? config.model,
    modelConfigured: model !== null || config.modelConfigured,
    apiKey: encrypted !== null ? decryptSecret(encrypted, masterKey) : config.apiKey,
    sources: {
      provider: provider !== null ? 'platform' : 'env',
      baseUrl: baseUrl !== null ? 'platform' : 'env',
      model: model !== null ? 'platform' : 'env',
      apiKey: encrypted !== null ? 'platform' : 'env',
    },
  };
}

/** Вмикач платформи: env-гейт інсталяції І перемикач суперадміна (design.md D1) */
export function platformEnabled(row: PlatformAiSettingsRow | null, config: AiConfig): boolean {
  return config.enabled && (row?.enabled ?? true);
}
