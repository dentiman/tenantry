import { Toast } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import {
  clearNotificationToasts,
  notificationQueue,
  type NotificationToastContent,
} from '../../realtime/notification-toast';
import { useNotificationUiStore } from '../../stores/notification-ui.store';
import { NotificationCard } from './notification-card';

/**
 * Тип черги виводиться з самого `Toast` — щоб не імпортувати `QueuedToast` з
 * react-aria-components, який у застосунку не є прямою залежністю.
 */
type QueuedNotificationToast = Parameters<typeof Toast<NotificationToastContent>>[0]['toast'];

/**
 * Спливне сповіщення. Всередині — ТА САМА `NotificationCard`, що й рядок у центрі:
 * те, що щойно спливло збоку, лежить у панелі тим самим бабликом (як у macOS).
 *
 * Керування тут рівно одне — круглий × ліворуч угорі: тост це короткий сигнал із
 * двома результатами (відкрити центр або прибрати з екрана). Дії над станом
 * (прочитано/архів) живуть у центрі, де видно весь список.
 *
 * Власне оформлення `.toast` гаситься (`bg-transparent!` тощо): фон, рамку, радіус
 * і тінь малює картка, інакше вийшов би баблик у баблику.
 */
export function NotificationToastItem({ toast }: { toast: QueuedNotificationToast }) {
  const { t } = useTranslation('notifications');
  const openPanel = useNotificationUiStore((s) => s.openPanel);
  const { notification } = toast.content;

  return (
    <Toast toast={toast} className="bg-transparent! p-0! shadow-none!">
      <NotificationCard
        notification={notification}
        className="w-full"
        // Без лінків на сутність: уся картка тут — одна ціль кліку «відкрити центр»
        plain
        onOpen={() => {
          openPanel();
          clearNotificationToasts();
        }}
        // Хрестик у тості лише ховає його: стан рядка не міняється, сповіщення
        // лишається непрочитаним у центрі
        onClose={() => {
          notificationQueue.close(toast.key);
        }}
        closeLabel={t('dismiss')}
      />
    </Toast>
  );
}
