import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { settingsRoute } from '../settings/settings.routes';
import { AiAssistantConversationPage, AiAssistantPage } from './pages/ai-assistant';
import { SettingsAiPage } from './pages/ai-settings';

/** AI-1c: персона й інструкції асистента — ADMIN-only, як і вся area (`staticData.access` на `settingsRoute`) */
export const settingsAiRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'ai',
  component: SettingsAiPage,
});

/**
 * Area «Assistant» — сторінка асистента з історією розмов у колонці area. Лейаут + index,
 * як у чаті: index — поточна розмова, дитина — розмова з історії за id.
 *
 * `access.feature` ховає розділ у рейлі, поки асистент вимкнений в інсталяції або для
 * тенанта (`features.ai` з bootstrap); бекенд однаково відповідає 403. Обидві сторінки —
 * `bleed`: стрічка й композер тримають свої відступи самі, а сторінка займає всю висоту.
 */
export const assistantRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/assistant',
  staticData: { access: { feature: 'ai' } },
});

export const assistantIndexRoute = createRoute({
  getParentRoute: () => assistantRoute,
  path: '/',
  component: AiAssistantPage,
  staticData: { layout: 'bleed' },
});

export const assistantConversationRoute = createRoute({
  getParentRoute: () => assistantRoute,
  path: '$conversationId',
  component: AiAssistantConversationPage,
  staticData: { layout: 'bleed' },
});
