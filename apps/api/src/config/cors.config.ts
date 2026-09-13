/**
 * Allowlist веб-походжень — ОДИН список на HTTP-CORS і Socket.IO `allowRequest`
 * (AUTH-0, FR-008). Два окремі списки рано чи пізно розійшлися б, і браузер
 * отримав би HTTP, але не сокет (або навпаки) без жодної помилки на старті.
 *
 * `CORS_ALLOWED_ORIGINS` — основна змінна; `REALTIME_ALLOWED_ORIGINS` лишається
 * фолбеком, щоб наявні середовища (docker/deploy.env) не зламались при оновленні.
 */
export const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173';

export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseOrigins(
    env.CORS_ALLOWED_ORIGINS ?? env.REALTIME_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS,
  );
}
