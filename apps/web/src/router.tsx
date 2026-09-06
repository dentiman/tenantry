import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { CustomerQuerySchema, UserQuerySchema } from '@saas-skeleton/contracts';
import { useAuthStore } from './stores/auth.store';
import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { AppShell } from './app-shell/app-shell';
import { isUnder } from './app-shell/paths';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';
import { CustomersPage } from './pages/customers';
import { CustomerDetailPage } from './pages/customer-detail';
import { UserDetailPage } from './pages/user-detail';
import { ChatPage } from './pages/chat';
import { PlaygroundPage } from './pages/playground';
import { UserSettingsProfilePage } from './pages/user-settings/profile';
import { UserSettingsAccountPage } from './pages/user-settings/account';
import { UserSettingsSecurityPage } from './pages/user-settings/security';
import { UserSettingsNotificationsPage } from './pages/user-settings/notifications';
import { UserSettingsAppearancePage } from './pages/user-settings/appearance';
import { SettingsGeneralPage } from './pages/settings/general';
import { SettingsNumberingPage } from './pages/settings/numbering';
import { SettingsActivityPage } from './pages/settings/activity';

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
const LEGACY_WORKSPACE_PREFIXES = ['/users', '/customers'];

const rootRoute = createRootRoute({
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

function requireGuest(): void {
  if (useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

function requireAuth(): void {
  if (!useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
}

/**
 * Налаштування організації редагує лише адмін — і бекенд це enforce-ить
 * (`@Roles(ADMIN)` на записі). Гейт тут не «замість» серверного, а щоб USER не
 * дивився на форми, які однаково не збережуться. Пункт area в рейлі ховає
 * `canSee` у `app-shell/areas.tsx` — це видимість, а enforcement саме тут.
 */
function requireAdmin(): void {
  const user = useAuthStore.getState().user;
  if (!user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (user.role !== 'ADMIN') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
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
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppShell,
  notFoundComponent: () => <NotFoundPage homeTo="/workspace" />,
});

/** Корінь застосунку — це area workspace, окремої сторінки на `/` немає */
const appIndexRoute = createRoute({
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
const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workspace',
});

const dashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: DashboardPage,
});

// Стан списку живе в URL — лінк можна шерити, F5 не губить пошук/сторінку.
// .catch() — невалідні значення з URL тихо падають у дефолт замість помилки роута
const UsersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  // max — дзеркало бекенда (PaginationQuerySchema): невалідний ліміт з URL падає
  // в дефолт тут, а не 400-кою на API
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Той самий whitelist полів, що й на бекенді (UserQuerySchema.sortBy) — не дублюємо enum
  sortBy: UserQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: UserQuerySchema.shape.sortOrder.catch(undefined),
  // В URL і в query-параметрах API фільтр їде РЯДКОМ 'true'/'false' (не reuse
  // UserQuerySchema.shape.isActive — його transform дає boolean, а це wire-формат)
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці users — runtime-форму гарантує validateSearch */
export type UsersSearch = z.infer<typeof UsersSearchSchema>;

const usersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users',
  validateSearch: (search) => UsersSearchSchema.parse(search),
  component: UsersPage,
});

// Той самий контракт, що в /users: стан списку живе в URL, невалідні значення
// тихо падають у дефолт замість помилки роута
const CustomersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Whitelist полів сортування — той самий, що на бекенді (не дублюємо enum)
  sortBy: CustomerQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: CustomerQuerySchema.shape.sortOrder.catch(undefined),
  status: CustomerQuerySchema.shape.status.catch(undefined),
  kind: CustomerQuerySchema.shape.kind.catch(undefined),
});

export type CustomersSearch = z.infer<typeof CustomersSearchSchema>;

const customersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers',
  validateSearch: (search) => CustomersSearchSchema.parse(search),
  component: CustomersPage,
});

/** Картка кастомера: окремий роут — на неї дають посилання в листі й у тікеті */
const customerDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers/$customerId',
  component: CustomerDetailPage,
});

/** Сторінка юзера: окремий роут, а не драйвер — на неї можна дати посилання */
const userDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users/$userId',
  component: UserDetailPage,
});

/**
 * Area «Chat». Layout + index від першого дня, хоча сторінка поки одна: на
 * layout-роуті сидітиме гейт area, а `/chat/$conversationId` додається дитиною,
 * не переписуванням. Сам роут розмови не заводимо — мертвих роутів не тримаємо.
 */
const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
});

const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatPage,
});

/**
 * Area «Settings» — налаштування ОРГАНІЗАЦІЇ. Своя area, а не розділ усередині
 * workspace: її під-розділи — повноцінне меню, і йому місце в навігаційній
 * колонці шела, а не в контенті сторінки (звідки й прибрано `SectionNav`).
 */
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: requireAdmin,
});

const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: SettingsGeneralPage,
});

const settingsNumberingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'numbering',
  component: SettingsNumberingPage,
});

const settingsActivityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'activity',
  component: SettingsActivityPage,
});

/**
 * ОСОБИСТІ налаштування — area без пункту в рейлі: вхід із дропдауна аватара, бо
 * в головній навігації словом «Settings» володіє організація (патерн
 * GitLab / Stripe / Notion, docs/settings.md). `/user-settings` = Profile
 * (індексний роут): у свої налаштування заходять найчастіше саме по профіль.
 */
const userSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/user-settings',
});

const userSettingsProfileRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: '/',
  component: UserSettingsProfilePage,
});

const userSettingsAccountRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'account',
  component: UserSettingsAccountPage,
});

const userSettingsSecurityRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'security',
  component: UserSettingsSecurityPage,
});

const userSettingsNotificationsRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'notifications',
  component: UserSettingsNotificationsPage,
});

const userSettingsAppearanceRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'appearance',
  component: UserSettingsAppearancePage,
});

/**
 * Area «Playground» — візуальні стенди примітивів UI. Layout + index: пункт поки
 * один (кнопки), наступний стенд додається роутом і рядком у
 * `app-shell/areas/playground-sidebar.tsx`.
 */
const playgroundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playground',
});

const playgroundButtonsRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: '/',
  component: PlaygroundPage,
});

/**
 * Неіснуючий роут ПОЗА будь-якою area (`/nonsense`). Свідомо splat-роут ПІД
 * `appRoute`, а не `notFoundComponent` кореня: так 404 проходить той самий гейт
 * `beforeLoad: requireAuth`, що й решта застосунку — залогінений бачить сторінку
 * всередині шела, гість летить на /login. Промахи ВСЕРЕДИНІ area (`/chat/nope`)
 * ловить `notFoundComponent` на `appRoute`.
 * Статичні й динамічні роути ранжуються вище за splat, тож нічого не перехоплює.
 */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: () => <NotFoundPage homeTo="/workspace" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    appIndexRoute,
    workspaceRoute.addChildren([
      dashboardRoute,
      usersRoute,
      userDetailRoute,
      customersRoute,
      customerDetailRoute,
    ]),
    chatRoute.addChildren([chatIndexRoute]),
    settingsRoute.addChildren([
      settingsGeneralRoute,
      settingsNumberingRoute,
      settingsActivityRoute,
    ]),
    userSettingsRoute.addChildren([
      userSettingsProfileRoute,
      userSettingsAccountRoute,
      userSettingsSecurityRoute,
      userSettingsNotificationsRoute,
      userSettingsAppearanceRoute,
    ]),
    playgroundRoute.addChildren([playgroundButtonsRoute]),
    notFoundRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
