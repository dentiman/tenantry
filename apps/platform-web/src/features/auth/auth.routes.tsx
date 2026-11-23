import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app-shell/app.routes';
import { requireGuest } from './auth.guards';
// Свідомо статично: вхід — перший екран кожного неавторизованого візиту, окремий чанк дав би
// зайвий RTT перед першим пейнтом (docs/frontend/lazy-loading.md §2)
// eslint-disable-next-line no-restricted-imports
import { LoginPage } from './pages/login';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});
