import { Toast } from '@heroui/react';
import { useRouterState } from '@tanstack/react-router';
import { notificationQueue } from '../realtime/notification-toast';
import { NotificationToastItem } from './notifications/notification-toast-item';

const GUEST_PATHS = ['/login'];

/**
 * Два незалежні регіони тостів.
 *
 * **Сповіщення — зверху справа**, під дзвінком: подія прилітає звідти ж, звідки
 * росте лічильник, тож око йде за нею до інбокса (той самий звʼязок, що в macOS).
 * **Помилки — знизу справа**: вони про щойно зроблену дію, і перебивати ними
 * сповіщення (як і навпаки) не можна — тому регіони різні, а не одна черга.
 *
 * Верхній регіон зміщений вниз на висоту хедера (`h-14` у AppLayout), щоб тост
 * не накривав шапку з дзвінком і меню акаунта.
 *
 * Гостьові сторінки (login) — тільки помилки, знизу по центру: socket там не
 * підключений, сповіщенням узятися нізвідки.
 */
export function ToastHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isGuest = GUEST_PATHS.includes(pathname);

  return (
    <>
      <Toast.Provider placement={isGuest ? 'bottom' : 'bottom end'} />
      {!isGuest && (
        <Toast.Provider placement="top end" queue={notificationQueue} width={380} className="mt-14">
          {({ toast }) => <NotificationToastItem toast={toast} />}
        </Toast.Provider>
      )}
    </>
  );
}
