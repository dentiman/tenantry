import { z } from 'zod';

/**
 * Налаштування AI-асистента, якими керує оператор платформи (AI-5a,
 * docs/ai-platform-controls.md). Одна модель на всю платформу; NULL — «не задано в UI»,
 * тоді діє env інсталяції.
 */
export const PlatformAiProviderSchema = z.enum(['fake', 'openai-compat']);
export const PlatformAiSettingSourceSchema = z.enum(['platform', 'env']);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTPS; HTTP — лише для локального стенда (stub провайдера на цій машині) */
export const PlatformAiBaseUrlSchema = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, 'Base URL must be HTTPS (HTTP only for localhost) without credentials, query or fragment');

export const PlatformAiSettingsResponseSchema = z.object({
  /** Вмикач оператора */
  enabled: z.boolean(),
  /** `AI_ENABLED` інсталяції: вимкнений env UI не перекриває */
  installationEnabled: z.boolean(),
  /** Що задано в UI (null — береться з env) */
  provider: PlatformAiProviderSchema.nullable(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  apiKey: z.object({
    /** Ключ задано в UI */
    configured: z.boolean(),
    /** `••••1234`; самого ключа тут не буває ніколи */
    masked: z.string().nullable(),
  }),
  /** Що реально використовує генерація після злиття з env — без ключа */
  effective: z.object({
    provider: PlatformAiProviderSchema,
    baseUrl: z.string().nullable(),
    model: z.string(),
    apiKeyPresent: z.boolean(),
    sources: z.object({
      provider: PlatformAiSettingSourceSchema,
      baseUrl: PlatformAiSettingSourceSchema,
      model: PlatformAiSettingSourceSchema,
      apiKey: PlatformAiSettingSourceSchema,
    }),
  }),
  /** Задано `AI_SECRETS_KEY`: без нього ключ зберегти не можна */
  encryptionAvailable: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
});

/**
 * PUT-семантика для всього, крім ключа: `apiKey` відсутній — не чіпати, `null` — прибрати
 * (діє env), рядок — замінити. Інакше форма мусила б щоразу вимагати ключ, якого не бачить.
 */
export const UpdatePlatformAiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: PlatformAiProviderSchema.nullable(),
  baseUrl: PlatformAiBaseUrlSchema.nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
  apiKey: z.string().trim().min(8).max(500).nullable().optional(),
});

export const PlatformAiApiKeyRevealResponseSchema = z.object({
  apiKey: z.string(),
});

export const PlatformAiSettingsEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(['updated', 'key_revealed']),
  actorLabel: z.string().nullable(),
  /** Які поля змінились; значення ключа тут не буває — лише `apiKey: set|cleared` */
  changes: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const PlatformAiSettingsEventListResponseSchema = z.object({
  items: z.array(PlatformAiSettingsEventSchema),
});
