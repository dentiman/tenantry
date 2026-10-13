import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type NormalizedEvent } from '@saas-skeleton/contracts';
import { describeChannelAdapterContract, type AdapterFixtures } from './adapter-contract';
import { ChannelSendError, classifySendFailure, type OutboundContext } from './channel-send';
import { ChannelAdapterRegistry, createChannelAdapterRegistry } from './channel-adapter-registry';
import {
  FAKE_SIGNATURE_HEADER,
  FakeChannelAdapter,
  buildFakeWebhookBody,
  signFakeBody,
} from './fake-channel.adapter';

const SECRET = 'test-signing-secret';

function message(id: string): NormalizedEvent {
  return {
    kind: 'message',
    externalMessageId: id,
    channelExternalId: 'fake-phone-1',
    from: { kind: 'phone', value: '380501234567' },
    profileName: 'Ola',
    sentAt: '2026-10-13T10:00:00.000Z',
    content: { type: 'text', body: `hello ${id}` },
    providerMeta: {},
  };
}

function sendCtx(body: string, overrides: Partial<OutboundContext> = {}): OutboundContext {
  return {
    channelExternalId: 'fake-phone-1',
    to: { kind: 'phone', value: '380501234567' },
    messageId: 'msg-1',
    body,
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const fixtures: AdapterFixtures = {
  okSend: () => sendCtx('hello'),
  creds: { appSecret: SECRET, verifyToken: 'verify-me', accessToken: null },
  sign: (body) => ({ [FAKE_SIGNATURE_HEADER]: signFakeBody(SECRET, body) }),
  messageBody: (id) => Buffer.from(buildFakeWebhookBody([message(id)])),
  batchBody: ([a, b]) => Buffer.from(buildFakeWebhookBody([message(a), message(b)])),
  handshakeQuery: (challenge) => ({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'verify-me',
    'hub.challenge': challenge,
  }),
};

describeChannelAdapterContract('fake', () => ({ adapter: new FakeChannelAdapter(), fixtures }));

describe('FakeChannelAdapter', () => {
  const adapter = new FakeChannelAdapter();

  it('подія, якої ядро не розуміє, зберігається як unsupported, а не губиться', () => {
    const body = Buffer.from(JSON.stringify({ events: [message('ok'), { kind: 'status', x: 1 }] }));
    const { events } = adapter.parseWebhook(body);
    expect(events.map((e) => e.kind)).toEqual(['message', 'unsupported']);
  });

  it('підпис різної довжини — false, не виняток', () => {
    const body = Buffer.from('{}');
    expect(adapter.verifyWebhook({ headers: { [FAKE_SIGNATURE_HEADER]: 'sha256=ab' }, body }, fixtures.creds)).toBe(
      false,
    );
  });
});

describe('NormalizedEventSchema', () => {
  it('приймає повідомлення й unsupported', () => {
    expect(NormalizedEventSchema.safeParse(message('x')).success).toBe(true);
    expect(
      NormalizedEventSchema.safeParse({ kind: 'unsupported', channelExternalId: null, reason: 'r', providerMeta: {} })
        .success,
    ).toBe(true);
  });

  it('відхиляє невідомий вид і повідомлення без id провайдера', () => {
    expect(NormalizedEventSchema.safeParse({ kind: 'status' }).success).toBe(false);
    expect(NormalizedEventSchema.safeParse({ ...message('x'), externalMessageId: '' }).success).toBe(false);
  });
});

describe('реєстр адаптерів', () => {
  it('fake реєструється лише з CHAT_DEV_TOOLS', () => {
    expect(createChannelAdapterRegistry({}).has('fake')).toBe(false);
    expect(createChannelAdapterRegistry({ CHAT_DEV_TOOLS: 'false' }).has('fake')).toBe(false);
    expect(createChannelAdapterRegistry({ CHAT_DEV_TOOLS: 'true' }).has('fake')).toBe(true);
    expect(createChannelAdapterRegistry({ CHAT_DEV_TOOLS: '1' }).get('fake')).toBeInstanceOf(FakeChannelAdapter);
  });

  it('невідомий провайдер — undefined, не виняток', () => {
    expect(new ChannelAdapterRegistry().get('nope')).toBeUndefined();
  });
});

describe('FakeChannelAdapter.send', () => {
  const adapter = new FakeChannelAdapter();
  const creds = fixtures.creds;

  it('без маркера — успіх з id від нашого messageId', async () => {
    expect(await adapter.send(sendCtx('hi', { messageId: 'abc' }), creds)).toEqual({
      externalId: 'fake-out-abc',
    });
  });

  it.each([
    ['window', 'WINDOW_CLOSED'],
    ['permanent', 'PERMANENT'],
    ['policy', 'POLICY'],
    ['ratelimit', 'RATE_LIMITED'],
    ['auth', 'AUTH'],
    ['human', 'HUMAN'],
    ['transient', 'TRANSIENT'],
  ] as const)('маркер %s дає клас %s', async (marker, errorClass) => {
    const error = await adapter.send(sendCtx(`[[fake:${marker}]] text`), creds).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect((error as ChannelSendError).errorClass).toBe(errorClass);
  });

  it('transient-once падає лише на першій спробі', async () => {
    const first = await adapter.send(sendCtx('[[fake:transient-once]] x'), creds).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(ChannelSendError);
    expect(await adapter.send(sendCtx('[[fake:transient-once]] x', { attempt: 2 }), creds)).toEqual({
      externalId: 'fake-out-msg-1',
    });
  });

  it('slow чекає на сигнал скасування і закінчується AbortError', async () => {
    const controller = new AbortController();
    const pending = adapter.send(sendCtx('[[fake:slow]]', { signal: controller.signal }), creds);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('classifySendFailure', () => {
  it('типізована помилка зберігає клас, код і затримку', () => {
    expect(classifySendFailure(new ChannelSendError('RATE_LIMITED', '130429', 'slow down', 4))).toEqual({
      errorClass: 'RATE_LIMITED',
      code: '130429',
      title: 'slow down',
      retryAfterSeconds: 4,
    });
  });

  it('звичайна помилка й таймаут — TRANSIENT', () => {
    expect(classifySendFailure(new Error('boom'))).toMatchObject({ errorClass: 'TRANSIENT', code: 'unclassified' });
    expect(classifySendFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toMatchObject({
      errorClass: 'TRANSIENT',
      code: 'timeout',
    });
    expect(classifySendFailure('string thrown')).toMatchObject({ errorClass: 'TRANSIENT' });
  });
});

describe('FakeChannelAdapter: події статусу', () => {
  const adapter = new FakeChannelAdapter();
  const status: NormalizedEvent = {
    kind: 'status',
    channelExternalId: 'fake-phone-1',
    externalMessageId: 'fake-out-1',
    opaqueId: 'msg-1',
    status: 'delivered',
    occurredAt: '2026-10-13T10:00:00.000Z',
    failure: null,
    providerMeta: {},
  };

  it('подія status разом з message в одному тілі розбирається в порядку тіла', () => {
    const { events } = adapter.parseWebhook(Buffer.from(buildFakeWebhookBody([message('m'), status])));
    expect(events.map((e) => e.kind)).toEqual(['message', 'status']);
  });

  it('невалідний статус стає unsupported, а не винятком', () => {
    const body = Buffer.from(JSON.stringify({ events: [{ ...status, status: 'teleported' }] }));
    expect(adapter.parseWebhook(body).events.map((e) => e.kind)).toEqual(['unsupported']);
  });
});
