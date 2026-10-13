import { createHmac, timingSafeEqual } from 'node:crypto';
import { NormalizedEventSchema, type NormalizedEvent } from '@saas-skeleton/contracts';
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
}
