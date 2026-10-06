import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type NotificationChanged,
  type NotificationCreated,
  type NotificationSummary,
} from '@saas-skeleton/contracts';
import {
  getNotificationsFindAllQueryKey,
  getNotificationsGetSummaryQueryKey,
} from '../../../api/generated/api';
import { getSocket } from '../../realtime/socket';
import { showNotificationToast } from './notification-toast';

/**
 * Міст socket → TanStack Query для інбокса. Той самий принцип, що в presence-sync:
 * server state живе в кеші запитів, socket його ПАТЧИТЬ, а не стає другим
 * джерелом правди.
 *
 * Різниця з presence одна: тут дельти стосуються і лічильника, і списку. Список
 * ми не добудовуємо з події, а інвалідуємо — він пагінований курсором, і
 * вставляти рядок «десь у середину» накопичених сторінок було б вгадуванням.
 * Лічильник же приїжджає в події готовим, тому бейдж оновлюється миттєво.
 */
export function initNotificationSync(queryClient: QueryClient): void {
  const socket = getSocket();
  const summaryKey = getNotificationsGetSummaryQueryKey();

  const resync = (): void => {
    void queryClient.invalidateQueries({ queryKey: summaryKey });
    void queryClient.invalidateQueries({ queryKey: getNotificationsFindAllQueryKey() });
  };

  /**
   * Правило трьох ревізій — один в один із presence:
   *  - `<= current` — дубль або переставлена подія, застосування зіпсувало б стан;
   *  - `= current + 1` — рівно наступна зміна, застосовуємо;
   *  - `> current + 1` — між snapshot-ом і подією загубились інші, перечитуємо.
   *
   * Повертає true, якщо дельту можна застосовувати.
   */
  const acceptRevision = (revision: number): boolean => {
    const current = queryClient.getQueryData<NotificationSummary>(summaryKey);
    if (!current) {
      // Snapshot ще не приїхав — патчити нічого, перший запит уже врахує зміну
      return false;
    }
    if (revision <= current.revision) {
      return false;
    }
    if (revision > current.revision + 1) {
      resync();
      return false;
    }
    return true;
  };

  const applySummary = (payload: NotificationCreated | NotificationChanged): void => {
    queryClient.setQueryData<NotificationSummary>(summaryKey, {
      unreadCount: payload.unreadCount,
      newCount: payload.newCount,
      revision: payload.revision,
      generatedAt: payload.occurredAt,
    });
    // Список перечитуємо: подія несе один рядок, а порядок і пагінація — серверні
    void queryClient.invalidateQueries({ queryKey: getNotificationsFindAllQueryKey() });
  };

  socket.on(REALTIME_EVENTS.notificationCreated, (payload: NotificationCreated) => {
    if (!acceptRevision(payload.revision)) {
      return;
    }
    applySummary(payload);
    // Спливне сповіщення показуємо ТІЛЬКИ на живу подію — не після resync і не
    // на першому завантаженні: інакше при кожному reconnect юзеру вивалювалося б
    // те, що він давно бачив
    showNotificationToast(payload.notification);
  });

  // Прилітає в УСІ вкладки й на всі пристрої юзера, включно з тим, де дію
  // зробили: прочитав на ноуті — бейдж згас на телефоні
  socket.on(REALTIME_EVENTS.notificationChanged, (payload: NotificationChanged) => {
    if (acceptRevision(payload.revision)) {
      applySummary(payload);
    }
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети своєї сесії. Якщо ні —
    // невідомо, що сталось за час розриву, і дельтам довіряти не можна
    if (!socket.recovered) {
      resync();
    }
  });
}
