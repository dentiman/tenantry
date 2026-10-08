import { createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { requireAuth } from '../features/auth/auth.guards';
import { ToastHost } from '../components/toast-host';
import { AppShell } from './app-shell';
import { isUnder } from '@saas-skeleton/ui/navigation';

/**
 * `/jobs` жив у корені до появи area-навігації, тепер живе під `/operations`.
 * Дзеркало `LEGACY_WORKSPACE_PREFIXES` у web: тимчасова сумісність, не частина
 * архітектури (орієнтир зняття — кінець 2026).
 *
 * `searchStr` обов'язковий — стан гріда (фільтри, сторінка, сортування) живе в
 * URL, і редірект без нього викидав би оператора на порожній список.
 */
export const LEGACY_JOBS_PREFIX = '/jobs';

export const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    if (isUnder(location.pathname, LEGACY_JOBS_PREFIX)) {
      // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        href: `/operations${location.pathname}${location.searchStr}`,
        replace: true,
      });
    }
  },
  // ToastHost тут, а не в main.tsx: placement залежить від роуту (адмінка/гостьові)
  component: () => (
    <>
      <Outlet />
      <ToastHost />
    </>
  ),
});

/**
 * Гейт сесії і каркас консолі. Pathless (`id`, а не `path`), бо префікс задає
 * вже area — дзеркало `apps/web`.
 *
 * `notFoundComponent` тут, а не в корені: 404 усередині area малюється
 * ВСЕРЕДИНІ шела (рейл і панель area лишаються на місці).
 */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  // Лямбда, а не `beforeLoad: requireAuth`: прямий референс замикає вивід типів
  beforeLoad: (ctx) => {
    requireAuth(ctx);
  },
  component: AppShell,
  notFoundComponent: () => <NotFoundPage homeTo="/tenants" />,
});

/** Корінь консолі — це area Tenants, окремої сторінки на `/` немає */
export const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants', replace: true });
  },
});

/**
 * Неіснуючий роут ПОЗА будь-якою area (`/nonsense`). Свідомо splat-роут ПІД
 * `appRoute`, а не `notFoundComponent` кореня: так 404 проходить той самий
 * гейт `beforeLoad: requireAuth` — оператор бачить сторінку всередині шела,
 * гість летить на /login. Промахи ВСЕРЕДИНІ area ловить `notFoundComponent`
 * на `appRoute`.
 */
export const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: () => <NotFoundPage homeTo="/tenants" />,
});
