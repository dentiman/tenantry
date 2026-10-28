import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { describeChannelAdapterContract, type AdapterFixtures } from '../adapter-contract';
import { ChannelSendError, type OutboundContext } from '../channel-send';
import { createChannelAdapterRegistry } from '../channel-adapter-registry';
import { MetaGraphClient } from './graph-client';
import { MetaCloudAdapter } from './meta-cloud.adapter';
import { GraphStub, graphError, sendOk } from './testing/graph-stub';
import { statusHook } from './testing/webhook-fixtures';

const TOKEN = 'EAAG1234567890abcdefghijklmnopqrstuvwxyzTOKEN';
const stub = new GraphStub();
// Адаптер будується під час збору тестів (контракт-набір), а адреса стаба відома лише після старту:
// клієнт читає META_GRAPH_BASE_URL на кожен запит
const adapter = new MetaCloudAdapter(new MetaGraphClient({ timeoutMs: 1500 }));

beforeAll(async () => {
  process.env.META_GRAPH_BASE_URL = await stub.start();
});
afterAll(async () => {
  delete process.env.META_GRAPH_BASE_URL;
  await stub.stop();
});
afterEach(() => {
  stub.reset();
});

const creds = { appSecret: null, verifyToken: 'v', accessToken: TOKEN };

function ctx(overrides: Partial<OutboundContext> = {}): OutboundContext {
  return {
    channelExternalId: '111222333',
    to: { kind: 'phone', value: '+380 50 123 45 67' },
    messageId: '11111111-1111-4111-8111-111111111111',
    body: 'Добрий день',
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

// Контракт без секції вхідного (вона з'явиться в CHAT-3b); `send` йде проти стаба
const fixtures: AdapterFixtures = {
  creds,
  sign: () => ({}),
  messageBody: () => Buffer.from('{}'),
  batchBody: () => Buffer.from('{}'),
  handshakeQuery: () => ({}),
  okSend: () => {
    stub.route('POST', '111222333/messages', sendOk());
    return ctx();
  },
};
describeChannelAdapterContract('meta_cloud', () => ({ adapter, fixtures }), { inbound: false });

describe('MetaCloudAdapter.send', () => {
  it('текст: тіло запиту, адресат цифрами, токен лише в заголовку, id з відповіді', async () => {
    stub.route('POST', '111222333/messages', sendOk('wamid.ABC'));

    const result = await adapter.send(ctx(), creds);

    expect(result).toEqual({ externalId: 'wamid.ABC' });
    const [request] = stub.requests;
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.url).not.toContain(TOKEN);
    expect(request?.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '380501234567',
      biz_opaque_callback_data: '11111111-1111-4111-8111-111111111111',
      type: 'text',
      text: { body: 'Добрий день', preview_url: false },
    });
  });

  it('шаблон: ім’я й мова без змінних; відповідь із message_status приймається', async () => {
    stub.route('POST', '111222333/messages', {
      body: { messages: [{ id: 'wamid.TPL', message_status: 'accepted' }], contacts: [] },
    });

    const result = await adapter.send(
      ctx({ template: { name: 'hello_world', language: 'en_US' }, body: 'hello_world' }),
      creds,
    );

    expect(result.externalId).toBe('wamid.TPL');
    expect(stub.requests[0]?.body).toMatchObject({
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
    expect(JSON.stringify(stub.requests[0]?.body)).not.toContain('Добрий');
  });

  it('2xx без id повідомлення — TRANSIENT no_message_id, а не «успіх»', async () => {
    stub.route('POST', '111222333/messages', { body: { messages: [] } });
    const error = (await adapter.send(ctx(), creds).catch((e: unknown) => e)) as ChannelSendError;
    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ errorClass: 'TRANSIENT', code: 'no_message_id' });
  });

  it('помилки Meta перекладаються в класи: вікно, токен, ліміт, список отримувачів, 5xx', async () => {
    const cases: [number, number, string][] = [
      [131047, 400, 'WINDOW_CLOSED'],
      [190, 401, 'AUTH'],
      [130429, 429, 'RATE_LIMITED'],
      [131030, 400, 'PERMANENT'],
      [1, 500, 'TRANSIENT'],
    ];
    for (const [code, status, errorClass] of cases) {
      stub.reset();
      stub.route('POST', '111222333/messages', graphError(code, 'boom', status));
      const error = (await adapter.send(ctx(), creds).catch((e: unknown) => e)) as ChannelSendError;
      expect({ code, errorClass: error.errorClass }).toEqual({ code, errorClass });
      expect(error.httpStatus).toBe(status);
    }
  });

  it('без токена — AUTH no_credentials і жодного виклику', async () => {
    const error = (await adapter
      .send(ctx(), { ...creds, accessToken: null })
      .catch((e: unknown) => e)) as ChannelSendError;
    expect(error).toMatchObject({ errorClass: 'AUTH', code: 'no_credentials' });
    expect(stub.requests).toHaveLength(0);
  });

  it('скасування сигналом (таймаут доставки) — TRANSIENT', async () => {
    stub.route('POST', '111222333/messages', { delayMs: 800, body: sendOk().body });
    const controller = new AbortController();
    const pending = adapter
      .send(ctx({ signal: controller.signal }), creds)
      .catch((e: unknown) => e);
    setTimeout(() => {
      controller.abort();
    }, 50);
    const error = (await pending) as ChannelSendError;
    expect(error).toMatchObject({ errorClass: 'TRANSIENT' });
  });

  it('заявляє шаблони й провайдерське вікно', () => {
    expect(adapter.capabilities).toMatchObject({
      templates: true,
      windowEnforcement: 'provider',
      freeformWindowHours: 24,
      maxTextLength: 4096,
    });
  });
});

describe('MetaCloudAdapter.markRead (CHAT-3b3)', () => {
  const read = { channelExternalId: '111222333', externalMessageId: 'wamid.IN1', signal: new AbortController().signal };

  it('status=read з id вхідного; токен лише в заголовку', async () => {
    stub.route('POST', '111222333/messages', { body: { success: true } });

    await adapter.markRead(read, creds);

    const call = stub.requests.find((r) => r.path === '111222333/messages');
    expect(call?.body).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.IN1' });
    expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call?.url).not.toContain(TOKEN);
  });

  it('помилка Meta кидається (викликач її логує), без токена — AUTH і жодного виклику', async () => {
    stub.route('POST', '111222333/messages', graphError(131009, 'Parameter value is not valid'));
    await expect(adapter.markRead(read, creds)).rejects.toMatchObject({ code: 131009 });

    stub.reset();
    await expect(adapter.markRead(read, { ...creds, accessToken: null })).rejects.toBeInstanceOf(ChannelSendError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe('реєстр адаптерів', () => {
  it('meta_cloud є завжди, fake — лише під CHAT_DEV_TOOLS', () => {
    const without = createChannelAdapterRegistry({});
    const withTools = createChannelAdapterRegistry({ CHAT_DEV_TOOLS: 'true' });
    expect(without.providers()).toEqual(['meta_cloud']);
    expect(withTools.providers().sort()).toEqual(['fake', 'meta_cloud']);
  });
});

describe('MetaCloudAdapter webhooks (CHAT-3b1)', () => {
  const adapter = new MetaCloudAdapter();
  const creds = { appSecret: 'shh-secret', verifyToken: 'vt-123', accessToken: null };
  // Форма справжнього статусу з експорту legacy-dev (значення вигадані)
  const body = Buffer.from(
    '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"statuses":[{"id":"wamid.X","status":"sent","pricing":{"billable":true}}]}}]}]}',
  );
  const sign = (secret: string, bytes: Buffer): string =>
    `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;

  it('handshake: правильний режим і токен повертають challenge, решта — null', () => {
    const ok = { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-123', 'hub.challenge': '777' };
    expect(adapter.handshake(ok, creds)).toBe('777');
    expect(adapter.handshake({ ...ok, 'hub.verify_token': 'other' }, creds)).toBeNull();
    expect(adapter.handshake({ ...ok, 'hub.mode': 'unsubscribe' }, creds)).toBeNull();
    expect(adapter.handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-123' }, creds)).toBeNull();
  });

  it('підпис: дійсний над сирими байтами проходить; чужий секрет, зміна байта, sha1, відсутній і без секрету — ні', () => {
    const headers = (value?: string): { headers: Record<string, string>; body: Buffer } => ({ headers: value ? { 'x-hub-signature-256': value } : {}, body });
    expect(adapter.verifyWebhook(headers(sign('shh-secret', body)), creds)).toBe(true);
    expect(adapter.verifyWebhook(headers(sign('wrong', body)), creds)).toBe(false);
    expect(adapter.verifyWebhook({ headers: { 'x-hub-signature-256': sign('shh-secret', body) }, body: Buffer.concat([body, Buffer.from(' ')]) }, creds)).toBe(false);
    expect(adapter.verifyWebhook({ headers: { 'x-hub-signature': 'sha1=abcd' }, body }, creds)).toBe(false);
    expect(adapter.verifyWebhook(headers('sha256=zz'), creds)).toBe(false);
    expect(adapter.verifyWebhook(headers(), creds)).toBe(false);
    expect(adapter.verifyWebhook(headers(sign('shh-secret', body)), { ...creds, appSecret: null })).toBe(false);
  });

  it('розбір: справжня форма статусу дає подію status; не-JSON — invalid_json', () => {
    const real = Buffer.from(statusHook({ id: 'wamid.X', status: 'delivered', opaque: 'our-id' }));
    expect(adapter.parseWebhook(real).events).toMatchObject([{ kind: 'status', status: 'delivered', opaqueId: 'our-id' }]);
    expect(adapter.parseWebhook(Buffer.from('not json'))).toEqual({ events: [], error: 'invalid_json' });
  });
});
