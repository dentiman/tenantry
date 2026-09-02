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
import { AppLayout } from './components/app-layout';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';
import { CustomersPage } from './pages/customers';
import { CustomerDetailPage } from './pages/customer-detail';
import { UserDetailPage } from './pages/user-detail';
import { PlaygroundPage } from './pages/playground';
import { UserSettingsLayout } from './pages/user-settings/layout';
import { UserSettingsProfilePage } from './pages/user-settings/profile';
import { UserSettingsAccountPage } from './pages/user-settings/account';
import { UserSettingsSecurityPage } from './pages/user-settings/security';
import { UserSettingsNotificationsPage } from './pages/user-settings/notifications';
import { UserSettingsAppearancePage } from './pages/user-settings/appearance';
import { SettingsLayout } from './pages/settings/layout';
import { SettingsGeneralPage } from './pages/settings/general';
import { SettingsNumberingPage } from './pages/settings/numbering';
import { SettingsActivityPage } from './pages/settings/activity';

const rootRoute = createRootRoute({
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
    // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/' });
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
 * дивився на форми, які однаково не збережуться.
 */
function requireAdmin(): void {
  const user = useAuthStore.getState().user;
  if (!user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (user.role !== 'ADMIN') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
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
  getParentRoute: () => appRoute,
  path: '/users',
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
  getParentRoute: () => appRoute,
  path: '/customers',
  validateSearch: (search) => CustomersSearchSchema.parse(search),
  component: CustomersPage,
});

/** Картка кастомера: окремий роут — на неї дають посилання в листі й у тікеті */
const customerDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/customers/$customerId',
  component: CustomerDetailPage,
});

/** Сторінка юзера: окремий роут, а не драйвер — на неї можна дати посилання */
const userDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users/$userId',
  component: UserDetailPage,
});

/**
 * ОСОБИСТІ налаштування. `/user-settings` = Profile (індексний роут): у свої
 * налаштування заходять найчастіше саме по профіль, і зайвий редірект тут ні до
 * чого. Словом `settings` без кваліфікатора володіє ОРГАНІЗАЦІЯ — патерн
 * GitLab / Stripe / Notion (docs/settings.md).
 */
const userSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/user-settings',
  component: UserSettingsLayout,
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
 * Налаштування ОРГАНІЗАЦІЇ — окремий розділ, а не вкладка в особистих:
 * компанійські лишаються компанії, особисті йдуть за людиною (docs/settings.md).
 */
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: requireAdmin,
  component: SettingsLayout,
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

const playgroundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playground',
  component: PlaygroundPage,
});

/**
 * Неіснуючий роут. Свідомо НЕ `notFoundComponent` кореня, а splat-роут ПІД `appRoute`:
 * так 404 проходить той самий гейт `beforeLoad: requireAuth`, що й решта застосунку —
 * залогінений бачить сторінку всередині layout-а (сайдбар/хедер на місці), гість
 * летить на /login замість того, щоб дивитись на 404 у порожньому вікні.
 * Статичні й динамічні роути ранжуються вище за splat, тож нічого не перехоплює.
 */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: NotFoundPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    usersRoute,
    userDetailRoute,
    customersRoute,
    customerDetailRoute,
    userSettingsRoute.addChildren([
      userSettingsProfileRoute,
      userSettingsAccountRoute,
      userSettingsSecurityRoute,
      userSettingsNotificationsRoute,
      userSettingsAppearanceRoute,
    ]),
    settingsRoute.addChildren([
      settingsGeneralRoute,
      settingsNumberingRoute,
      settingsActivityRoute,
    ]),
    playgroundRoute,
    notFoundRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
