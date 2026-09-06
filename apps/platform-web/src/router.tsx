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
import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { AppLayout } from './components/app-layout';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { TenantsPage } from './pages/tenants';
import { TenantDetailPage } from './pages/tenant-detail';
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

/** Картка тенанта: окремий роут, як `/users/$userId` у tenant-адмінці */
const tenantDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tenants/$tenantId',
  component: TenantDetailPage,
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
  component: () => <NotFoundPage homeTo="/" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([tenantsRoute, tenantDetailRoute, jobsRoute, notFoundRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
