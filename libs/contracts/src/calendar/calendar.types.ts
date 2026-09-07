import type { z } from 'zod';
import type {
  CalendarEventKindSchema,
  CalendarEventStatusSchema,
  CalendarEventVisibilitySchema,
  CalendarAttendeeRoleSchema,
  CalendarAttendeeResponseSchema,
  CalendarAttendeeInputSchema,
  CalendarReminderInputSchema,
  CreateCalendarEventSchema,
  UpdateCalendarEventSchema,
  SetCalendarEventStatusSchema,
  SetCalendarAttendeesSchema,
  SetCalendarRsvpSchema,
  SetCalendarRemindersSchema,
  CalendarEventQuerySchema,
  CalendarAgendaQuerySchema,
  CalendarAttendeeResponseItemSchema,
  CalendarReminderResponseSchema,
  CalendarEventResponseSchema,
  CalendarEventListResponseSchema,
  CalendarAgendaResponseSchema,
} from './calendar.schema';

export type CalendarEventKind = z.infer<typeof CalendarEventKindSchema>;
export type CalendarEventStatus = z.infer<typeof CalendarEventStatusSchema>;
export type CalendarEventVisibility = z.infer<typeof CalendarEventVisibilitySchema>;
export type CalendarAttendeeRole = z.infer<typeof CalendarAttendeeRoleSchema>;
export type CalendarAttendeeResponseValue = z.infer<typeof CalendarAttendeeResponseSchema>;
export type CalendarAttendeeInput = z.infer<typeof CalendarAttendeeInputSchema>;
export type CalendarReminderInput = z.infer<typeof CalendarReminderInputSchema>;
export type CreateCalendarEvent = z.infer<typeof CreateCalendarEventSchema>;
export type UpdateCalendarEvent = z.infer<typeof UpdateCalendarEventSchema>;
export type SetCalendarEventStatus = z.infer<typeof SetCalendarEventStatusSchema>;
export type SetCalendarAttendees = z.infer<typeof SetCalendarAttendeesSchema>;
export type SetCalendarRsvp = z.infer<typeof SetCalendarRsvpSchema>;
export type SetCalendarReminders = z.infer<typeof SetCalendarRemindersSchema>;
export type CalendarEventQuery = z.infer<typeof CalendarEventQuerySchema>;
export type CalendarAgendaQuery = z.infer<typeof CalendarAgendaQuerySchema>;
export type CalendarAttendeeResponseItem = z.infer<typeof CalendarAttendeeResponseItemSchema>;
export type CalendarReminderResponse = z.infer<typeof CalendarReminderResponseSchema>;
export type CalendarEventResponse = z.infer<typeof CalendarEventResponseSchema>;
export type CalendarEventListResponse = z.infer<typeof CalendarEventListResponseSchema>;
export type CalendarAgendaResponse = z.infer<typeof CalendarAgendaResponseSchema>;
