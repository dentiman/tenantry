import { createRoute } from '@tanstack/react-router';
import { userSettingsRoute } from '../account/account.routes';
import { UserSettingsNotificationsPage } from './pages/user-settings-notifications';

export const userSettingsNotificationsRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'notifications',
  component: UserSettingsNotificationsPage,
});
