import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { Outlet, createRootRoute, createRoute, redirect } from '@tanstack/react-router';
import { ToastHost } from '../components/toast-host';
import { requireAuth } from '../features/auth/auth.guards';
import { AppShell } from './app-shell';
import { isUnder } from './paths';

/**
 * Шляхи, які до появи area-навігації лежали в корені, а тепер живуть під
 * `/workspace`. Зовнішні посилання і закладки юзерів на них уже існують, тож
 * один нормалізатор у корені дешевший за дублюючі роути на кожен старий шлях.
 *
 * `href`, а не `to`: джерело — довільний старий рядок, типізації тут не буде.
 * `searchStr` обовʼязковий — стан гріда (фільтри, сторінка, сортування) живе в
 * URL, і редірект без нього викидав би юзера на порожній список.
 *
 * Тимчасова сумісність, не частина архітектури: видалити, коли старі посилання
 * протухнуть (орієнтир — кінець 2026).
 */
export const LEGACY_WORKSPACE_PREFIXES = ['/users', '/customers'];

export const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    if (LEGACY_WORKSPACE_PREFIXES.some((prefix) => isUnder(location.pathname, prefix))) {
      // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        href: `/workspace${location.pathname}${location.searchStr}`,
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
 * Гейт сесії і каркас застосунку. Pathless (`id`, а не `path`), бо префікс
 * задає вже area — див. `docs/frontend/app-shell.md`.
 *
 * `notFoundComponent` тут, а не в корені: так 404 усередині area (напр.
 * `/settings/nope`) малюється ВСЕРЕДИНІ шела — рейл і панель area лишаються на
 * місці, тож із помилки видно, куди йти далі. Гість сюди не доходить: гейт
 * `beforeLoad` відправляє його на /login.
 */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppShell,
  notFoundComponent: () => <NotFoundPage homeTo="/workspace" />,
});

/** Корінь застосунку — це area workspace, окремої сторінки на `/` немає */
export const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace', replace: true });
  },
});

/**
 * Area «Workspace» — робоча частина застосунку. Layout-роут без компонента:
 * TanStack Router рендерить `Outlet` сам, а вся навігація area живе в шелі
 * (`app-shell/areas/workspace-sidebar.tsx`).
 */
export const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workspace',
});

/**
 * Неіснуючий роут ПОЗА будь-якою area (`/nonsense`). Свідомо splat-роут ПІД
 * `appRoute`, а не `notFoundComponent` кореня: так 404 проходить той самий гейт
 * `beforeLoad: requireAuth`, що й решта застосунку — залогінений бачить сторінку
 * всередині шела, гість летить на /login. Промахи ВСЕРЕДИНІ area (`/chat/nope`)
 * ловить `notFoundComponent` на `appRoute`.
 * Статичні й динамічні роути ранжуються вище за splat, тож нічого не перехоплює.
 */
export const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: () => <NotFoundPage homeTo="/workspace" />,
});
