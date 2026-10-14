import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Локальний стаб Graph API для тестів (CHAT-3a, tasks 3.5): HTTP-сервер, на який тест вказує
 * `META_GRAPH_BASE_URL`. Без мережі й без акаунта Meta. Записує кожен запит (щоб довести, що токен
 * ходить лише в заголовку) і дає підмінити відповідь будь-якого шляху. Лише для тестів.
 */

export interface StubRequest {
  method: string;
  /** Шлях без версії й query: `debug_token`, `12345`, `999/phone_numbers`, `111/messages` */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: unknown;
  /** Сирий URL, щоб перевірити, що в ньому немає токена */
  url: string;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Затримка перед відповіддю, мс (перевірка таймаутів) */
  delayMs?: number;
}

export type StubHandler = (request: StubRequest) => StubResponse | undefined;

export class GraphStub {
  readonly requests: StubRequest[] = [];
  private readonly handlers: StubHandler[] = [];
  private server: Server | null = null;

  /** Нові обробники мають пріоритет над давнішими; `undefined` — передати далі */
  on(handler: StubHandler): this {
    this.handlers.unshift(handler);
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.handlers.length = 0;
  }

  /** Метод-скорочення: відповідь на точний `METHOD path` */
  route(
    method: string,
    path: string,
    response: StubResponse | ((request: StubRequest) => StubResponse),
  ): this {
    return this.on((request) =>
      request.method === method && request.path === path
        ? typeof response === 'function'
          ? response(request)
          : response
        : undefined,
    );
  }

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      void this.handle(req).then((stub) => {
        const send = (): void => {
          res.writeHead(stub.status ?? 200, {
            'Content-Type': 'application/json',
            ...stub.headers,
          });
          res.end(JSON.stringify(stub.body ?? {}));
        };
        if (stub.delayMs) setTimeout(send, stub.delayMs);
        else send();
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
    this.server = null;
  }

  private async handle(req: IncomingMessage): Promise<StubResponse> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://stub');
    const request: StubRequest = {
      method: req.method ?? 'GET',
      path: url.pathname.replace(/^\/v[\d.]+\//, '').replace(/^\//, ''),
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
      ),
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
      url: req.url ?? '',
    };
    this.requests.push(request);
    for (const handler of this.handlers) {
      const response = handler(request);
      if (response) return response;
    }
    return {
      status: 404,
      body: { error: { message: 'No stub route', code: 100, type: 'GraphMethodException' } },
    };
  }
}

/** Стандартні відповіді «здорового» акаунта; тести підміняють потрібні шляхи поверх */
export function healthyAccountRoutes(
  stub: GraphStub,
  opts: { waba?: string; scopes?: string[]; expiresAt?: number; appId?: string } = {},
): GraphStub {
  const waba = opts.waba ?? '1000000000001';
  return stub
    .route('GET', 'debug_token', {
      body: {
        data: {
          app_id: opts.appId ?? '555000111',
          type: 'SYSTEM_USER',
          is_valid: true,
          expires_at: opts.expiresAt ?? 0,
          scopes: opts.scopes ?? [
            'whatsapp_business_management',
            'whatsapp_business_messaging',
            'business_management',
          ],
        },
      },
    })
    .route('GET', waba, {
      body: {
        id: waba,
        name: 'Test WhatsApp Business Account',
        currency: 'USD',
        health_status: { can_send_message: 'AVAILABLE' },
      },
    });
}

/** Відповідь на успішну відправку (форма з проби: `messages[0].id`; у тексту немає `message_status`) */
export function sendOk(id = 'wamid.TESTID'): StubResponse {
  return {
    body: {
      messaging_product: 'whatsapp',
      contacts: [{ input: '380501234567', wa_id: '380501234567' }],
      messages: [{ id }],
    },
  };
}

/** Відповідь-помилка Graph */
export function graphError(
  code: number,
  message = 'error',
  status = 400,
  subcode?: number,
): StubResponse {
  return {
    status,
    body: {
      error: {
        message,
        type: 'OAuthException',
        code,
        ...(subcode ? { error_subcode: subcode } : {}),
        fbtrace_id: 'TRACE',
      },
    },
  };
}
