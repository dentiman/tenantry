import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { REALTIME_PATH } from '@saas-skeleton/contracts';
import type { RealtimeConfig } from './realtime.config';

/**
 * WebSocket-адаптер Nest із двома змінами проти дефолтного `IoAdapter`:
 * multi-node fan-out через Redis Streams і жорсткий websocket-only транспорт.
 *
 * Adapter потрібен НАВІТЬ при `replicas: 1`, і це не запас на майбутнє:
 *  1. `order: start-first` у swarm означає, що під час КОЖНОГО деплою два таски
 *     `api` співіснують десятки секунд — без брокера половина клієнтів опиниться
 *     в іншому процесі саме тоді, коли всі перепідключаються;
 *  2. `worker` — окремий контейнер без HTTP: без брокера в нього немає жодного
 *     способу дістати socket (це і буде міст `realtime.dispatch` у RT-3);
 *  3. `docker service scale api=N` має лишатись операційним рішенням, а не
 *     міграцією архітектури.
 *
 * Redis Streams, а не classic pub/sub adapter: стрім переживає тимчасовий розрив
 * із брокером і дочитує пропущені пакети з offset-у, тоді як pub/sub їх просто губить.
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RealtimeIoAdapter.name);

  constructor(
    app: INestApplicationContext,
    private readonly config: RealtimeConfig,
    private readonly redis: Redis,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const allowedOrigins = new Set(this.config.allowedOrigins);

    const server: unknown = super.createIOServer(port, {
      ...options,
      path: REALTIME_PATH,
      // Polling вимкнено свідомо: у swarm балансує Docker VIP по TCP-зʼєднанню,
      // і cookie-affinity там нема кому виставляти, а Redis adapter Engine.IO-сесію
      // між тасками не переносить. Ціна — клієнти за проксі, що ріжуть WebSocket,
      // лишаються без realtime (REST у них працює як завжди).
      transports: ['websocket'],
      cors: { origin: this.config.allowedOrigins, credentials: true },
      allowRequest: (
        req: IncomingMessage,
        callback: (err: string | null | undefined, success: boolean) => void,
      ) => {
        const origin = req.headers.origin;
        // Origin відсутній у не-браузерних клієнтів (інтеграційні тести, серверні
        // споживачі) — для них це не сигнал: заголовок все одно підробний.
        // Перевірка захищає від чужої СТОРІНКИ в браузері, де Origin проставляє
        // сам браузер; справжня автентифікація — JWT у handshake, вона обовʼязкова завжди.
        const allowed = origin === undefined || allowedOrigins.has(origin);
        if (!allowed) {
          this.logger.warn(`Rejected socket handshake from origin ${origin}`);
        }
        callback(null, allowed);
      },
      connectionStateRecovery:
        this.config.recoveryMs > 0
          ? {
              maxDisconnectionDuration: this.config.recoveryMs,
              // ОБОВʼЯЗКОВО false: інакше заблокований юзер відновив би сесію
              // без повторної перевірки isActive — recovery стала б обходом auth
              skipMiddlewares: false,
            }
          : undefined,
      adapter: createAdapter(this.redis, {
        streamName: `${this.config.keyPrefix}:sio:stream`,
        sessionKeyPrefix: `${this.config.keyPrefix}:sio:session:`,
        // Стрім обмежений: presence-трафік не має права зʼїсти памʼять брокера
        maxLen: 10_000,
        // Дефолт — 5 с. Стільки ж триває вихід процесу: `quit` чекає на вже
        // відправлений блокуючий XREAD. При `stop-first`/`stop_grace_period`
        // це прямо додається до вікна недоступності, а зайві XREAD у простої
        // коштують один round-trip на секунду.
        blockTimeInMs: 1_000,
      }),
    });

    return server;
  }
}
