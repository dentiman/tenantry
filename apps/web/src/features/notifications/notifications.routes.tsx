import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { userSettingsRoute } from '../account/account.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const UserSettingsNotificationsPage = lazyPage(
  () => import('./pages/user-settings-notifications'),
  'UserSettingsNotificationsPage',
);

export const userSettingsNotificationsRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'notifications',
  component: UserSettingsNotificationsPage,
});
