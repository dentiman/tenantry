import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { AuthUpdateSchema, REALTIME_EVENTS, TENANT_NAMESPACE } from '@saas-skeleton/contracts';
import type { AuthUpdateResult } from '@saas-skeleton/contracts';
import { AUTH_EXPIRY_WARNING_MS, sessionRoom, tenantRoom, userRoom } from './realtime.constants';
import { RealtimeAuthError, toHandshakeError } from './realtime.errors';
import { RealtimeEmitter } from './realtime.emitter';
import { SocketAuthService } from './socket-auth.service';
import { PresenceService } from './presence/presence.service';
import type { TenantNamespace, TenantSocket } from './realtime.types';

interface AuthTimers {
  warn: NodeJS.Timeout;
  hard: NodeJS.Timeout;
}

/**
 * Причини розриву, на яких Socket.IO точно знає, що клієнт пішов НАВМИСНЕ.
 * Тільки для них lease звільняється миттєво. Усе інше (`transport close`,
 * `ping timeout`, `transport error`) — невідрізнюване «мережа зникла / ноутбук
 * заснув»: там lease догорає по TTL, інакше кожен тунель у метро миготів би
 * offline→online (docs/realtime-internals.md § «Режими відмов»).
 */
const INTENTIONAL_DISCONNECTS = new Set([
  'client namespace disconnect',
  'server namespace disconnect',
]);

/**
 * Tenant-гейтвей. Живе в тій самій репліці `apps/api`, що й REST, на тому самому
 * HTTP-сервері та origin-і: окремий `apps/realtime` змусив би дублювати auth,
 * tenant-контекст, деплой і спостережуваність без жодної потреби масштабувати
 * socket-и окремо від REST. Модуль навмисно не залежить від доменних модулів,
 * тому винесення лишиться механічним.
 */
@WebSocketGateway({ namespace: TENANT_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit<TenantNamespace>, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly authTimers = new Map<string, AuthTimers>();

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly presence: PresenceService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  afterInit(namespace: TenantNamespace): void {
    this.emitter.register(namespace);

    // Middleware namespace-у, а не глобальний: перевірка мусить спрацювати ДО
    // handleConnection і, головне, ДО відновлення сесії connection state recovery
    // (skipMiddlewares: false у RealtimeIoAdapter) — інакше заблокований юзер
    // повернув би socket без повторної перевірки
    namespace.use((socket, next) => {
      this.socketAuth
        .authenticate(socket)
        .then((data) => {
          socket.data = data;
          next();
        })
        .catch((error: unknown) => {
          const authError =
            error instanceof RealtimeAuthError
              ? error
              : new RealtimeAuthError('INTERNAL', 'Realtime handshake failed');
          if (authError.code === 'INTERNAL') {
            this.logger.error(`Socket handshake failed: ${String(error)}`);
          }
          next(toHandshakeError(authError));
        });
    });

    this.logger.log(`Realtime gateway ready on namespace ${TENANT_NAMESPACE}`);
  }

  async handleConnection(socket: TenantSocket): Promise<void> {
    const { tenantId, userId, sid } = socket.data;

    // Клієнт НІКОЛИ не називає room сам — лише сервер із перевіреного payload-у
    await socket.join([tenantRoom(tenantId), userRoom(tenantId, userId), sessionRoom(tenantId, sid)]);
    this.scheduleAuthTimers(socket);

    // disconnect слухаємо самі, а не через OnGatewayDisconnect: Nest-івський хук
    // не отримує `reason`, а без нього неможливо відрізнити закриту вкладку
    // від зниклої мережі — а це різні сценарії presence.
    //
    // ГРАБЛЯ: метод-обробник НЕ можна називати `handleDisconnect`. Nest шукає його
    // на інстансі за іменем (`if (instance.handleDisconnect)`) — приватність TS тут
    // ні до чого, — підписує САМ і викликає з одним аргументом. Тоді на кожен розрив
    // приходять два виклики: спершу Nest-івський із `reason === undefined`, а вже
    // потім наш зі справжньою причиною. Перший знімав сокет із локального обліку,
    // другий не знаходив його і виходив — lease не звільнявся ніколи (спіймано живим
    // прогоном: юзер лишався online після закриття вкладки).
    socket.on('disconnect', (reason) => {
      void this.onSocketDisconnect(socket, reason);
    });

    await this.presence.onConnect(tenantId, userId, socket.id);
    this.logger.debug(
      `Socket ${socket.id} connected (user ${userId}, recovered: ${String(socket.recovered)})`,
    );
  }

  private async onSocketDisconnect(socket: TenantSocket, reason: string): Promise<void> {
    this.clearAuthTimers(socket.id);
    const { tenantId, userId } = socket.data;

    if (INTENTIONAL_DISCONNECTS.has(reason)) {
      await this.presence.onDisconnect(tenantId, userId, socket.id);
    } else {
      // Локальний облік знімаємо, lease лишаємо догорати: швидкий reconnect
      // продовжить її heartbeat-ом і offline взагалі не станеться
      this.presence.forgetSocket(tenantId, userId, socket.id);
    }
    this.logger.debug(`Socket ${socket.id} disconnected (${reason})`);
  }

  /**
   * `auth.update.v1`. Payload валідується Zod-ом рантайму — це client → server
   * повідомлення, і довіряти його формі не можна так само, як тілу HTTP-запиту.
   * Відповідь іде acknowledgement-ом: клієнт мусить знати, що новий дедлайн прийнято.
   */
  @SubscribeMessage(REALTIME_EVENTS.authUpdate)
  async handleAuthUpdate(
    @ConnectedSocket() socket: TenantSocket,
    @MessageBody() body: unknown,
  ): Promise<AuthUpdateResult> {
    const parsed = AuthUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return { status: 'rejected', code: 'INVALID_PAYLOAD' };
    }

    try {
      const previousSid = socket.data.sid;
      socket.data = await this.socketAuth.reauthenticate(socket, parsed.data.accessToken);

      // AUTH-1: токен міг приїхати від ІНШОЇ сесії того ж юзера (зміна пароля,
      // «вийти звідусіль» — сервер сам віддав вкладці нову пару). Переводимо сокет
      // у room нової сесії, інакше він лишився б у room-і вже мертвої: наступний
      // revoke нової сесії його б не порвав, а revoke старої — порвав би дарма
      if (socket.data.sid !== previousSid) {
        const { tenantId, sid } = socket.data;
        await socket.leave(sessionRoom(tenantId, previousSid));
        await socket.join(sessionRoom(tenantId, sid));
      }

      this.scheduleAuthTimers(socket);
      return { status: 'accepted', expiresAt: new Date(socket.data.expiresAtMs).toISOString() };
    } catch (error) {
      if (error instanceof RealtimeAuthError) {
        return { status: 'rejected', code: error.code };
      }
      this.logger.error(`auth.update.v1 failed for socket ${socket.id}: ${String(error)}`);
      return { status: 'rejected', code: 'INTERNAL' };
    }
  }

  /**
   * Access-токен живе 15 хвилин, socket — годинами. Без цієї пари таймерів
   * зʼєднання або рвалося б щочверть години, або (гірше) переживало б власний
   * токен: перевірка на handshake без дедлайну = автентифікація «один раз назавжди».
   */
  private scheduleAuthTimers(socket: TenantSocket): void {
    this.clearAuthTimers(socket.id);
    const msToExpiry = socket.data.expiresAtMs - Date.now();

    const warn = setTimeout(
      () => {
        socket.emit(REALTIME_EVENTS.authExpiring, {
          expiresAt: new Date(socket.data.expiresAtMs).toISOString(),
        });
      },
      Math.max(msToExpiry - AUTH_EXPIRY_WARNING_MS, 0),
    );

    const hard = setTimeout(
      () => {
        this.logger.debug(`Socket ${socket.id} closed: access token expired without update`);
        socket.disconnect(true);
      },
      Math.max(msToExpiry, 0),
    );

    this.authTimers.set(socket.id, { warn, hard });
  }

  private clearAuthTimers(socketId: string): void {
    const timers = this.authTimers.get(socketId);
    if (!timers) {
      return;
    }
    clearTimeout(timers.warn);
    clearTimeout(timers.hard);
    this.authTimers.delete(socketId);
  }
}
