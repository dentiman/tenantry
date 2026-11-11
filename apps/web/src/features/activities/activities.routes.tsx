import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { settingsRoute } from '../settings/settings.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const SettingsActivityPage = lazyPage(
  () => import('./pages/settings-activity'),
  'SettingsActivityPage',
);

export const settingsActivityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'activity',
  component: SettingsActivityPage,
});
