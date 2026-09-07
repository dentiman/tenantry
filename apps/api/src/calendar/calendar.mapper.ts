import type {
  CalendarAgendaResponse,
  CalendarAttendeeResponseItem,
  CalendarEventListResponse,
  CalendarEventResponse,
  CalendarReminderResponse,
} from '@saas-skeleton/contracts';
import type { CalendarReminder } from '@saas-skeleton/database';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import type { CalendarAccessService } from './calendar.access';
import type { CalendarEventWithRelations } from './calendar.service';

type AttendeeRow = CalendarEventWithRelations['attendees'][number];

function toAttendee(attendee: AttendeeRow): CalendarAttendeeResponseItem {
  return {
    id: attendee.id,
    userId: attendee.userId,
    email: attendee.user.email,
    name: attendee.user.name,
    role: attendee.role,
    response: attendee.response,
    respondedAt: attendee.respondedAt?.toISOString() ?? null,
    comment: attendee.comment,
  };
}

function toReminder(reminder: CalendarReminder): CalendarReminderResponse {
  return {
    id: reminder.id,
    minutesBefore: reminder.minutesBefore,
    channel: reminder.channel,
  };
}

/**
 * Явний мапінг Prisma → response. `tenantId` і `createdById` назовні не йдуть:
 * перший — інфраструктура, другий у V1 ніде не показується.
 *
 * `canEdit` рахує СЕРВЕР через той самий `CalendarAccessService`, що enforce-ить
 * доступ: правила не мають дублюватись на фронті — розійшовшись, вони дадуть
 * кнопку, яка завжди 403.
 */
export function toCalendarEventResponse(
  event: CalendarEventWithRelations,
  actor: JwtPayload,
  access: CalendarAccessService,
): CalendarEventResponse {
  const mine = event.attendees.find((attendee) => attendee.userId === actor.sub);

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    kind: event.kind,
    status: event.status,
    visibility: event.visibility,
    busy: event.busy,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timeZone: event.timeZone,
    allDay: event.allDay,
    // У V1 входження одне й дорівнює самій події (docs/calendar.md §7). Поля є
    // з першого дня свідомо: з появою повторень один рядок почне давати N
    // елементів, і без них довелося б міняти контракт
    occurrenceStart: event.startsAt.toISOString(),
    occurrenceEnd: event.endsAt.toISOString(),
    recurringEventId: null,
    ownerId: event.ownerId,
    owner: event.owner
      ? { id: event.owner.id, email: event.owner.email, name: event.owner.name }
      : null,
    customerId: event.customerId,
    customer: event.customer ? { id: event.customer.id, name: event.customer.name } : null,
    attendees: event.attendees.map(toAttendee),
    // Нагадування персональні: у відповідь ідуть ТІЛЬКИ мої (Prisma тягне всі
    // одним include — див. EVENT_INCLUDE, фільтр тут)
    reminders: event.reminders
      .filter((reminder) => reminder.userId === actor.sub)
      .map(toReminder),
    myResponse: mine?.response ?? null,
    isOrganizer: event.ownerId === actor.sub,
    canEdit: access.canEdit(event, actor),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export function toCalendarEventListResponse(
  items: CalendarEventWithRelations[],
  window: { from: Date; to: Date },
  actor: JwtPayload,
  access: CalendarAccessService,
): CalendarEventListResponse {
  return {
    items: items.map((item) => toCalendarEventResponse(item, actor, access)),
    // Вікно повертається назад: клієнт звіряє, що дивиться саме на те, що просив
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
  };
}

export function toCalendarAgendaResponse(
  items: CalendarEventWithRelations[],
  nextCursor: string | null,
  actor: JwtPayload,
  access: CalendarAccessService,
): CalendarAgendaResponse {
  return {
    items: items.map((item) => toCalendarEventResponse(item, actor, access)),
    nextCursor,
  };
}
