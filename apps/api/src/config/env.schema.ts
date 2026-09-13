import { z } from 'zod';
import { parseOrigins } from './cors.config';

/**
 * Env tenant-api, перевірений на СТАРТІ (AUTH-0, FR-010): процес падає одразу, а не
 * через тиждень «чомусь токени чужого середовища валідні».
 *
 * Обов'язкове тут лише те, без чого процес і так не працює. Змінні з робочими
 * дефолтами (БД, S3, Valkey — дефолти docker-compose) лишаються опційними: схема
 * не має ламати `pnpm docker:up` + `pnpm api:dev` без решти `.env`.
 *
 * `looseObject`: решту env (NODE_ENV, PORT, REALTIME_* …) схема пропускає без змін.
 */

/**
 * Літеральні значення з `.env.example`. Скопійований приклад — не секрет: він лежить
 * у публічному репозиторії. Синхронізувати з `.env.example` при його зміні.
 */
const EXAMPLE_JWT_SECRETS = new Set(['change-me-in-production-min-32-chars-secret-key-here']);

export const MIN_JWT_SECRET_LENGTH = 32;

export const jwtSecretSchema = (exampleValues: ReadonlySet<string>): z.ZodType<string> =>
  z
    .string()
    .min(MIN_JWT_SECRET_LENGTH, `must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`)
    .refine((value) => !exampleValues.has(value), {
      message: 'must not be the placeholder from .env.example — generate a real secret',
    });

const positiveIntString = z
  .string()
  .trim()
  .regex(/^\d+$/, 'must be a positive integer')
  .refine((value) => Number(value) > 0, 'must be a positive integer');

const originList = z.string().refine(
  (value) => {
    const origins = parseOrigins(value);
    return (
      origins.length > 0 &&
      origins.every((origin) => URL.canParse(origin) && new URL(origin).origin === origin)
    );
  },
  { message: 'must be a comma-separated list of origins like https://app.example.com' },
);

export const ApiEnvSchema = z.looseObject({
  JWT_SECRET: jwtSecretSchema(EXAMPLE_JWT_SECRETS),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),

  // AUTH-0: мережевий периметр
  CORS_ALLOWED_ORIGINS: originList.optional(),
  REALTIME_ALLOWED_ORIGINS: originList.optional(),
  TRUST_PROXY_HOPS: z.string().trim().regex(/^\d+$/, 'must be a non-negative integer').optional(),

  // AUTH-0: пороги обмеження частоти (дефолти — у throttle.config.ts)
  THROTTLE_DEFAULT_LIMIT_PER_MINUTE: positiveIntString.optional(),
  AUTH_LOGIN_LIMIT_PER_MINUTE: positiveIntString.optional(),
  AUTH_LOGIN_IP_LIMIT_PER_MINUTE: positiveIntString.optional(),
  AUTH_REFRESH_LIMIT_PER_MINUTE: positiveIntString.optional(),
  ACCOUNT_SENSITIVE_LIMIT_PER_HOUR: positiveIntString.optional(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** `ConfigModule.forRoot({ validate })` — кидає зі списком усіх порушень одразу */
export function validateApiEnv(config: Record<string, unknown>): ApiEnv {
  const parsed = ApiEnvSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration — ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** Скільки проксі-хопів довіряти `X-Forwarded-For` (1 = nginx у контейнері web) */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  return raw === undefined || raw.trim() === '' ? 1 : Number(raw);
}
