import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { useAuthStore } from './stores/auth.store';
import { AppLayout } from './components/app-layout';
import { LoginPage } from './pages/login';
import { RegisterPage } from './pages/register';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
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
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  validateSearch: (search) => UsersSearchSchema.parse(search),
  component: UsersPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([dashboardRoute, usersRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
