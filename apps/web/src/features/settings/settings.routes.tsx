import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { requireAdmin } from '../auth/auth.guards';
import { SettingsGeneralPage } from './pages/general';

/**
 * Area «Settings» — налаштування ОРГАНІЗАЦІЇ. Своя area, а не розділ усередині
 * workspace: її під-розділи — повноцінне меню, і йому місце в навігаційній
 * колонці шела, а не в контенті сторінки (звідки й прибрано `SectionNav`).
 */
export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: requireAdmin,
});

export const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: SettingsGeneralPage,
});
