import { beforeEach, describe, expect, it } from 'vitest';
import { useChatOutboxStore } from './chat-outbox.store';

/**
 * Черга вихідних реплік існує рівно заради двох властивостей (design.md D8):
 * її не здуває перечитування стрічки, і підтвердження прибирає ЛИШЕ свій рядок.
 * Обидві й перевіряємо — решта стану тримає кеш TanStack Query.
 */
describe('chat outbox store', () => {
  const conversation = 'conv-1';

  beforeEach(() => {
    useChatOutboxStore.setState({ pending: {} });
  });

  it('keeps a pending entry that no server response mentions', () => {
    const { enqueue } = useChatOutboxStore.getState();
    enqueue(conversation, 'still sending', 'cid-1');

    // Перечитування стрічки не проходить через цей стор узагалі — саме тому
    // ненадіслана репліка його переживає
    expect(useChatOutboxStore.getState().pending[conversation]).toHaveLength(1);
    expect(useChatOutboxStore.getState().pending[conversation]?.[0]?.state).toBe('sending');
  });

  it('removes exactly the confirmed entry and leaves the others', () => {
    const { enqueue, resolve } = useChatOutboxStore.getState();
    enqueue(conversation, 'first', 'cid-1');
    enqueue(conversation, 'second', 'cid-2');

    resolve(conversation, 'cid-1');

    const left = useChatOutboxStore.getState().pending[conversation];
    expect(left?.map((entry) => entry.clientMessageId)).toEqual(['cid-2']);
  });

  it('drops the conversation key once its last entry is confirmed', () => {
    const { enqueue, resolve } = useChatOutboxStore.getState();
    enqueue(conversation, 'only one', 'cid-1');

    resolve(conversation, 'cid-1');

    expect(useChatOutboxStore.getState().pending).toEqual({});
  });

  it('marks a failed send without losing its text, and allows a retry', () => {
    const { enqueue, markFailed, markSending } = useChatOutboxStore.getState();
    enqueue(conversation, 'network was down', 'cid-1');

    markFailed(conversation, 'cid-1');
    const failed = useChatOutboxStore.getState().pending[conversation]?.[0];
    expect(failed?.state).toBe('failed');
    expect(failed?.body).toBe('network was down');

    // Повтор іде з ТИМ САМИМ clientMessageId — сервер поверне той самий рядок
    markSending(conversation, 'cid-1');
    expect(useChatOutboxStore.getState().pending[conversation]?.[0]?.state).toBe('sending');
  });

  it('keeps conversations independent', () => {
    const { enqueue, resolve } = useChatOutboxStore.getState();
    enqueue('conv-a', 'a', 'cid-a');
    enqueue('conv-b', 'b', 'cid-b');

    resolve('conv-a', 'cid-a');

    expect(useChatOutboxStore.getState().pending['conv-b']).toHaveLength(1);
  });
});
