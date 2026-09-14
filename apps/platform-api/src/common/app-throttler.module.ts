import type { DynamicModule } from '@nestjs/common';
// Subpath-імпорт: main index libs/shared тягне pg-boss/@aws-sdk (webpack externals),
// які platform-api не потрібні (та сама причина, що з AllExceptionsFilter)
import { createAppThrottlerModule } from '@saas-skeleton/shared/auth/throttler';
import { resolveRedisKeyPrefix } from '../redis/redis.config';
import { REDIS_THROTTLER_CLIENT } from '../redis/redis.constants';

/**
 * AUTH-2 (R-15): platform-api — другий споживач `libs/shared/src/auth/throttler`.
 * Трекер загальної стелі читає `req.operator.sub`, який кладе `PlatformJwtGuard`
 * (сам guard реєструється в PlatformAuthModule ПЕРЕД `AppThrottlerGuard`).
 * Префікс ключів отримує сегмент `platform`, щоб не перетнутися з лічильниками
 * tenant-api навіть на одному Valkey з тим самим `REALTIME_KEY_PREFIX`.
 */
function operatorTracker(req: Record<string, unknown>): string {
  const operator = req.operator as { sub?: unknown } | undefined;
  return typeof operator?.sub === 'string' ? `operator:${operator.sub}` : ipOf(req);
}

function ipOf(req: Record<string, unknown>): string {
  return typeof req.ip === 'string' ? req.ip : 'unknown';
}

export const AppThrottlerModule: DynamicModule = createAppThrottlerModule({
  redisClientToken: REDIS_THROTTLER_CLIENT,
  // Функція, не рядок обчислений тут-таки — див. коментар у apps/api-дзеркалі
  keyPrefix: () => `${resolveRedisKeyPrefix()}:platform:throttle`,
  principalTracker: operatorTracker,
});
