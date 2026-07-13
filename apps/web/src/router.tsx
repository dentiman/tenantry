import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { JobStateSchema, SortOrderSchema, UserQuerySchema } from '@saas-skeleton/contracts';
import { useAuthStore } from './stores/auth.store';
import { AppLayout } from './components/app-layout';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { RegisterPage } from './pages/register';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';
import { JobsPage } from './pages/jobs';

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

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  beforeLoad: requireGuest,
  component: RegisterPage,
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
  // Той самий whitelist полів, що й на бекенді (UserQuerySchema.sortBy) — не дублюємо enum
  sortBy: UserQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: UserQuerySchema.shape.sortOrder.catch(undefined),
});

/** TSearch для useDataGridState на сторінці users — runtime-форму гарантує validateSearch */
export type UsersSearch = z.infer<typeof UsersSearchSchema>;

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  validateSearch: (search) => UsersSearchSchema.parse(search),
  component: UsersPage,
});

const JobsSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  state: JobStateSchema.optional().catch(undefined),
  queue: z.string().optional().catch(undefined),
});

const jobsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/jobs',
  validateSearch: (search) => JobsSearchSchema.parse(search),
  component: JobsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([dashboardRoute, usersRoute, jobsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
