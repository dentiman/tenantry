import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type { ChannelDeliveryService, MessageEnvelope } from '@saas-skeleton/shared';
import type { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';
import { ChannelsDeliverSubscriber } from './channels-deliver.subscriber';

const TENANT = '7c9e6a54-2b3d-4f18-9a77-1e5c8d0b6a32';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';

function envelope(tenantId: string | null = TENANT): MessageEnvelope {
  return { messageId: 'm', name: 'channels.deliver-outbound', tenantId, actor: { type: 'system' }, data: { messageId: MESSAGE } } as unknown as MessageEnvelope;
}

interface Built {
  subscriber: ChannelsDeliverSubscriber;
  deliver: ReturnType<typeof vi.fn>;
  toTenant: ReturnType<typeof vi.fn>;
}

function build(result: { updated: { messageId: string; conversationId: string }[] } | Error): Built {
  const deliver = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  const toTenant = vi.fn();
  return {
    subscriber: new ChannelsDeliverSubscriber(
      { deliver } as unknown as ChannelDeliveryService,
      { toTenant } as unknown as WorkerRealtimeEmitter,
    ),
    deliver,
    toTenant,
  };
}

describe('ChannelsDeliverSubscriber', () => {
  it('віддає повідомлення сервісу доставки й сигналить про кожну змінену пару', async () => {
    const { subscriber, deliver, toTenant } = build({ updated: [{ messageId: MESSAGE, conversationId: CONVERSATION }] });
    await subscriber.handle({ messageId: MESSAGE }, envelope());
    expect(deliver).toHaveBeenCalledExactlyOnceWith(MESSAGE);
    expect(toTenant).toHaveBeenCalledExactlyOnceWith(
      TENANT,
      REALTIME_EVENTS.chatMessageUpdated,
      expect.objectContaining({ conversationId: CONVERSATION, messageId: MESSAGE }),
    );
  });

  it('нічого не змінилось — сигналу немає', async () => {
    const { subscriber, toTenant } = build({ updated: [] });
    await subscriber.handle({ messageId: MESSAGE }, envelope());
    expect(toTenant).not.toHaveBeenCalled();
  });

  it('повторювана відмова вилітає звідси (pg-boss зробить ретрай) і сигналу не буде', async () => {
    const { subscriber, toTenant } = build(new Error('retry me'));
    await expect(subscriber.handle({ messageId: MESSAGE }, envelope())).rejects.toThrow('retry me');
    expect(toTenant).not.toHaveBeenCalled();
  });

  it('без tenantId у конверті — помилка, доставка не викликається', async () => {
    const { subscriber, deliver } = build({ updated: [] });
    await expect(subscriber.handle({ messageId: MESSAGE }, envelope(null))).rejects.toThrow(/tenantId/);
    expect(deliver).not.toHaveBeenCalled();
  });
});
