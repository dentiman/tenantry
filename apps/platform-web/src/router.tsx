import { createRouter } from '@tanstack/react-router';
import { appIndexRoute, appRoute, notFoundRoute, rootRoute } from './app-shell/app.routes';
import { loginRoute } from './features/auth/auth.routes';
import {
  tenantDetailRoute,
  tenantsIndexRoute,
  tenantsRoute,
} from './features/tenants/tenants.routes';
import {
  operationsIndexRoute,
  operationsJobsRoute,
  operationsQueuesRoute,
  operationsRoute,
} from './features/messaging/messaging.routes';
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
 * Composition root маршрутів (docs/module-registries.md R3): визначення живуть у теках модулів
 * (`features/<модуль>/<модуль>.routes.tsx`, оболонка — `app-shell/app.routes.tsx`), а тут лише
 * збирається дерево — рядок на модуль.
 */
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
