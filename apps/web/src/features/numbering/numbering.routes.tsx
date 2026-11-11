import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { settingsRoute } from '../settings/settings.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const SettingsNumberingPage = lazyPage(
  () => import('./pages/settings-numbering'),
  'SettingsNumberingPage',
);

export const settingsNumberingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'numbering',
  component: SettingsNumberingPage,
});
