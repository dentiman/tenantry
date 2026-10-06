import { createRoute } from '@tanstack/react-router';
import { settingsRoute } from '../settings/settings.routes';
import { SettingsNumberingPage } from './pages/settings-numbering';

export const settingsNumberingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'numbering',
  component: SettingsNumberingPage,
});
