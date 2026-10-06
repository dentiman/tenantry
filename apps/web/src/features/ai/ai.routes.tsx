import { createRoute } from '@tanstack/react-router';
import { settingsRoute } from '../settings/settings.routes';
import { SettingsAiPage } from './pages/ai-settings';

/** AI-1c: персона й інструкції асистента — ADMIN-only, як і вся area (`requireAdmin` на `settingsRoute`) */
export const settingsAiRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'ai',
  component: SettingsAiPage,
});
