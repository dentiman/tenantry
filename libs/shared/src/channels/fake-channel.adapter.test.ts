import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type NormalizedEvent } from '@saas-skeleton/contracts';
import { describeChannelAdapterContract, type AdapterFixtures } from './adapter-contract';
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

const fixtures: AdapterFixtures = {
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
