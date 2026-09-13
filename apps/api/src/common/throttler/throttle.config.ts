import { z } from 'zod';

/**
 * Пороги обмеження частоти (AUTH-0, FR-001/FR-002). Дефолти — бойові значення зі spec.
 *
 * Чому env, а не константи в декораторах: e2e ходять з ОДНОГО IP (127.0.0.1), а
 * лічильники в межах jest-worker-а спільні між сьютами. З жорсткими порогами
 * сотні наявних тестів упиралися б у 429 у випадковому місці. `setup-env.ts`
 * піднімає пороги, а сьют обмеження частоти задає бойові значення явно.
 */
const intFromEnv = (fallback: number): z.ZodType<number, string | undefined> =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().positive());

const ThrottleEnvSchema = z.object({
  THROTTLE_DEFAULT_LIMIT_PER_MINUTE: intFromEnv(120),
  AUTH_LOGIN_LIMIT_PER_MINUTE: intFromEnv(5),
  AUTH_LOGIN_IP_LIMIT_PER_MINUTE: intFromEnv(20),
  AUTH_REFRESH_LIMIT_PER_MINUTE: intFromEnv(30),
  ACCOUNT_SENSITIVE_LIMIT_PER_HOUR: intFromEnv(10),
});

/**
 * Скільки чекати Valkey, перш ніж пропустити запит без ліміту (fail-open). Константа, а не
 * env: це не бізнес-поріг і не заважає тестам — налаштовувати його без релізу нема навіщо.
 */
const STORAGE_TIMEOUT_MS = 200;

export interface ThrottleConfig {
  defaultPerMinute: number;
  loginPerMinute: number;
  loginIpPerMinute: number;
  refreshPerMinute: number;
  accountSensitivePerHour: number;
  storageTimeoutMs: number;
}

export function loadThrottleConfig(env: NodeJS.ProcessEnv = process.env): ThrottleConfig {
  const parsed = ThrottleEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid throttle configuration — ${issues}`);
  }
  const e = parsed.data;
  return {
    defaultPerMinute: e.THROTTLE_DEFAULT_LIMIT_PER_MINUTE,
    loginPerMinute: e.AUTH_LOGIN_LIMIT_PER_MINUTE,
    loginIpPerMinute: e.AUTH_LOGIN_IP_LIMIT_PER_MINUTE,
    refreshPerMinute: e.AUTH_REFRESH_LIMIT_PER_MINUTE,
    accountSensitivePerHour: e.ACCOUNT_SENSITIVE_LIMIT_PER_HOUR,
    storageTimeoutMs: STORAGE_TIMEOUT_MS,
  };
}
