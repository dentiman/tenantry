import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app-shell/app.routes';
import { requireGuest } from './auth.guards';
import { LoginPage } from './pages/login';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});
