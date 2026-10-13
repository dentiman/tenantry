import { describe, expect, it, vi } from 'vitest';
import type { ChatNotifier, MessageEnvelope, MessageInboxService } from '@saas-skeleton/shared';
import { ChatNotifySubscriber } from './chat-notify.subscriber';

/**
 * Підписник лише обгортає `ChatNotifier` в `inbox.runOnce`. Сама логіка «кому і що» перевіряється
 * проти справжньої БД в API e2e (`chat-notifications.e2e-spec.ts`); тут — обв'язка й ідемпотентність.
 */

const TENANT = '7c9e6a54-2b3d-4f18-9a77-1e5c8d0b6a32';
const DATA = {
  conversationId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  viewerIds: ['44444444-4444-4444-8444-444444444444'],
};

function envelope(messageId: string): MessageEnvelope {
  return {
    messageId,
    name: 'chat.message-posted.v1',
    occurredAt: new Date().toISOString(),
    tenantId: TENANT,
    actor: { type: 'user', id: '55555555-5555-4555-8555-555555555555', label: 'Alice' },
    correlationId: messageId,
    causationId: null,
    data: DATA,
  } as unknown as MessageEnvelope;
}

function build(): {
  subscriber: ChatNotifySubscriber;
  notifyMessagePosted: ReturnType<typeof vi.fn>;
  runOnce: ReturnType<typeof vi.fn>;
  tx: unknown;
} {
  const seen = new Set<string>();
  const tx = { tx: true };
  // Як справжній: маркер на пару (messageId, consumerId); повторна доставка fn не виконує
  const runOnce = vi.fn(
    async (env: MessageEnvelope, consumer: string, fn: (tx: unknown) => Promise<void>) => {
      const key = `${env.messageId}:${consumer}`;
      if (seen.has(key)) return 'skipped';
      seen.add(key);
      await fn(tx);
      return 'processed';
    },
  );
  const inbox = { runOnce } as unknown as MessageInboxService;
  const notifyMessagePosted = vi.fn(() => Promise.resolve());
  const notifier = { notifyMessagePosted } as unknown as ChatNotifier;
  return { subscriber: new ChatNotifySubscriber(inbox, notifier), notifyMessagePosted, runOnce, tx };
}

describe('ChatNotifySubscriber', () => {
  it('викликає сповіщувач усередині runOnce з даними події', async () => {
    const { subscriber, notifyMessagePosted, runOnce, tx } = build();

    await subscriber.handle(DATA, envelope('msg-1'));

    expect(runOnce).toHaveBeenCalledWith(expect.anything(), 'chat-notify', expect.any(Function));
    expect(notifyMessagePosted).toHaveBeenCalledExactlyOnceWith(tx, DATA);
  });

  it('повторна доставка того самого конверта не викликає сповіщувач вдруге', async () => {
    const { subscriber, notifyMessagePosted } = build();

    await subscriber.handle(DATA, envelope('msg-1'));
    await subscriber.handle(DATA, envelope('msg-1'));

    expect(notifyMessagePosted).toHaveBeenCalledTimes(1);
  });

  it('помилка сповіщувача не ковтається — pg-boss зробить ретрай', async () => {
    const { subscriber, notifyMessagePosted } = build();
    notifyMessagePosted.mockRejectedValueOnce(new Error('db down'));

    await expect(subscriber.handle(DATA, envelope('msg-2'))).rejects.toThrow('db down');
  });
});
