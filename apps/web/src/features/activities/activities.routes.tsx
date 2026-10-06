import { createRoute } from '@tanstack/react-router';
import { settingsRoute } from '../settings/settings.routes';
import { SettingsActivityPage } from './pages/settings-activity';

export const settingsActivityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'activity',
  component: SettingsActivityPage,
});
