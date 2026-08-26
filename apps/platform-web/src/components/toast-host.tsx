import { useRouterState } from '@tanstack/react-router';
import { Toaster } from '@saas-skeleton/ui/components/ui/toast';

const GUEST_PATHS = ['/login'];

/**
 * Один регіон тостів: тут тільки помилки — сповіщення це tenant-фіча, дзвінка в
 * control plane немає.
 *
 * **Знизу справа — та сама конвенція, що в `apps/web`** (2026-08-26): помилка завжди
 * про щойно зроблену дію, і людина, яка ходить між двома консолями, має шукати її в
 * одному й тому ж куті. Верхній правий кут у web зайнятий регіоном сповіщень; тут він
 * вільний, але розбіжність заради цього не варта плутанини.
 *
 * Гостьові сторінки (login) — знизу по центру: там немає ні сайдбара, ні контенту
 * праворуч, і тост під формою читається як її продовження.
 */
export function ToastHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const position = GUEST_PATHS.includes(pathname) ? 'bottom-center' : 'bottom-right';
  return <Toaster position={position} />;
}
