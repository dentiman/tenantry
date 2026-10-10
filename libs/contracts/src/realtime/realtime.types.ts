import type { z } from 'zod';
import type {
  AuthExpiringSchema,
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
import { AUTH_UPDATE_EVENT } from './realtime.schema';

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
export type RealtimeErrorCode = z.infer<typeof RealtimeErrorCodeSchema>;
export type RealtimeError = z.infer<typeof RealtimeErrorSchema>;

/**
 * Платформні події client → server (поки одна). Повний протокол — `ClientToServerEvents` у root
 * `socket-events.ts`: платформні події + зареєстровані модулями (`ClientEventRegistry`).
 * Server → client — `ServerToClientEvents` там само.
 */
export interface PlatformClientToServerEvents {
  [AUTH_UPDATE_EVENT]: (payload: AuthUpdate, ack: (result: AuthUpdateResult) => void) => void;
}
