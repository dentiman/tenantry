import { CLIENT_EVENTS } from '@saas-skeleton/contracts';
import { getSocket, type AppSocket } from '../../realtime/socket';
import { emitChatEvent } from './chat-socket';

type SubscriptionSocket = Pick<AppSocket, 'on' | 'connected'> & Parameters<typeof emitChatEvent>[2];

export interface ConversationWatcher {
  /** Тримати розмову «переглядуваною»; повернена функція відпускає утримання */
  watch: (conversationId: string) => () => void;
}

/**
 * Облік розмов, які ЗАРАЗ відкриті на екрані, і їхні підписки на сервері
 * (`chat.subscribe.v1`, docs/chat.md §4.8.2).
 *
 * Лічильник посилань на розмову: першу підписку шле перше утримання, відписку — останнє
 * відпускання, але з відкладенням на один такт. Без відкладення `StrictMode` (монтаж →
 * розмонтаж → монтаж) і швидке перемикання вкладок давали б пару «відписка, підписка» на
 * рівному місці.
 *
 * На КОЖНЕ `connect` усе утримуване підписується знову, не розбираючи `socket.recovered`:
 * підписка ідемпотентна, а розбиратися, чи відновила сесія room-и, дорожче за повтор.
 * Відмова чи таймаут підписки ковтаються: екран без підписки втрачає лише індикатор
 * набору інших, повідомлення йдуть особистими room-ами незалежно від неї.
 */
export function createConversationWatcher(socket: SubscriptionSocket): ConversationWatcher {
  const refs = new Map<string, number>();
  const subscribed = new Set<string>();
  const releases = new Map<string, ReturnType<typeof setTimeout>>();

  const subscribe = (conversationId: string): void => {
    void emitChatEvent(CLIENT_EVENTS.chatSubscribe, { conversationId }, socket);
  };

  socket.on('connect', () => {
    for (const conversationId of subscribed) {
      subscribe(conversationId);
    }
  });

  return {
    watch(conversationId) {
      refs.set(conversationId, (refs.get(conversationId) ?? 0) + 1);
      const pending = releases.get(conversationId);
      if (pending !== undefined) {
        clearTimeout(pending);
        releases.delete(conversationId);
      }
      if (!subscribed.has(conversationId)) {
        subscribed.add(conversationId);
        subscribe(conversationId);
      }

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const left = (refs.get(conversationId) ?? 1) - 1;
        refs.set(conversationId, left);
        if (left > 0) {
          return;
        }
        releases.set(
          conversationId,
          setTimeout(() => {
            releases.delete(conversationId);
            if ((refs.get(conversationId) ?? 0) > 0) {
              return;
            }
            refs.delete(conversationId);
            subscribed.delete(conversationId);
            void emitChatEvent(CLIENT_EVENTS.chatUnsubscribe, { conversationId }, socket);
          }, 0),
        );
      };
    },
  };
}

let watcher: ConversationWatcher | null = null;

/** Спільний спостерігач застосунку на єдиному сокеті; створюється при першому зверненні */
export function watchConversation(conversationId: string): () => void {
  watcher ??= createConversationWatcher(getSocket() as unknown as SubscriptionSocket);
  return watcher.watch(conversationId);
}
