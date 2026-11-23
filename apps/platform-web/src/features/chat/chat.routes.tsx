import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { operationsRoute } from '../messaging/messaging.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const ChannelEventsPage = lazyPage(() => import('./pages/channel-events'), 'ChannelEventsPage');

/**
 * Chat у control plane (CHAT-2a): вебхуки каналів, що не знайшли тенанта. Пункт — у area Operations,
 * яку оголосив модуль messaging (chat залежить від messaging, не навпаки).
 */
export const operationsChannelEventsRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'channel-events',
  component: ChannelEventsPage,
});
