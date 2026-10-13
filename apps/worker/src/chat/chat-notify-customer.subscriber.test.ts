import { describe, expect, it, vi } from 'vitest';
import type { ChatNotifier, MessageEnvelope, MessageInboxService } from '@saas-skeleton/shared';
import type { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';
import { ChatNotifyCustomerSubscriber } from './chat-notify-customer.subscriber';

const TENANT = '7c9e6a54-2b3d-4f18-9a77-1e5c8d0b6a32';
const DATA = { conversationId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333' };
const VIEWER = '44444444-4444-4444-8444-444444444444';

function envelope(messageId: string, tenantId: string | null = TENANT): MessageEnvelope {
  return { messageId, name: 'chat.customer-message-received.v1', tenantId, actor: { type: 'system' }, data: DATA } as unknown as MessageEnvelope;
}

interface Built {
  subscriber: ChatNotifyCustomerSubscriber;
  notifyCustomerMessage: ReturnType<typeof vi.fn>;
  userIdsInRoom: ReturnType<typeof vi.fn>;
  order: string[];
}

function build(): Built {
  const order: string[] = [];
  const seen = new Set<string>();
  const userIdsInRoom = vi.fn(() => {
    order.push('viewers');
    return Promise.resolve([VIEWER]);
  });
  const runOnce = vi.fn(async (env: MessageEnvelope, consumer: string, fn: (tx: unknown) => Promise<void>) => {
    order.push('runOnce');
    const key = `${env.messageId}:${consumer}`;
    if (seen.has(key)) return 'skipped';
    seen.add(key);
    await fn({});
    return 'processed';
  });
  const notifyCustomerMessage = vi.fn(() => Promise.resolve());
  return {
    subscriber: new ChatNotifyCustomerSubscriber(
      { runOnce } as unknown as MessageInboxService,
      { notifyCustomerMessage } as unknown as ChatNotifier,
      { userIdsInRoom } as unknown as WorkerRealtimeEmitter,
    ),
    notifyCustomerMessage,
    userIdsInRoom,
    order,
  };
}

describe('ChatNotifyCustomerSubscriber', () => {
  it('питає, хто дивиться, ДО транзакції, і передає глядачів сповіщувачу', async () => {
    const { subscriber, notifyCustomerMessage, userIdsInRoom, order } = build();
    await subscriber.handle(DATA, envelope('m-1'));

    expect(order).toEqual(['viewers', 'runOnce']);
    expect(userIdsInRoom).toHaveBeenCalledWith(`tenant:${TENANT}:conversation:${DATA.conversationId}`);
    expect(notifyCustomerMessage).toHaveBeenCalledExactlyOnceWith({}, { ...DATA, viewerIds: [VIEWER] });
  });

  it('повторна доставка того самого конверта не сповіщає вдруге', async () => {
    const { subscriber, notifyCustomerMessage } = build();
    await subscriber.handle(DATA, envelope('m-2'));
    await subscriber.handle(DATA, envelope('m-2'));
    expect(notifyCustomerMessage).toHaveBeenCalledTimes(1);
  });

  it('без tenantId — помилка постановки', async () => {
    const { subscriber, notifyCustomerMessage } = build();
    await expect(subscriber.handle(DATA, envelope('m-3', null))).rejects.toThrow(/tenantId/);
    expect(notifyCustomerMessage).not.toHaveBeenCalled();
  });
});
