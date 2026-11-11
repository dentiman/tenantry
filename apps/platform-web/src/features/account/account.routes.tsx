import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const UserSettingsProfilePage = lazyPage(
  () => import('./pages/profile'),
  'UserSettingsProfilePage',
);
const UserSettingsAppearancePage = lazyPage(
  () => import('./pages/appearance'),
  'UserSettingsAppearancePage',
);

/**
 * ОСОБИСТІ налаштування — area без пункту в рейлі: вхід із дропдауна аватара.
 * Той самий URL-префікс, що в tenant-web — однакова ментальна модель для
 * людини, що ходить між двома консолями.
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

export const userSettingsAppearanceRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'appearance',
  component: UserSettingsAppearancePage,
});
