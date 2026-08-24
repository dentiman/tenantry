import { useRouterState } from '@tanstack/react-router';
import { Toaster } from '@saas-skeleton/ui/components/ui/toast';

const GUEST_PATHS = ['/login'];

/** Гостьові сторінки — toast знизу по центру; консоль — верхній правий кут */
export function ToastHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const position = GUEST_PATHS.includes(pathname) ? 'bottom-center' : 'top-right';
  return <Toaster position={position} />;
}
