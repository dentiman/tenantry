import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { JobQuerySchema } from '@saas-skeleton/contracts';
import { useAuthStore } from './stores/auth.store';
import { AppLayout } from './components/app-layout';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { TenantsPage } from './pages/tenants';
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
  if (useAuthStore.getState().operator) {
    // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/' });
  }
}

function requireAuth(): void {
  if (!useAuthStore.getState().operator) {
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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppLayout,
});

const tenantsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: TenantsPage,
});

// Стан списку живе в URL — той самий патерн, що був у tenant-web до MT-3
// (.catch() — невалідні значення з URL тихо падають у дефолт, не в помилку роута)
const JobsSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  queue: z.string().trim().optional().catch(undefined),
  state: JobQuerySchema.shape.state.catch(undefined),
  sortBy: JobQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: JobQuerySchema.shape.sortOrder.catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці jobs — runtime-форму гарантує validateSearch */
export type JobsSearch = z.infer<typeof JobsSearchSchema>;

const jobsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/jobs',
  validateSearch: (search) => JobsSearchSchema.parse(search),
  component: JobsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([tenantsRoute, jobsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
