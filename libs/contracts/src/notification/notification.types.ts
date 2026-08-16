import type { z } from 'zod';
import type {
  NotificationListResponseSchema,
  NotificationPreferenceListSchema,
  NotificationPreferenceSchema,
  NotificationQuerySchema,
  NotificationResponseSchema,
  NotificationSummarySchema,
  NotificationTargetSchema,
} from './notification.schema';

export type NotificationQuery = z.infer<typeof NotificationQuerySchema>;
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;
export type NotificationSummary = z.infer<typeof NotificationSummarySchema>;
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;
export type NotificationPreferenceList = z.infer<typeof NotificationPreferenceListSchema>;
