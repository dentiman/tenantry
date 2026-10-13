import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { settingsRoute } from '../settings/settings.routes';
import { ChatPage } from './pages/chat';
import { ChatConversationPage } from './pages/chat-conversation';
import { MessagingSettingsPage } from './pages/messaging-settings';

/**
 * Area «Chat». Layout + index, як і задумувалось: index лишається станом
 * «розмову не вибрано», а сама розмова — дитина, додана без переписування.
 */
export const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
});

export const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatPage,
});

/**
 * Відкрита розмова. `bleed`: стрічка і композер самі тримають свої відступи,
 * а сторінка має займати всю висоту — інакше композер поїхав би за екран.
 */
export const chatConversationRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$conversationId',
  component: ChatConversationPage,
  staticData: { layout: 'bleed' },
});

/** Налаштування каналів — пункт area Settings (доступ ADMIN — з батьківського роуту) */
export const settingsMessagingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'messaging',
  component: MessagingSettingsPage,
});
