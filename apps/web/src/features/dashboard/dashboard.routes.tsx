import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { workspaceRoute } from '../../app-shell/app.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const DashboardPage = lazyPage(() => import('./pages/dashboard'), 'DashboardPage');

export const dashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: DashboardPage,
});
