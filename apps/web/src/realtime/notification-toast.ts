import { createToastManager } from '@saas-skeleton/ui/components/ui/toast';
import type { NotificationResponseDtoOutput } from '../api/generated/model/notificationResponseDtoOutput';
import { useNotificationUiStore } from '../stores/notification-ui.store';

/** Вміст тоста — сам рядок сповіщення: тост і картка в центрі рендеряться однаково */
export interface NotificationToastData {
  notification: NotificationResponseDtoOutput;
}

/**
 * Спливне сповіщення в стилі macOS: приїжджає збоку, показує ТІЛЬКИ щойно
 * отримане, само зникає, по кліку відкриває центр сповіщень.
 *
 * Окрема черга, а не спільна з тостами помилок: у них різна семантика і різне
 * місце на екрані. Сповіщення — «сталася подія» (зверху справа, під дзвінком),
 * помилка — «щось пішло не так із твоєю дією» (знизу справа). Спільна черга
 * змушувала б їх витісняти одне одного.
 */
export const notificationManager = createToastManager<NotificationToastData>();

/**
 * Id попереднього тоста. `limit={1}` на провайдері лише ХОВАЄ зайві (`data-limited`) —
 * вони чекають, поки верхній закриється. Нам потрібно інакше: попереднє не «пізніше»,
 * а більше не актуальне, тому закриваємо його явно.
 */
let lastId: string | null = null;

const TOAST_TIMEOUT_MS = 6_000;

export function showNotificationToast(notification: NotificationResponseDtoOutput): void {
  // Панель відкрита — юзер уже дивиться на інбокс, дублювати подію тостом означало б
  // перекривати нею ж таки список
  if (useNotificationUiStore.getState().isPanelOpen) {
    return;
  }

  if (lastId) {
    notificationManager.close(lastId);
  }

  lastId = notificationManager.add({
    data: { notification },
    timeout: TOAST_TIMEOUT_MS,
    onClose: () => {
      lastId = null;
    },
  });
}

/** Закрити всі спливні сповіщення (напр. коли юзер пішов у центр) */
export function clearNotificationToasts(): void {
  // close() без id закриває всі тости цього менеджера
  notificationManager.close();
  lastId = null;
}
