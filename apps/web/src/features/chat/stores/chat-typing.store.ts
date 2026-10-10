import { create } from 'zustand';

interface ChatTypingState {
  /** conversationId → userId → локальний дедлайн (мс), після якого індикатор гасне */
  entries: Record<string, Record<string, number>>;
  /** Імпульс «друкує»: дедлайн — момент отримання + відносний термін із сервера */
  pulse: (conversationId: string, userId: string, expiresInMs: number, now?: number) => void;
  /** Людина надіслала повідомлення — індикатор гасне одразу, не чекаючи терміну */
  clear: (conversationId: string, userId: string) => void;
  /** Прибрати прострочені; викликає лише тік індикатора, поки є що прибирати */
  prune: (now?: number) => void;
}

/**
 * Хто ЗАРАЗ друкує. Ефемерне й тільки на клієнті: сервер нічого не зберігає (docs/chat.md
 * §4.8.2), тож після перезавантаження стор порожній, і це правильно.
 *
 * Дедлайн локальний (`now + expiresInMs`), а не годинник сервера: відносний термін не
 * залежить від того, на скільки хвилин клієнтський годинник поспішає чи відстає.
 */
export const useChatTypingStore = create<ChatTypingState>()((set) => ({
  entries: {},

  pulse: (conversationId, userId, expiresInMs, now = Date.now()) => {
    set((state) => ({
      entries: {
        ...state.entries,
        [conversationId]: { ...state.entries[conversationId], [userId]: now + expiresInMs },
      },
    }));
  },

  clear: (conversationId, userId) => {
    set((state) => {
      const current = state.entries[conversationId];
      if (!current || !(userId in current)) {
        return state;
      }
      const { [userId]: _removed, ...rest } = current;
      const { [conversationId]: _conversation, ...others } = state.entries;
      return {
        entries: Object.keys(rest).length > 0 ? { ...others, [conversationId]: rest } : others,
      };
    });
  },

  prune: (now = Date.now()) => {
    set((state) => {
      let changed = false;
      const next: Record<string, Record<string, number>> = {};
      for (const [conversationId, users] of Object.entries(state.entries)) {
        const alive = Object.fromEntries(
          Object.entries(users).filter(([, deadline]) => deadline > now),
        );
        if (Object.keys(alive).length !== Object.keys(users).length) {
          changed = true;
        }
        if (Object.keys(alive).length > 0) {
          next[conversationId] = alive;
        }
      }
      return changed ? { entries: next } : state;
    });
  },
}));

/** Ідентифікатори тих, хто друкує в розмові просто зараз (прострочені відкидаються) */
export function activeTypists(
  entries: ChatTypingState['entries'],
  conversationId: string,
  now: number = Date.now(),
): string[] {
  return Object.entries(entries[conversationId] ?? {})
    .filter(([, deadline]) => deadline > now)
    .map(([userId]) => userId);
}
