import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '@saas-skeleton/contracts';
import type { ChannelAdapter, ChannelCredentials } from './channel-adapter';
import type { OutboundContext } from './channel-send';

/**
 * Контракт-тести, які мусить пройти БУДЬ-ЯКИЙ адаптер (fake тут, Meta в CHAT-3a): сюди
 * входить усе, на що спирається публічний вебхук. Написані проти інтерфейсу, а не fake.
 *
 * `fixtures` — як підписати тіло цим адаптером і яке валідне тіло з одним повідомленням
 * він приймає; решта (підпис над байтами, рукостискання, отруйні тіла) перевіряється однаково.
 */
export interface AdapterFixtures {
  creds: ChannelCredentials;
  /** Заголовки для даного тіла з правильним підписом */
  sign(body: Buffer): Record<string, string>;
  /** Валідне тіло з одним повідомленням `externalMessageId` */
  messageBody(externalMessageId: string): Buffer;
  /** Тіло з двома повідомленнями */
  batchBody(ids: [string, string]): Buffer;
  /** Параметри валідного рукостискання з даним challenge */
  handshakeQuery(challenge: string): Record<string, string>;
  /**
   * Контекст відправки, яку адаптер у тесті обробить УСПІШНО (для fake — звичайний текст; для
   * справжнього — мок транспорту). Секція `send` контракту без нього пропускається.
   */
  okSend?(): OutboundContext;
}

export interface ContractOptions {
  /**
   * Чи вміє адаптер приймати вебхуки. `false` (Meta у CHAT-3a: лише вихід) пропускає секцію вхідного —
   * вона з'являється з CHAT-3b — і лишає секцію `send`, яку мусить пройти кожен адаптер.
   */
  inbound?: boolean;
}

export function describeChannelAdapterContract(
  name: string,
  make: () => { adapter: ChannelAdapter; fixtures: AdapterFixtures },
  options: ContractOptions = {},
): void {
  if (options.inbound !== false) describeInboundContract(name, make);
  describeSendContract(name, make);
}

function describeInboundContract(
  name: string,
  make: () => { adapter: ChannelAdapter; fixtures: AdapterFixtures },
): void {
  describe(`контракт адаптера: ${name}`, () => {
    const { adapter, fixtures } = make();
    const messages = (events: NormalizedEvent[]): NormalizedEvent[] =>
      events.filter((event) => event.kind === 'message');

    it('підпис над точними байтами приймається', () => {
      const body = fixtures.messageBody('m-1');
      expect(adapter.verifyWebhook({ headers: fixtures.sign(body), body }, fixtures.creds)).toBe(
        true,
      );
    });

    it('змінений байт — підпис недійсний', () => {
      const body = fixtures.messageBody('m-1');
      const headers = fixtures.sign(body);
      const altered = Buffer.from(body);
      const at = altered.length - 2;
      altered.writeUInt8(altered.readUInt8(at) ^ 0x01, at);
      expect(adapter.verifyWebhook({ headers, body: altered }, fixtures.creds)).toBe(false);
    });

    it('перевидане JSON (інші пробіли) з підписом оригіналу — недійсне', () => {
      const body = fixtures.messageBody('m-1');
      const headers = fixtures.sign(body);
      const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2));
      expect(reserialised.equals(body)).toBe(false);
      expect(adapter.verifyWebhook({ headers, body: reserialised }, fixtures.creds)).toBe(false);
    });

    it('без підпису, з порожнім чи чужим секретом — false, а не виняток', () => {
      const body = fixtures.messageBody('m-1');
      expect(adapter.verifyWebhook({ headers: {}, body }, fixtures.creds)).toBe(false);
      expect(
        adapter.verifyWebhook(
          { headers: fixtures.sign(body), body },
          { ...fixtures.creds, appSecret: null },
        ),
      ).toBe(false);
      expect(
        adapter.verifyWebhook(
          { headers: fixtures.sign(body), body },
          { ...fixtures.creds, appSecret: 'another-secret' },
        ),
      ).toBe(false);
    });

    it('рукостискання: правильний токен повертає challenge, неправильний — null', () => {
      expect(adapter.handshake(fixtures.handshakeQuery('abc123'), fixtures.creds)).toBe('abc123');
      expect(
        adapter.handshake(fixtures.handshakeQuery('abc123'), {
          ...fixtures.creds,
          verifyToken: 'other',
        }),
      ).toBeNull();
      expect(adapter.handshake({}, fixtures.creds)).toBeNull();
    });

    it('валідне тіло дає повідомлення з id провайдера', () => {
      const result = adapter.parseWebhook(fixtures.messageBody('m-42'));
      expect(result.error).toBeUndefined();
      const [event] = messages(result.events);
      expect(event).toMatchObject({ kind: 'message', externalMessageId: 'm-42' });
    });

    it('батч дає всі події в порядку тіла', () => {
      const result = adapter.parseWebhook(fixtures.batchBody(['a', 'b']));
      expect(
        messages(result.events).map((e) => (e.kind === 'message' ? e.externalMessageId : null)),
      ).toEqual(['a', 'b']);
    });

    it('порожнє, не-JSON і чуже тіло: помилка в результаті, без винятку й без подій', () => {
      for (const raw of ['', 'not json at all', '[1,2,3]', '{"unrelated":true}']) {
        const result = adapter.parseWebhook(Buffer.from(raw));
        expect({
          raw,
          events: messages(result.events),
          failed: result.error !== undefined,
        }).toEqual({
          raw,
          events: [],
          failed: true,
        });
      }
    });
  });
}

function describeSendContract(
  name: string,
  make: () => { adapter: ChannelAdapter; fixtures: AdapterFixtures },
): void {
  describe(`контракт адаптера (send): ${name}`, () => {
    const { adapter, fixtures } = make();

    it('успішна відправка повертає непорожній id провайдера', async () => {
      if (!fixtures.okSend) return;
      const { externalId } = await adapter.send(fixtures.okSend(), fixtures.creds);
      expect(externalId.length).toBeGreaterThan(0);
    });

    it('оголошує ліміт довжини тексту, шаблони, хто вирішує вікно — і саме вікно (або його відсутність)', () => {
      expect(adapter.capabilities.maxTextLength).toBeGreaterThan(0);
      expect(typeof adapter.capabilities.templates).toBe('boolean');
      expect(['local', 'provider']).toContain(adapter.capabilities.windowEnforcement);
      const window = adapter.capabilities.freeformWindowHours;
      expect(window === undefined || window > 0).toBe(true);
    });
  });
}
