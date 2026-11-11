import { createRouter } from '@tanstack/react-router';
import { RouteError, RoutePending } from '@saas-skeleton/ui/components/route-fallbacks';
import { reportError } from '@saas-skeleton/ui/lib/report-error';
import type { RouteAccess } from './features/auth/auth.access';
import { appIndexRoute, appRoute, notFoundRoute, rootRoute } from './app-shell/app.routes';
import { loginRoute } from './features/auth/auth.routes';
import {
  tenantAccessRoute,
  tenantDetailRoute,
  tenantOverviewRoute,
  tenantUsersRoute,
  tenantsIndexRoute,
  tenantsRoute,
} from './features/tenants/tenants.routes';
import {
  operationsIndexRoute,
  operationsJobsRoute,
  operationsQueuesRoute,
  operationsRoute,
} from './features/messaging/messaging.routes';
import { operationsChannelEventsRoute } from './features/chat/chat.routes';
import {
  aiCostsRoute,
  aiIndexRoute,
  aiPricesRoute,
  aiRoute,
  aiSettingsRoute,
} from './features/ai/ai.routes';
import {
  userSettingsAppearanceRoute,
  userSettingsProfileRoute,
  userSettingsRoute,
} from './features/account/account.routes';

/**
 * Composition root маршрутів (docs/modules.md §7.4): визначення живуть у теках модулів
 * (`features/<модуль>/<модуль>.routes.tsx`, оболонка — `app-shell/app.routes.tsx`), а тут лише
 * збирається дерево — рядок на модуль.
 */
const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    appIndexRoute,
    tenantsRoute.addChildren([
      tenantsIndexRoute,
      tenantDetailRoute.addChildren([tenantOverviewRoute, tenantAccessRoute, tenantUsersRoute]),
    ]),
    operationsRoute.addChildren([
      operationsIndexRoute,
      operationsJobsRoute,
      operationsQueuesRoute,
      operationsChannelEventsRoute,
    ]),
    aiRoute.addChildren([aiIndexRoute, aiSettingsRoute, aiCostsRoute, aiPricesRoute]),
    userSettingsRoute.addChildren([userSettingsProfileRoute, userSettingsAppearanceRoute]),
    notFoundRoute,
  ]),
]);

/**
 * Політика ледачого завантаження — одна на всі маршрути (docs/frontend/lazy-loading.md):
 * - `defaultPreload: 'intent'` — чанк (і loader) стартує на hover/focus/touchstart посилання,
 *   до кліку; сам клік тоді майже миттєвий;
 * - `defaultPendingMs`/`defaultPendingMinMs` — скелет з'являється лише якщо перехід триває
 *   довше 300 мс і тоді тримається не менше 300 мс: швидкі переходи не мигають, а повільні
 *   не виглядають зависанням (до цього стара сторінка лишається на місці);
 * - спільні `RoutePending`/`RouteError` — на роутах їх не оголошуємо;
 * - `defaultOnCatch` — кожна помилка межі роута йде в `reportError` (єдина точка для Sentry,
 *   `src/lib/error-reporting.ts`); у production роутер сам її не логує.
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  defaultOnCatch: (error) => {
    reportError({ error, source: 'route' });
  },
});

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
    /** Хто може відкрити сторінку — дзеркало `apps/web/src/router.tsx` */
    access?: RouteAccess;
  }
}
