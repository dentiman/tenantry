import { createHmac, timingSafeEqual } from 'node:crypto';
import { NormalizedEventSchema, type NormalizedEvent } from '@saas-skeleton/contracts';
import { ChannelSendError, type OutboundContext } from './channel-send';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelCredentials,
  ParseResult,
  RawWebhookRequest,
} from './channel-adapter';

/** Заголовок підпису fake-провайдера: та сама форма, що в Meta (`X-Hub-Signature-256`) */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature-256';

/** `sha256=<hex>` — HMAC-SHA256 над точними байтами тіла */
export function signFakeBody(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Тіло fake-вебхука: `{ "events": [NormalizedEvent, …] }` — дзеркало нормалізованої форми */
export function buildFakeWebhookBody(events: readonly NormalizedEvent[]): string {
  return JSON.stringify({ events });
}

/**
 * Сценарій відправки задається маркером на початку тексту: `[[fake:<сценарій>]] текст`. Маркери діють
 * лише тому, що сам fake-адаптер існує тільки під `CHAT_DEV_TOOLS` (design.md D4). Без маркера —
 * успіх із id `fake-out-<messageId>`.
 */
const FAKE_SCENARIO = /^\[\[fake:([a-z-]+)\]\]/;

/**
 * Fake-провайдер: детермінований, без мережі. Єдина мета — обкатати ВЕСЬ публічний шлях
 * (підпис над сирими байтами, сире сховище, відповіді 200/401, ingest) без акаунта провайдера.
 * Підпис справжній, тому перевіряється саме той код, що буде для Meta (design.md D1).
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly provider = 'fake' as const;
  readonly type = 'WHATSAPP' as const;
  readonly capabilities: ChannelCapabilities = { freeformWindowHours: 24, maxTextLength: 4096 };

  verifyWebhook(req: RawWebhookRequest, creds: ChannelCredentials): boolean {
    const secret = creds.appSecret;
    const header = req.headers[FAKE_SIGNATURE_HEADER];
    if (!secret || !header) return false;

    const expected = Buffer.from(signFakeBody(secret, req.body));
    const received = Buffer.from(header);
    // Різна довжина — timingSafeEqual кинув би; це теж просто «не збіглося»
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  handshake(
    query: Readonly<Record<string, string | undefined>>,
    creds: ChannelCredentials,
  ): string | null {
    if (query['hub.mode'] !== 'subscribe') return null;
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!token || !challenge || token !== creds.verifyToken) return null;
    return challenge;
  }

  parseWebhook(raw: Buffer): ParseResult {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      return { events: [], error: 'invalid_json' };
    }

    const list: unknown =
      typeof json === 'object' && json !== null ? (json as { events?: unknown }).events : undefined;
    if (!Array.isArray(list)) return { events: [], error: 'missing_events' };

    // Те, що ядро ще не вміє, зберігається як `unsupported`, а не відкидається мовчки
    const events = (list as unknown[]).map((item): NormalizedEvent => {
      const parsed = NormalizedEventSchema.safeParse(item);
      return parsed.success
        ? parsed.data
        : {
            kind: 'unsupported',
            channelExternalId: null,
            reason: 'invalid_event',
            providerMeta: {},
          };
    });
    return { events };
  }

  // Облікові дані fake-провайдеру не потрібні: він нічого не автентифікує
  async send(ctx: OutboundContext, _creds?: ChannelCredentials): Promise<{ externalId: string }> {
    const scenario = FAKE_SCENARIO.exec(ctx.body)?.[1];
    switch (scenario) {
      case 'window':
        throw new ChannelSendError('WINDOW_CLOSED', '131047', 'Re-engagement message required');
      case 'permanent':
        throw new ChannelSendError('PERMANENT', '131026', 'Recipient cannot receive this message');
      case 'policy':
        throw new ChannelSendError('POLICY', '131049', 'Not delivered to maintain engagement');
      case 'ratelimit':
        throw new ChannelSendError('RATE_LIMITED', '130429', 'Rate limit hit', 1);
      case 'auth':
        throw new ChannelSendError('AUTH', '190', 'Access token is invalid or expired');
      case 'human':
        throw new ChannelSendError('HUMAN', '131031', 'Account locked');
      case 'transient':
        throw new ChannelSendError('TRANSIENT', '131000', 'Something went wrong');
      case 'transient-once':
        if (ctx.attempt === 1) {
          throw new ChannelSendError('TRANSIENT', '131000', 'Something went wrong');
        }
        break;
      case 'slow':
        // Чекає на таймаут відправки: перевіряє, що ядро справді його задає і що адаптер його поважає
        await new Promise<void>((_, reject) => {
          const abort = (): void => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          };
          if (ctx.signal.aborted) abort();
          else ctx.signal.addEventListener('abort', abort, { once: true });
        });
        break;
      default:
        break;
    }
    return { externalId: `fake-out-${ctx.messageId}` };
  }
}
