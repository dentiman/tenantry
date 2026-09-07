import { createZodDto } from 'nestjs-zod';
import {
  CalendarAgendaQuerySchema,
  CalendarAgendaResponseSchema,
  CalendarEventListResponseSchema,
  CalendarEventQuerySchema,
  CalendarEventResponseSchema,
  CreateCalendarEventSchema,
  SetCalendarAttendeesSchema,
  SetCalendarEventStatusSchema,
  SetCalendarRemindersSchema,
  SetCalendarRsvpSchema,
  UpdateCalendarEventSchema,
} from '@saas-skeleton/contracts';

export class CreateCalendarEventDto extends createZodDto(CreateCalendarEventSchema) {}
export class UpdateCalendarEventDto extends createZodDto(UpdateCalendarEventSchema) {}
export class SetCalendarEventStatusDto extends createZodDto(SetCalendarEventStatusSchema) {}
export class SetCalendarAttendeesDto extends createZodDto(SetCalendarAttendeesSchema) {}
export class SetCalendarRsvpDto extends createZodDto(SetCalendarRsvpSchema) {}
export class SetCalendarRemindersDto extends createZodDto(SetCalendarRemindersSchema) {}
export class CalendarEventQueryDto extends createZodDto(CalendarEventQuerySchema) {}
export class CalendarAgendaQueryDto extends createZodDto(CalendarAgendaQuerySchema) {}
export class CalendarEventResponseDto extends createZodDto(CalendarEventResponseSchema) {}
export class CalendarEventListResponseDto extends createZodDto(CalendarEventListResponseSchema) {}
export class CalendarAgendaResponseDto extends createZodDto(CalendarAgendaResponseSchema) {}
