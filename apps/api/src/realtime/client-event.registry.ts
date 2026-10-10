import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import type {
  ClientEventAck,
  ClientEventErrorCode,
  ClientSocketEventDef,
} from '@saas-skeleton/contracts';
import type { z } from 'zod';
import { SocketEventError } from './realtime.errors';
import type { TenantSocket } from './realtime.types';

/** Що отримує обробник: перевірена identity і розібраний payload — не сира подія */
export interface ClientEventContext<D extends ClientSocketEventDef> {
  readonly socket: TenantSocket;
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
  readonly payload: z.output<D['payload']>;
}

export type ClientEventHandler<D extends ClientSocketEventDef> = (
  context: ClientEventContext<D>,
) => Promise<z.input<D['ack']>> | z.input<D['ack']>;

export interface ClientEventOptions {
  /** Ліміт на ОДИН сокет у фіксованому вікні; за замовчуванням — `DEFAULT_RATE_LIMIT` */
  readonly rateLimit?: { readonly limit: number; readonly windowMs: number };
}

const DEFAULT_RATE_LIMIT = { limit: 20, windowMs: 10_000 } as const;

interface RegisteredEvent {
  readonly definition: ClientSocketEventDef;
  readonly handler: ClientEventHandler<ClientSocketEventDef>;
  readonly rateLimit: { readonly limit: number; readonly windowMs: number };
}

interface Window {
  count: number;
  startedAt: number;
}

/** Мінімальний погляд на сокет: імена подій тут динамічні, типізований `on` їх не приймає */
interface LooseSocket {
  on(event: string, listener: (raw: unknown, ack?: unknown) => void): unknown;
}

/**
 * Реєстр подій client → server (docs/realtime.md, docs/modules.md §7.2) — вхідний двійник
 * `defineSocketEvent`. Фіча оголошує подію в контрактах і реєструє обробник зі свого
 * `onModuleInit`; realtime робить усе, що не має права бути забутим:
 *
 *   ліміт частоти → валідація payload-у → tenant-контекст → обробник → ack.
 *
 * Чому не `@SubscribeMessage`: Nest прив'язує такі обробники, коли ініціалізується гейтвей,
 * а модулі реєструють свої пізніше й у невідомому порядку. Тут `attach(socket)` вішає
 * `socket.on(…)` на КОЖНЕ зʼєднання окремо, тож порядку реєстрації для нього не існує.
 * Другий `@WebSocketGateway` на тому самому namespace теж не варіант: він удруге поставив би
 * auth-middleware, а валідацію, ack і ліміт довелося б дублювати в кожній фічі.
 *
 * Ліміт рахується в памʼяті процесу: websocket живе на одній репліці весь свій вік, тож
 * облік «на сокет» точний без Valkey. Ціна — reconnect дає свіжий бюджет; handshake уже
 * автентифікований, а події дешеві, тому ліміт на рукостискання — окрема справа.
 */
@Injectable()
export class ClientEventRegistry {
  private readonly logger = new Logger(ClientEventRegistry.name);
  private readonly events = new Map<string, RegisteredEvent>();
  private readonly windows = new WeakMap<TenantSocket, Map<string, Window>>();

  constructor(private readonly tenantContext: TenantContextService) {}

  /** Двічі те саме імʼя — помилка зборки модулів: впаде на старті, а не тихо перепише обробник */
  register<D extends ClientSocketEventDef>(
    definition: D,
    handler: ClientEventHandler<D>,
    options: ClientEventOptions = {},
  ): void {
    if (this.events.has(definition.name)) {
      throw new Error(`Client socket event "${definition.name}" is already registered`);
    }
    this.events.set(definition.name, {
      definition,
      handler,
      rateLimit: options.rateLimit ?? DEFAULT_RATE_LIMIT,
    });
  }

  /** Повісити всі зареєстровані події на зʼєднання. Викликає гейтвей, перш за все інше */
  attach(socket: TenantSocket): void {
    const loose = socket as unknown as LooseSocket;
    for (const [name, event] of this.events) {
      loose.on(name, (raw, ack) => {
        // Клієнт міг не передати ack: тоді другий аргумент — не функція
        const callback =
          typeof ack === 'function'
            ? (ack as (result: ClientEventAck<unknown>) => void)
            : undefined;
        void this.dispatch(socket, name, event, raw, callback);
      });
    }
  }

  private async dispatch(
    socket: TenantSocket,
    name: string,
    event: RegisteredEvent,
    raw: unknown,
    ack: ((result: ClientEventAck<unknown>) => void) | undefined,
  ): Promise<void> {
    // Клієнт міг не передати ack (typing — «вистрілив і забув»): тоді результат просто губиться
    const respond = (result: ClientEventAck<unknown>): void => {
      ack?.(result);
    };
    const refuse = (code: ClientEventErrorCode): void => {
      respond({ ok: false, code });
    };

    // Дешева перевірка першою: потік сміттєвих payload-ів не має бути безкоштовним
    if (!this.allow(socket, name, event.rateLimit)) {
      refuse('RATE_LIMITED');
      return;
    }

    const parsed = event.definition.payload.safeParse(raw);
    if (!parsed.success) {
      refuse('INVALID_PAYLOAD');
      return;
    }

    // Identity лише з перевіреного токена сокета; клієнт не називає ні tenant, ні юзера
    const { userId, tenantId, role } = socket.data;
    try {
      const data = await this.tenantContext.runWith(
        tenantId,
        async () => await event.handler({ socket, userId, tenantId, role, payload: parsed.data }),
      );
      // Відповідь звіряється зі своєю схемою: розбіжність — баг обробника, а не клієнта
      respond({ ok: true, data: event.definition.ack.parse(data) });
    } catch (error) {
      const code = this.toCode(error);
      if (code === 'INTERNAL') {
        // Деталі лише в лог, без payload-а: у ньому може бути чужий контент
        this.logger.error(
          `Socket event ${name} failed for socket ${socket.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      refuse(code);
    }
  }

  /**
   * Сервіси чату «HTTP-подібні» й кидають Nest-винятки; тут вони перекладаються в закритий
   * перелік кодів. Усе невідоме — `INTERNAL` без деталей назовні.
   */
  private toCode(error: unknown): ClientEventErrorCode {
    if (error instanceof SocketEventError) {
      return error.code;
    }
    if (error instanceof NotFoundException) {
      return 'NOT_FOUND';
    }
    if (error instanceof ForbiddenException) {
      return 'FORBIDDEN';
    }
    if (error instanceof BadRequestException) {
      return 'INVALID_PAYLOAD';
    }
    return 'INTERNAL';
  }

  /** Фіксоване вікно на пару (сокет, подія); `WeakMap` сам забуває сокет після закриття */
  private allow(
    socket: TenantSocket,
    name: string,
    { limit, windowMs }: { limit: number; windowMs: number },
  ): boolean {
    let perEvent = this.windows.get(socket);
    if (!perEvent) {
      perEvent = new Map();
      this.windows.set(socket, perEvent);
    }

    const now = Date.now();
    const current = perEvent.get(name);
    if (!current || now - current.startedAt >= windowMs) {
      perEvent.set(name, { count: 1, startedAt: now });
      return true;
    }
    if (current.count >= limit) {
      return false;
    }
    current.count += 1;
    return true;
  }
}
