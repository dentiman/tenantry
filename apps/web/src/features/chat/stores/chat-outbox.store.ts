import { create } from 'zustand';

/** Репліка, яку вже видно на екрані, але сервер її ще не підтвердив */
export interface OutboxMessage {
  clientMessageId: string;
  body: string;
  state: 'sending' | 'failed';
  createdAt: string;
  /** `INTERNAL` — нотатка колегам у клієнтській розмові; повтор мусить лишитись нотаткою (CHAT-2b) */
  visibility: 'PUBLIC' | 'INTERNAL';
}

interface ChatOutboxState {
  /** conversationId → надіслані, але ще не підтверджені репліки (у порядку надсилання) */
  pending: Record<string, OutboxMessage[]>;
  enqueue: (
    conversationId: string,
    body: string,
    clientMessageId: string,
    visibility?: OutboxMessage['visibility'],
  ) => void;
  markFailed: (conversationId: string, clientMessageId: string) => void;
  markSending: (conversationId: string, clientMessageId: string) => void;
  /** Сервер підтвердив — рядок зникає звідси і зʼявляється у стрічці з кеша */
  resolve: (conversationId: string, clientMessageId: string) => void;
  discard: (conversationId: string, clientMessageId: string) => void;
}

/**
 * Вихідні репліки, яких ще немає на сервері.
 *
 * Чому окремий стор, а не оптимістичний запис у кеш TanStack Query (design.md D8):
 * стрічка перечитується (фокус вікна, надсилання, довантаження сторінки), і
 * будь-який refetch ЗАМІНИВ БИ оптимістичний рядок серверною відповіддю — разом
 * із ненадісланим текстом. Тут вони живуть поза кешем, домальовуються ПІСЛЯ
 * останньої серверної сторінки і зникають лише тоді, коли сервер підтвердив.
 *
 * Заразом це готує `0.2`: коли стрічку почне патчити сокет, патчити доведеться
 * тільки кеш — черга вихідних до нього не входить і нічого не зламає.
 *
 * У памʼяті, не в localStorage: недоставлена репліка не має воскресати в іншій
 * вкладці як «чернетка», а `clientMessageId` після перезавантаження нічого не
 * зшиває — на сервері його вже або прийняли, або ні.
 */
export const useChatOutboxStore = create<ChatOutboxState>()((set) => ({
  pending: {},

  enqueue: (conversationId, body, clientMessageId, visibility = 'PUBLIC') => {
    set((state) => ({
      pending: {
        ...state.pending,
        [conversationId]: [
          ...(state.pending[conversationId] ?? []),
          {
            clientMessageId,
            body,
            state: 'sending',
            createdAt: new Date().toISOString(),
            visibility,
          },
        ],
      },
    }));
  },

  markFailed: (conversationId, clientMessageId) => {
    set((state) => ({
      pending: patch(state.pending, conversationId, clientMessageId, 'failed'),
    }));
  },

  markSending: (conversationId, clientMessageId) => {
    set((state) => ({
      pending: patch(state.pending, conversationId, clientMessageId, 'sending'),
    }));
  },

  resolve: (conversationId, clientMessageId) => {
    set((state) => ({ pending: remove(state.pending, conversationId, clientMessageId) }));
  },

  discard: (conversationId, clientMessageId) => {
    set((state) => ({ pending: remove(state.pending, conversationId, clientMessageId) }));
  },
}));

function patch(
  pending: Record<string, OutboxMessage[]>,
  conversationId: string,
  clientMessageId: string,
  state: OutboxMessage['state'],
): Record<string, OutboxMessage[]> {
  const list = pending[conversationId];
  if (!list) {
    return pending;
  }
  return {
    ...pending,
    [conversationId]: list.map((entry) =>
      entry.clientMessageId === clientMessageId ? { ...entry, state } : entry,
    ),
  };
}

function remove(
  pending: Record<string, OutboxMessage[]>,
  conversationId: string,
  clientMessageId: string,
): Record<string, OutboxMessage[]> {
  const list = pending[conversationId];
  if (!list) {
    return pending;
  }
  const next = list.filter((entry) => entry.clientMessageId !== clientMessageId);
  const { [conversationId]: _dropped, ...rest } = pending;
  return next.length > 0 ? { ...rest, [conversationId]: next } : rest;
}
