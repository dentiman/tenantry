import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { loadRealtimeConfig, type RealtimeConfig } from './realtime.config';
import { REALTIME_CONFIG } from './realtime.constants';
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
    // Клієнт Valkey — з глобального RedisModule (AUTH-0: спільний і з throttler-ом)
    PresenceStore,
    LastSeenWriter,
    PresenceService,
    RealtimeEmitter,
    SocketAuthService,
    RealtimeGateway,
  ],
  exports: [REALTIME_CONFIG, RealtimeEmitter],
})
export class RealtimeModule {}
