import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type {
  ChannelIngestService,
  IngestOutcome,
  MessageEnvelope,
  MessagePublisher,
} from '@saas-skeleton/shared';
import type { TenantTransactions } from '@saas-skeleton/database';
import type { MessageInboxService } from '@saas-skeleton/shared';
import type { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';
import { ChannelsIngestSubscriber } from './channels-ingest.subscriber';

/**
 * Підписник розбирає збережений вебхук лише через `ChannelIngestService` усередині
 * `inbox.runOnce`, а сигнал скриньці віддає ПІСЛЯ коміту. Сам ingest перевіряється проти
 * справжньої БД в API e2e (`chat-channels-ingest.e2e-spec.ts`); тут — лише обв'язка.
 */

const TENANT = '7c9e6a54-2b3d-4f18-9a77-1e5c8d0b6a32';
const EVENT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';

function envelope(messageId: string, tenantId: string | null = TENANT): MessageEnvelope {
  return {
    messageId,
    name: 'channels.ingest-webhook',
    occurredAt: new Date().toISOString(),
    tenantId,
    actor: { type: 'system' },
    correlationId: messageId,
    causationId: null,
    data: { eventId: EVENT },
  } as unknown as MessageEnvelope;
}

interface Built {
  subscriber: ChannelsIngestSubscriber;
  ingestEvent: ReturnType<typeof vi.fn>;
  toTenant: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  order: string[];
}

function build(outcome: IngestOutcome): Built {
  const order: string[] = [];
  const hooks: (() => void)[] = [];
  const seen = new Set<string>();

  const inbox = {
    // Як справжній: маркер на пару (messageId, consumerId); повторна доставка fn не виконує
    runOnce: vi.fn(async (env: MessageEnvelope, consumer: string, fn: (tx: unknown) => Promise<void>) => {
      const key = `${env.messageId}:${consumer}`;
      if (seen.has(key)) return 'skipped';
      seen.add(key);
      order.push('fn:start');
      await fn({});
      order.push('commit');
      hooks.splice(0).forEach((hook) => {
        hook();
      });
      return 'processed';
    }),
  } as unknown as MessageInboxService;
  const transactions = {
    onCommit: vi.fn((_tx: unknown, hook: () => void) => hooks.push(hook)),
  } as unknown as TenantTransactions;
  const ingestEvent = vi.fn(() => {
    order.push('ingest');
    return Promise.resolve(outcome);
  });
  const toTenant = vi.fn(() => {
    order.push('emit');
  });
  const ingest = { ingestEvent } as unknown as ChannelIngestService;
  const realtime = { toTenant } as unknown as WorkerRealtimeEmitter;
  const publish = vi.fn(() => {
    order.push('publish');
    return Promise.resolve();
  });
  const messages = { publish } as unknown as MessagePublisher;

  return {
    subscriber: new ChannelsIngestSubscriber(inbox, transactions, ingest, realtime, messages),
    ingestEvent,
    toTenant,
    publish,
    order,
  };
}

const MESSAGE = '33333333-3333-4333-8333-333333333333';
const stored: IngestOutcome = {
  stored: 1,
  changedConversationIds: [CONVERSATION],
  storedMessages: [{ conversationId: CONVERSATION, messageId: MESSAGE }],
  updatedMessages: [],
  state: 'PROCESSED',
};

describe('ChannelsIngestSubscriber', () => {
  it('віддає збережену подію ingest-у всередині runOnce', async () => {
    const { subscriber, ingestEvent } = build(stored);
    await subscriber.handle({ eventId: EVENT }, envelope('m-1'));
    expect(ingestEvent).toHaveBeenCalledTimes(1);
    expect(ingestEvent.mock.calls[0]?.[1]).toBe(EVENT);
  });

  it('сигнал скриньці йде у room тенанта лише після коміту, без повідомлення в payload', async () => {
    const { subscriber, toTenant, order } = build(stored);
    await subscriber.handle({ eventId: EVENT }, envelope('m-2'));

    expect(order).toEqual(['fn:start', 'ingest', 'publish', 'commit', 'emit']);
    expect(toTenant).toHaveBeenCalledWith(
      TENANT,
      REALTIME_EVENTS.chatInboxChanged,
      expect.objectContaining({ conversationId: CONVERSATION }),
    );
    const payload = toTenant.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['conversationId', 'occurredAt']);
  });

  it('нічого не збережено (дублікат, нероутоване) — сигналу немає', async () => {
    const { subscriber, toTenant } = build({
      stored: 0,
      changedConversationIds: [],
      storedMessages: [],
      updatedMessages: [],
      state: 'UNROUTABLE',
      error: 'unknown_channel',
    });
    await subscriber.handle({ eventId: EVENT }, envelope('m-3'));
    expect(toTenant).not.toHaveBeenCalled();
  });

  it('повторна доставка того самого повідомлення не викликає ingest удруге', async () => {
    const { subscriber, ingestEvent, toTenant } = build(stored);
    await subscriber.handle({ eventId: EVENT }, envelope('m-4'));
    await subscriber.handle({ eventId: EVENT }, envelope('m-4'));
    expect(ingestEvent).toHaveBeenCalledTimes(1);
    expect(toTenant).toHaveBeenCalledTimes(1);
  });

  it('публікує подію для сповіщень рівно по одній на збережене повідомлення, у транзакції', async () => {
    const { subscriber, publish } = build(stored);
    await subscriber.handle({ eventId: EVENT }, envelope('m-6'));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[2]).toEqual({ conversationId: CONVERSATION, messageId: MESSAGE });
  });

  it('квитанція змінила стан — сигнал message-updated після коміту; сигналу скриньці немає', async () => {
    const { subscriber, toTenant, publish, order } = build({
      stored: 0,
      changedConversationIds: [],
      storedMessages: [],
      updatedMessages: [{ conversationId: CONVERSATION, messageId: MESSAGE }],
      state: 'PROCESSED',
    });
    await subscriber.handle({ eventId: EVENT }, envelope('m-7'));
    expect(publish).not.toHaveBeenCalled();
    expect(order).toEqual(['fn:start', 'ingest', 'commit', 'emit']);
    expect(toTenant).toHaveBeenCalledExactlyOnceWith(
      TENANT,
      REALTIME_EVENTS.chatMessageUpdated,
      expect.objectContaining({ conversationId: CONVERSATION, messageId: MESSAGE }),
    );
  });

  it('команда без tenantId — помилка постановки, ingest не викликається', async () => {
    const { subscriber, ingestEvent } = build(stored);
    await expect(subscriber.handle({ eventId: EVENT }, envelope('m-5', null))).rejects.toThrow(/tenantId/);
    expect(ingestEvent).not.toHaveBeenCalled();
  });
});
