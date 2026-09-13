import {
  Global,
  Inject,
  Logger,
  Module,
  type FactoryProvider,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { resolveRedisUrl } from './redis.config';
import { REDIS_CLIENT, REDIS_THROTTLER_CLIENT } from './redis.constants';

function createClient(name: string, options: RedisOptions): Redis {
  const logger = new Logger(name);
  const client = new Redis(resolveRedisUrl(), {
    retryStrategy: (times): number => Math.min(times * 200, 5_000),
    ...options,
  });

  // Без цього обробника ioredis кидає unhandled 'error' і валить процес —
  // відмова брокера не має права зупиняти REST/auth
  client.on('error', (error: Error) => {
    logger.warn(`Redis connection error: ${error.message}`);
  });

  return client;
}

/**
 * Один клієнт Valkey на процес. Adapter Socket.IO дублює його САМ для блокуючого
 * XREAD (`duplicateClient` усередині пакета), тому presence і adapter спокійно
 * ділять цей інстанс — блокуюча команда не займе конекшн, на якому виконуються
 * presence-скрипти.
 */
const redisClientProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis =>
    createClient('Redis', {
      // Команда не має висіти вічно: недоступний брокер мусить швидко перетворитись
      // на явну помилку (→ presence degraded), а не в підвислий HTTP-запит
      maxRetriesPerRequest: 3,
    }),
};

const redisThrottlerClientProvider: FactoryProvider<Redis> = {
  provide: REDIS_THROTTLER_CLIENT,
  useFactory: (): Redis =>
    createClient('RedisThrottler', {
      // Fail-open throttler-а: при розриві команда мусить впасти одразу, а не
      // чекати відновлення з'єднання в черзі
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    }),
};

/**
 * Valkey як спільний ресурс процесу (AUTH-0). До цього клієнт жив у RealtimeModule,
 * а RealtimeModule імпортує AuthModule — throttler auth-шару, попросивши той самий
 * токен, отримав би цикл модулів.
 */
@Global()
@Module({
  providers: [redisClientProvider, redisThrottlerClientProvider],
  exports: [REDIS_CLIENT, REDIS_THROTTLER_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_THROTTLER_CLIENT) private readonly throttlerRedis: Redis,
  ) {}

  /**
   * Глобальні модулі мають `distance = MAX`, а `callShutdownHook` обходить модулі
   * у зворотному порядку — тож цей хук іде ПІСЛЯ drain leases у PresenceService і
   * зливу LastSeenWriter, і конекшн закривається останнім. `quit` дочекається вже відправлених команд; помилку ковтаємо —
   * процес усе одно зупиняється.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.redis, this.throttlerRedis].map(closeQuietly));
  }
}

async function closeQuietly(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
