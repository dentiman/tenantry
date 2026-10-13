import { createRoute } from '@tanstack/react-router';
import { operationsRoute } from '../messaging/messaging.routes';
import { ChannelEventsPage } from './pages/channel-events';

/**
 * Chat у control plane (CHAT-2a): вебхуки каналів, що не знайшли тенанта. Пункт — у area Operations,
 * яку оголосив модуль messaging (chat залежить від messaging, не навпаки).
 */
export const operationsChannelEventsRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'channel-events',
  component: ChannelEventsPage,
});
