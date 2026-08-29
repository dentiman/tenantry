import { useMemo } from 'react';
import { usePresenceGet } from '../api/generated/api';
import { useLastSeenStore } from './last-seen.store';

export interface PresenceState {
  isOnline: (userId: string) => boolean;
  /** Брокер недоступний: показувати «невідомо», а НЕ «всі offline» */
  isUnknown: boolean;
  /**
   * Останній момент присутності: ПІЗНІШЕ з двох — значення з рядка юзера
   * (фетч списку) і того, що приїхало socket-дельтою. Саме максимум, а не
   * «дельта важливіша»: рефетч списку інакше відкотив би щойно отриманий час.
   */
  lastSeenAt: (userId: string, fromRow: string | null | undefined) => string | null;
}

/**
 * Читання presence. Свідомо не тримає власного стану і не підписується на socket:
 * підписка живе в `initPresenceSync` (одна на застосунок), а тут — лише читання
 * того самого кешу запиту.
 */
export function usePresence(): PresenceState {
  const { data, isError } = usePresenceGet({
    query: {
      // Актуальність тримає socket-delta, а не поллінг: refetch тут був би
      // саме тим, від чого realtime мав позбавити
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      // Presence недоступна → одразу показуємо «невідомо», без ретраїв і тостів
      retry: false,
      meta: { silentError: true },
    },
  });

  const onlineUserIds = useMemo(() => new Set(data?.onlineUserIds ?? []), [data?.onlineUserIds]);
  // Підписка на накладку саме тут: інакше рядок не перемалювався б у мить,
  // коли юзер щойно вийшов, і показував би час, застарілий на весь час сесії
  const observed = useLastSeenStore((s) => s.byUser);

  return {
    isOnline: (userId) => onlineUserIds.has(userId),
    isUnknown: isError,
    lastSeenAt: (userId, fromRow) => {
      const seen = observed[userId];
      if (!fromRow) {
        return seen ?? null;
      }
      if (!seen) {
        return fromRow;
      }
      return new Date(seen) > new Date(fromRow) ? seen : fromRow;
    },
  };
}
