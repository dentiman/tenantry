import type { z } from 'zod';
import type {
  AiConversationChangedSchema,
  AiMessageCompletedSchema,
  AiMessageDeltaSchema,
  AuthExpiringSchema,
  CalendarEventChangedSchema,
  AuthUpdateResultSchema,
  AuthUpdateSchema,
  NotificationChangedSchema,
  NotificationCreatedSchema,
  PresenceChangedSchema,
  PresenceSnapshotSchema,
  PresenceStatusSchema,
  RealtimeErrorCodeSchema,
  RealtimeErrorSchema,
  ResyncReasonSchema,
  ResyncRequiredSchema,
} from './realtime.schema';
import { REALTIME_EVENTS } from './realtime.schema';

export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;
export type PresenceChanged = z.infer<typeof PresenceChangedSchema>;
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;
export type AuthExpiring = z.infer<typeof AuthExpiringSchema>;
export type AuthUpdate = z.infer<typeof AuthUpdateSchema>;
export type AuthUpdateResult = z.infer<typeof AuthUpdateResultSchema>;
export type ResyncReason = z.infer<typeof ResyncReasonSchema>;
export type ResyncRequired = z.infer<typeof ResyncRequiredSchema>;
export type NotificationCreated = z.infer<typeof NotificationCreatedSchema>;
export type NotificationChanged = z.infer<typeof NotificationChangedSchema>;
export type CalendarEventChanged = z.infer<typeof CalendarEventChangedSchema>;
export type AiMessageDelta = z.infer<typeof AiMessageDeltaSchema>;
export type AiMessageCompleted = z.infer<typeof AiMessageCompletedSchema>;
export type AiConversationChanged = z.infer<typeof AiConversationChangedSchema>;
export type RealtimeErrorCode = z.infer<typeof RealtimeErrorCodeSchema>;
export type RealtimeError = z.infer<typeof RealtimeErrorSchema>;

/**
 * Карти подій для `Server<...>` / `Socket<...>` на обох кінцях. Це і є «типізований
 * протокол»: додати подію на сервері й забути про клієнта тепер не можна — не збереться.
 */
export interface ServerToClientEvents {
  [REALTIME_EVENTS.presenceChanged]: (payload: PresenceChanged) => void;
  [REALTIME_EVENTS.authExpiring]: (payload: AuthExpiring) => void;
  [REALTIME_EVENTS.resyncRequired]: (payload: ResyncRequired) => void;
  [REALTIME_EVENTS.notificationCreated]: (payload: NotificationCreated) => void;
  [REALTIME_EVENTS.notificationChanged]: (payload: NotificationChanged) => void;
  [REALTIME_EVENTS.calendarEventChanged]: (payload: CalendarEventChanged) => void;
  [REALTIME_EVENTS.aiMessageDelta]: (payload: AiMessageDelta) => void;
  [REALTIME_EVENTS.aiMessageCompleted]: (payload: AiMessageCompleted) => void;
  [REALTIME_EVENTS.aiConversationChanged]: (payload: AiConversationChanged) => void;
}

export interface ClientToServerEvents {
  [REALTIME_EVENTS.authUpdate]: (
    payload: AuthUpdate,
    ack: (result: AuthUpdateResult) => void,
  ) => void;
}
