import {
  Global,
  Inject,
  Logger,
  Module,
  type FactoryProvider,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { resolveRedisUrl } from './redis.config';
import { REDIS_THROTTLER_CLIENT } from './redis.constants';

/**
 * Valkey для platform-api (AUTH-2, R-15 — другий споживач throttler-а). На відміну
 * від apps/api тут немає realtime-гейтвея й presence, тому клієнт рівно один —
 * під лічильники throttler-а, без offline-черги (fail-open потребує швидкої помилки).
 */
const redisThrottlerClientProvider: FactoryProvider<Redis> = {
  provide: REDIS_THROTTLER_CLIENT,
  useFactory: (): Redis => {
    const logger = new Logger('RedisThrottler');
    const client = new Redis(resolveRedisUrl(), {
      retryStrategy: (times): number => Math.min(times * 200, 5_000),
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    // Без цього обробника ioredis кидає unhandled 'error' і валить процес —
    // відмова брокера не має права зупиняти логін оператора
    client.on('error', (error: Error) => {
      logger.warn(`Redis connection error: ${error.message}`);
    });
    return client;
  },
};

@Global()
@Module({
  providers: [redisThrottlerClientProvider],
  exports: [REDIS_THROTTLER_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_THROTTLER_CLIENT) private readonly throttlerRedis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.throttlerRedis.quit();
    } catch {
      this.throttlerRedis.disconnect();
    }
  }
}
