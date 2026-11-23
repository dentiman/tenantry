import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const SettingsGeneralPage = lazyPage(() => import('./pages/general'), 'SettingsGeneralPage');

/**
 * Area «Settings» — налаштування ОРГАНІЗАЦІЇ. Своя area, а не розділ усередині
 * workspace: її під-розділи — повноцінне меню, і йому місце в навігаційній
 * колонці шела, а не в контенті сторінки (звідки й прибрано `SectionNav`).
 */
export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  staticData: { access: { roles: ['ADMIN'] } },
});

export const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: SettingsGeneralPage,
});
