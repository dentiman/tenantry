import { Logger, type FactoryProvider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REALTIME_CONFIG, REALTIME_REDIS } from './realtime.constants';
import type { RealtimeConfig } from './realtime.config';

/**
 * Один клієнт Valkey на процес. Adapter Socket.IO дублює його САМ для блокуючого
 * XREAD (`duplicateClient` усередині пакета), тому presence і adapter спокійно
 * ділять цей інстанс — блокуюча команда не займе конекшн, на якому виконуються
 * presence-скрипти.
 */
export const realtimeRedisProvider: FactoryProvider<Redis> = {
  provide: REALTIME_REDIS,
  inject: [REALTIME_CONFIG],
  useFactory: (config: RealtimeConfig): Redis => {
    const logger = new Logger('RealtimeRedis');
    const client = new Redis(config.redisUrl, {
      // Команда не має висіти вічно: недоступний брокер мусить швидко перетворитись
      // на явну помилку (→ presence degraded), а не в підвислий HTTP-запит
      maxRetriesPerRequest: 3,
      retryStrategy: (times): number => Math.min(times * 200, 5_000),
    });

    // Без цього обробника ioredis кидає unhandled 'error' і валить процес —
    // відмова брокера не має права зупиняти REST/auth
    client.on('error', (error: Error) => {
      logger.warn(`Realtime broker connection error: ${error.message}`);
    });

    return client;
  },
};
