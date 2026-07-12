import { Toast } from '@heroui/react';
import { useRouterState } from '@tanstack/react-router';

const GUEST_PATHS = ['/login', '/register'];

/** Гостьові сторінки — toast знизу по центру; адмінка — верхній правий кут */
export function ToastHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const placement = GUEST_PATHS.includes(pathname) ? 'bottom' : 'top end';
  return <Toast.Provider placement={placement} />;
}
