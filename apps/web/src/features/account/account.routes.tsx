import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const UserSettingsAccountPage = lazyPage(
  () => import('./pages/account'),
  'UserSettingsAccountPage',
);
const UserSettingsAppearancePage = lazyPage(
  () => import('./pages/appearance'),
  'UserSettingsAppearancePage',
);
const UserSettingsProfilePage = lazyPage(
  () => import('./pages/profile'),
  'UserSettingsProfilePage',
);
const UserSettingsSecurityPage = lazyPage(
  () => import('./pages/security'),
  'UserSettingsSecurityPage',
);

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
