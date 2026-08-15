import { useMemo } from 'react';
import { usePresenceGet } from '../api/generated/api';

export interface PresenceState {
  isOnline: (userId: string) => boolean;
  /** Брокер недоступний: показувати «невідомо», а НЕ «всі offline» */
  isUnknown: boolean;
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

  return {
    isOnline: (userId) => onlineUserIds.has(userId),
    isUnknown: isError,
  };
}
