import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { JobQuerySchema } from '@saas-skeleton/contracts';
import { TenantQuerySchema } from '@saas-skeleton/contracts/platform';
import { useAuthStore } from './stores/auth.store';
import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { AppShell } from './app-shell/app-shell';
import { isUnder } from './app-shell/paths';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { TenantsPage } from './pages/tenants';
import { TenantDetailPage } from './pages/tenant-detail';
import { JobsPage } from './pages/jobs';
import { QueuesPage } from './pages/queues';
import { AiSettingsPage } from './pages/ai-settings';
import { AiCostsPage } from './pages/ai-costs';
import { AiPricesPage } from './pages/ai-prices';
import { UserSettingsProfilePage } from './pages/user-settings/profile';
import { UserSettingsAppearancePage } from './pages/user-settings/appearance';

/**
 * `/jobs` жив у корені до появи area-навігації, тепер живе під `/operations`.
 * Дзеркало `LEGACY_WORKSPACE_PREFIXES` у web: тимчасова сумісність, не частина
 * архітектури (орієнтир зняття — кінець 2026).
 *
 * `searchStr` обов'язковий — стан гріда (фільтри, сторінка, сортування) живе в
 * URL, і редірект без нього викидав би оператора на порожній список.
 */
const LEGACY_JOBS_PREFIX = '/jobs';

const rootRoute = createRootRoute({
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

function requireGuest(): void {
  if (useAuthStore.getState().operator) {
    // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
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

/**
 * Гейт сесії і каркас консолі. Pathless (`id`, а не `path`), бо префікс задає
 * вже area — дзеркало `apps/web`.
 *
 * `notFoundComponent` тут, а не в корені: 404 усередині area малюється
 * ВСЕРЕДИНІ шела (рейл і панель area лишаються на місці).
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppShell,
  notFoundComponent: () => <NotFoundPage homeTo="/tenants" />,
});

/** Корінь консолі — це area Tenants, окремої сторінки на `/` немає */
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants', replace: true });
  },
});

/**
 * Area «Tenants» — клієнти платформи. Layout-роут без компонента: навігація
 * area живе в шелі (`app-shell/areas/tenants-sidebar.tsx`).
 */
const tenantsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tenants',
});

// Стан списку живе в URL — той самий контракт, що в /users у tenant-web
// (.catch() — невалідні значення з URL тихо падають у дефолт, не в помилку роута)
const TenantsSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Той самий whitelist полів сортування, що на бекенді (не дублюємо enum)
  sortBy: TenantQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: TenantQuerySchema.shape.sortOrder.catch(undefined),
  // В URL і в query-параметрах API фільтр їде РЯДКОМ 'true'/'false' (не reuse
  // TenantQuerySchema.shape.isActive — його transform дає boolean, а це wire-формат)
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці tenants — runtime-форму гарантує validateSearch */
export type TenantsSearch = z.infer<typeof TenantsSearchSchema>;

const tenantsIndexRoute = createRoute({
  getParentRoute: () => tenantsRoute,
  path: '/',
  validateSearch: (search) => TenantsSearchSchema.parse(search),
  component: TenantsPage,
  staticData: { layout: 'bleed' },
});

/** Картка тенанта: окремий роут — на неї дають посилання (route-id не змінився) */
const tenantDetailRoute = createRoute({
  getParentRoute: () => tenantsRoute,
  path: '$tenantId',
  component: TenantDetailPage,
});

/**
 * Area «Operations» — машинерія системи (моніторинг черг). Layout-роут без
 * компонента; навігація area — `app-shell/areas/operations-sidebar.tsx`.
 */
const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations',
});

/** `/operations` → Jobs: «домівка» area мусить щось показувати */
const operationsIndexRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/operations/jobs', replace: true });
  },
});

// Той самий патерн, що був у tenant-web до MT-3: стан списку живе в URL
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

const operationsJobsRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'jobs',
  validateSearch: (search) => JobsSearchSchema.parse(search),
  component: JobsPage,
  staticData: { layout: 'bleed' },
});

/**
 * Черги — окрема сторінка (сітка карток), а не блок над таблицею джоб: тепер
 * `/operations/jobs` — чисте `bleed`-полотно таблиці, як `/users` у tenant-web.
 */
const operationsQueuesRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'queues',
  component: QueuesPage,
});

/** Area «AI» — налаштування асистента платформи (AI-5a). Layout-роут без компонента */
const aiRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ai',
});

const aiIndexRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/ai/settings', replace: true });
  },
});

const aiSettingsRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'settings',
  component: AiSettingsPage,
});

/** AI-5b: період і розріз звіту витрат живуть в URL — посиланням можна поділитись */
export const AI_COST_PERIODS = ['this-month', 'last-month', 'last-30-days', 'last-7-days'] as const;
export const AI_COST_DIMENSIONS = ['tenant', 'model', 'kind', 'day'] as const;
const AiCostsSearchSchema = z.object({
  period: z.enum(AI_COST_PERIODS).optional().catch(undefined),
  by: z.enum(AI_COST_DIMENSIONS).optional().catch(undefined),
});
export type AiCostsSearch = z.infer<typeof AiCostsSearchSchema>;

const aiCostsRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'costs',
  validateSearch: (search) => AiCostsSearchSchema.parse(search),
  component: AiCostsPage,
});

const AiPricesSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  search: z.string().trim().max(200).optional().catch(undefined),
});
/** TFilters для DataGrid тарифів — runtime-форму гарантує validateSearch */
export type AiPricesSearch = z.infer<typeof AiPricesSearchSchema>;

const aiPricesRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'prices',
  validateSearch: (search) => AiPricesSearchSchema.parse(search),
  component: AiPricesPage,
  staticData: { layout: 'bleed' },
});

/**
 * ОСОБИСТІ налаштування — area без пункту в рейлі: вхід із дропдауна аватара.
 * Той самий URL-префікс, що в tenant-web — однакова ментальна модель для
 * людини, що ходить між двома консолями.
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

const userSettingsAppearanceRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'appearance',
  component: UserSettingsAppearancePage,
});

/**
 * Неіснуючий роут ПОЗА будь-якою area (`/nonsense`). Свідомо splat-роут ПІД
 * `appRoute`, а не `notFoundComponent` кореня: так 404 проходить той самий
 * гейт `beforeLoad: requireAuth` — оператор бачить сторінку всередині шела,
 * гість летить на /login. Промахи ВСЕРЕДИНІ area ловить `notFoundComponent`
 * на `appRoute`.
 */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: () => <NotFoundPage homeTo="/tenants" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    appIndexRoute,
    tenantsRoute.addChildren([tenantsIndexRoute, tenantDetailRoute]),
    operationsRoute.addChildren([operationsIndexRoute, operationsJobsRoute, operationsQueuesRoute]),
    aiRoute.addChildren([aiIndexRoute, aiSettingsRoute, aiCostsRoute, aiPricesRoute]),
    userSettingsRoute.addChildren([userSettingsProfileRoute, userSettingsAppearanceRoute]),
    notFoundRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }

  /**
   * Розкладка контенту — властивість РОУТУ, а не сторінки. Дзеркало
   * `apps/web/src/router.tsx` (там повне обґрунтування).
   */
  interface StaticDataRouteOption {
    layout?: 'padded' | 'bleed';
  }
}
