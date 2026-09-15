import type { ConfigService } from '@nestjs/config';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:5173';

/**
 * AUTH-3: базовий URL tenant-web для лінків у листах. Поза env.schema.ts свідомо —
 * листи не блокують старт воркера відсутністю необов'язкового налаштування (T097).
 */
export function resolveAppPublicUrl(config: ConfigService): string {
  const raw = config.get<string>('APP_PUBLIC_URL', DEFAULT_APP_PUBLIC_URL);
  return raw.replace(/\/+$/, '');
}
