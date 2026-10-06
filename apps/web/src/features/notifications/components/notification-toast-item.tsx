import { useTranslation } from 'react-i18next';
import { Toast, ToastContent, useToastManager } from '@saas-skeleton/ui/components/ui/toast';
import {
  clearNotificationToasts,
  notificationManager,
  type NotificationToastData,
} from '../realtime/notification-toast';
import { useNotificationUiStore } from '../stores/notification-ui.store';
import { NotificationCard } from './notification-card';

/**
 * Список спливних сповіщень. Рендериться всередині власного `ToastProvider`
 * (див. `ToastHost`), тому `useToastManager()` віддає саме його чергу.
 *
 * Всередині кожного тоста — ТА САМА `NotificationCard`, що й рядок у центрі:
 * те, що щойно спливло збоку, лежить у панелі тим самим бабликом (як у macOS).
 * Керування тут рівно одне — круглий × ліворуч угорі: тост це короткий сигнал із
 * двома результатами (відкрити центр або прибрати з екрана). Дії над станом
 * (прочитано/архів) живуть у центрі, де видно весь список.
 *
 * Оформлення самого тоста погашене класами на `Toast`/`ToastContent` (фон, рамку,
 * тінь і відступи малює картка, інакше вийшов би баблик у баблику). Попередня
 * версія робила це `!`-важливостями поверх чужих стилів — тут ми володіємо
 * композицією, тому вони не потрібні.
 */
export function NotificationToastList() {
  const { t } = useTranslation('notifications');
  const openPanel = useNotificationUiStore((s) => s.openPanel);
  const { toasts } = useToastManager<NotificationToastData>();

  return toasts.map((toastItem) => {
    const notification = toastItem.data?.notification;
    if (!notification) {
      return null;
    }
    return (
      <Toast
        key={toastItem.id}
        toast={toastItem}
        anchor="top"
        className="border-0 bg-transparent shadow-none"
      >
        <ToastContent className="p-0">
          <NotificationCard
            notification={notification}
            className="w-full"
            // Без лінків на сутність: уся картка тут — одна ціль кліку «відкрити центр»
            plain
            floating
            onOpen={() => {
              openPanel();
              clearNotificationToasts();
            }}
            // Хрестик у тості лише ховає його: стан рядка не міняється, сповіщення
            // лишається непрочитаним у центрі
            onClose={() => {
              notificationManager.close(toastItem.id);
            }}
            closeLabel={t('dismiss')}
          />
        </ToastContent>
      </Toast>
    );
  });
}
