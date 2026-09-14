import type { DynamicModule } from '@nestjs/common';
import { createAppThrottlerModule } from '@saas-skeleton/shared';
import { resolveRedisKeyPrefix } from '../redis/redis.config';
import { REDIS_THROTTLER_CLIENT } from '../redis/redis.constants';

/**
 * AUTH-0, механіка переїхала в `libs/shared/src/auth/throttler` заходом AUTH-2
 * (R-15 — platform-api став другим споживачем). Тут лишається лише те, що
 * specific tenant-api: DI-токен клієнта Redis, префікс ключів і трекер
 * загальної стелі «на користувача» (читає `req.user.sub`, який кладе
 * `JwtAuthGuard`, — сам guard реєструється в AuthModule ПІСЛЯ нього).
 */
function userTracker(req: Record<string, unknown>): string {
  const user = req.user as { sub?: unknown } | undefined;
  return typeof user?.sub === 'string' ? `user:${user.sub}` : ipOf(req);
}

function ipOf(req: Record<string, unknown>): string {
  return typeof req.ip === 'string' ? req.ip : 'unknown';
}

export const AppThrottlerModule: DynamicModule = createAppThrottlerModule({
  redisClientToken: REDIS_THROTTLER_CLIENT,
  // Функція, не рядок обчислений тут-таки: цей файл імпортується РАЗ на процес
  // (Node кешує модулі) — рядок «заморозив» би REALTIME_KEY_PREFIX зі старту
  keyPrefix: () => `${resolveRedisKeyPrefix()}:throttle`,
  principalTracker: userTracker,
});
