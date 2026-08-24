import { useRouterState } from '@tanstack/react-router';
import {
  Toaster,
  ToastPortal,
  ToastProvider,
  ToastViewport,
} from '@saas-skeleton/ui/components/ui/toast';
import { notificationManager } from '../realtime/notification-toast';
import { NotificationToastList } from './notifications/notification-toast-item';

const GUEST_PATHS = ['/login'];

/**
 * Два незалежні регіони тостів.
 *
 * **Сповіщення — зверху справа**, під дзвінком: подія прилітає звідти ж, звідки
 * росте лічильник, тож око йде за нею до інбокса (той самий звʼязок, що в macOS).
 * **Помилки — знизу справа**: вони про щойно зроблену дію, і перебивати ними
 * сповіщення (як і навпаки) не можна — тому регіони різні, а не одна черга.
 *
 * Помилки рендерить `Toaster` реєстру (дефолтний менеджер `toast`), а сповіщення
 * складені вручну з тих самих частин — їм потрібен власний менеджер і власний
 * вміст (`NotificationCard` замість заголовка з описом). Верхній регіон зміщений
 * вниз на висоту хедера (`h-14` у AppLayout), щоб тост не накривав шапку.
 *
 * Гостьові сторінки (login) — тільки помилки, знизу по центру: socket там не
 * підключений, сповіщенням узятися нізвідки.
 */
export function ToastHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isGuest = GUEST_PATHS.includes(pathname);

  return (
    <>
      <Toaster position={isGuest ? 'bottom-center' : 'bottom-right'} />
      {!isGuest && (
        <ToastProvider toastManager={notificationManager} limit={1}>
          <ToastPortal>
            <ToastViewport position="top-right" className="mt-14 max-w-[380px]">
              <NotificationToastList />
            </ToastViewport>
          </ToastPortal>
        </ToastProvider>
      )}
    </>
  );
}
