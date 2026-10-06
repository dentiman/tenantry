import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { UserSettingsAccountPage } from './pages/account';
import { UserSettingsAppearancePage } from './pages/appearance';
import { UserSettingsProfilePage } from './pages/profile';
import { UserSettingsSecurityPage } from './pages/security';

/**
 * ОСОБИСТІ налаштування — area без пункту в рейлі: вхід із дропдауна аватара, бо
 * в головній навігації словом «Settings» володіє організація (патерн
 * GitLab / Stripe / Notion, docs/settings.md). `/user-settings` = Profile
 * (індексний роут): у свої налаштування заходять найчастіше саме по профіль.
 */
export const userSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/user-settings',
});

export const userSettingsProfileRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: '/',
  component: UserSettingsProfilePage,
});

export const userSettingsAccountRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'account',
  component: UserSettingsAccountPage,
});

export const userSettingsSecurityRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'security',
  component: UserSettingsSecurityPage,
});

export const userSettingsAppearanceRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'appearance',
  component: UserSettingsAppearancePage,
});
