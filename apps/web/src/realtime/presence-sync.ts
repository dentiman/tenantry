import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type PresenceChanged,
  type PresenceSnapshot,
} from '@saas-skeleton/contracts';
import { getPresenceGetQueryKey } from '../api/generated/api';
import { useLastSeenStore } from './last-seen.store';
import { getSocket } from './socket';

/**
 * Міст socket → TanStack Query. Snapshot присутності живе в кеші запитів, а не в
 * Zustand: це server state, і в нього є власник — `GET /api/presence`. Socket лише
 * ПАТЧИТЬ цей кеш, а не стає другим джерелом правди.
 *
 * Підписка реєструється один раз на застосунок (а не в хуці компонента): інакше
 * кожен монтований грід додавав би свій listener.
 */
export function initPresenceSync(queryClient: QueryClient): void {
  const socket = getSocket();
  const queryKey = getPresenceGetQueryKey();

  const resync = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  socket.on(REALTIME_EVENTS.presenceChanged, (payload: PresenceChanged) => {
    // Накладка last-seen оновлюється ДО перевірки ревізій: вона не є частиною
    // snapshot-у присутності, і навіть «зайва» (дубльована) подія несе правдивий
    // час — гірше було б його втратити через розбіжність лічильників
    const lastSeen = useLastSeenStore.getState();
    if (payload.status === 'offline') {
      if (payload.lastSeenAt) {
        lastSeen.observe(payload.userId, payload.lastSeenAt);
      }
    } else {
      lastSeen.forget(payload.userId);
    }

    const current = queryClient.getQueryData<PresenceSnapshot>(queryKey);
    if (!current) {
      // Snapshot ще не приїхав — патчити нічого; перший запит уже врахує цю зміну
      return;
    }

    // Три випадки порівняння ревізій — це і є весь протокол узгодження:
    if (payload.revision <= current.revision) {
      // дубль або переставлена подія (доставка at-most-once не гарантує унікальності
      // між нодами) — застосування зіпсувало б стан
      return;
    }
    if (payload.revision > current.revision + 1) {
      // між snapshot-ом і цією подією загубились інші: застосувати delta вже не можна,
      // бо невідомо, кого саме пропустили → перечитуємо повний стан
      resync();
      return;
    }

    const onlineUserIds = new Set(current.onlineUserIds);
    if (payload.status === 'online') {
      onlineUserIds.add(payload.userId);
    } else {
      onlineUserIds.delete(payload.userId);
    }
    queryClient.setQueryData<PresenceSnapshot>(queryKey, {
      ...current,
      onlineUserIds: [...onlineUserIds],
      revision: payload.revision,
    });
  });

  // Сервер сам просить перечитати (брокер лежав / recovery не вдалася)
  socket.on(REALTIME_EVENTS.resyncRequired, resync);

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети зі своєї сесії. Якщо ні —
    // ми не знаємо, що сталось за час розриву, і delta довіряти не можна
    if (!socket.recovered) {
      resync();
    }
  });
}
