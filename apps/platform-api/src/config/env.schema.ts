import { z } from 'zod';

/**
 * Env control plane, перевірений на СТАРТІ (AUTH-0, FR-010). Той самий підхід, що в
 * apps/api/src/config/env.schema.ts (свідома копія ~40 рядків: спільної ліби для
 * бекенд-конфігу немає, а заводити її під дві схеми — передчасно).
 */

/** Літеральне значення з `.env.example` — синхронізувати при його зміні */
const EXAMPLE_PLATFORM_JWT_SECRETS = new Set(['change-me-platform-secret-min-32-chars-key-here']);
const MIN_JWT_SECRET_LENGTH = 32;
export const DEFAULT_PLATFORM_ALLOWED_ORIGINS = 'http://localhost:5174';

export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

const originList = z.string().refine(
  (value) => {
    const origins = parseOrigins(value);
    return (
      origins.length > 0 &&
      origins.every((origin) => URL.canParse(origin) && new URL(origin).origin === origin)
    );
  },
  { message: 'must be a comma-separated list of origins like https://ops.example.com' },
);

export const PlatformEnvSchema = z.looseObject({
  // ОКРЕМИЙ від tenant-плану секрет — фолбеку на JWT_SECRET немає і не буде
  PLATFORM_JWT_SECRET: z
    .string()
    .min(MIN_JWT_SECRET_LENGTH, `must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`)
    .refine((value) => !EXAMPLE_PLATFORM_JWT_SECRETS.has(value), {
      message: 'must not be the placeholder from .env.example — generate a real secret',
    }),
  PLATFORM_JWT_ACCESS_EXPIRES_IN: z.string().min(1).optional(),
  PLATFORM_DATABASE_URL: z.string().min(1).optional(),
  // AUTH-0: мережевий периметр. Ім'я з префіксом PLATFORM_, як PLATFORM_JWT_SECRET і
  // PLATFORM_PORT: у dev обидва API читають один кореневий .env, і спільне ім'я дало б
  // control plane origin tenant-web
  PLATFORM_CORS_ALLOWED_ORIGINS: originList.optional(),
  TRUST_PROXY_HOPS: z.string().trim().regex(/^\d+$/, 'must be a non-negative integer').optional(),
});

export type PlatformEnv = z.infer<typeof PlatformEnvSchema>;

/** `ConfigModule.forRoot({ validate })` — кидає зі списком усіх порушень одразу */
export function validatePlatformEnv(config: Record<string, unknown>): PlatformEnv {
  const parsed = PlatformEnvSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}

export function resolvePlatformAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseOrigins(env.PLATFORM_CORS_ALLOWED_ORIGINS ?? DEFAULT_PLATFORM_ALLOWED_ORIGINS);
}

/** Скільки проксі-хопів довіряти `X-Forwarded-For` (1 = nginx у контейнері platform-web) */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  return raw === undefined || raw.trim() === '' ? 1 : Number(raw);
}
