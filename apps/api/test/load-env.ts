import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * Тести читають ТОЙ САМИЙ кореневий `.env`, що й `pnpm api:dev`, — одне джерело адрес
 * інфраструктури (порти Postgres/Valkey) на машині.
 *
 * Навіщо явно, якщо ConfigModule застосунку й так читає `.env`: setup-env.ts рахує
 * тестові URL і дефолти ДО старту Nest, а змінна, вже присутня в `process.env`,
 * перемагає файл. Так дефолт `localhost:6379` з тестів мовчки перебивав `REDIS_URL`
 * з `.env` (Valkey на :6380), і сьюти падали з `Stream isn't writeable` замість
 * зрозумілої помилки.
 *
 * Пріоритет той самий, що в `ConfigModule` (`envFilePath`): явне оточення (CI) →
 * `.env.local` → `.env`. `process.loadEnvFile` наявні змінні не перезаписує, тому
 * файли вантажаться від найвагомішого. Файлів немає (CI) — нічого не робимо.
 */
export function loadRepoEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = join(REPO_ROOT, file);
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }
}
