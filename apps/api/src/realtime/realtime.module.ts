import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuthModule } from '../auth/auth.module';
import { loadRealtimeConfig, type RealtimeConfig } from './realtime.config';
import { REALTIME_CONFIG, REALTIME_REDIS } from './realtime.constants';
import { realtimeRedisProvider } from './realtime-redis.provider';
import { RealtimeEmitter } from './realtime.emitter';
import { RealtimeGateway } from './realtime.gateway';
import { SocketAuthService } from './socket-auth.service';
import { LastSeenWriter } from './presence/last-seen.writer';
import { PresenceController } from './presence/presence.controller';
import { PresenceService } from './presence/presence.service';
import { PresenceStore } from './presence/presence.store';

/**
 * Realtime-шар (RT-0…RT-2). Свідомо не залежить від жодного доменного модуля:
 * коли зʼявиться потреба масштабувати socket-и окремо від REST, винесення в
 * `apps/realtime` має лишитись механічним переносом теки.
 */
@Module({
  imports: [AuthModule],
  controllers: [PresenceController],
  providers: [
    // Конфіг валідується тут, на старті процесу: помилка в REALTIME_* має
    // впасти одразу, а не проявитись розʼїханою presence за пів години
    { provide: REALTIME_CONFIG, useFactory: (): RealtimeConfig => loadRealtimeConfig() },
    realtimeRedisProvider,
    PresenceStore,
    LastSeenWriter,
    PresenceService,
    RealtimeEmitter,
    SocketAuthService,
    RealtimeGateway,
  ],
  exports: [REALTIME_CONFIG, REALTIME_REDIS, RealtimeEmitter],
})
export class RealtimeModule implements OnApplicationShutdown {
  constructor(@Inject(REALTIME_REDIS) private readonly redis: Redis) {}

  /**
   * Хуки провайдерів Nest виконує перед хуком самого модуля, тому drain leases
   * у PresenceService встигає відпрацювати до закриття конекшена. `quit` дочекається
   * уже відправлених команд; помилку ковтаємо — процес усе одно зупиняється.
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
