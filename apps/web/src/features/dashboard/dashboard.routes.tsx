import { createRoute } from '@tanstack/react-router';
import { workspaceRoute } from '../../app-shell/app.routes';
import { DashboardPage } from './pages/dashboard';

export const dashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: DashboardPage,
});
