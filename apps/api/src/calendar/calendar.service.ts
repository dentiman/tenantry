import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import {
  CalendarAttendeeResponse as AttendeeResponseEnum,
  CalendarEventStatus,
  Prisma,
} from '@saas-skeleton/database';
import type {
  CalendarAgendaQuery,
  CalendarAttendeeInput,
  CalendarEventQuery,
  CalendarEventStatus as CalendarEventStatusValue,
  CalendarReminderInput,
  CreateCalendarEvent,
  NotificationType,
  SetCalendarRsvp,
  UpdateCalendarEvent,
} from '@saas-skeleton/contracts';
import { MAX_CALENDAR_WINDOW_DAYS } from '@saas-skeleton/contracts';
import {
  ActivityRecorder,
  NotificationRecorder,
  ScheduledNotificationService,
} from '@saas-skeleton/shared';
import type { ActivityActor, ScheduleNotificationInput } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { SettingsService } from '../settings/settings.service';
import { CalendarAccessService } from './calendar.access';
import { daysBetween, normalizeAllDayRange, reminderFireAt } from './calendar-time';

/**
 * Нагадування тягнуться ВСІ, а фільтрує їх по актору мапер: вони персональні
 * (як `reminders.overrides` у Google), тож у відповідь чужі не потрапляють.
 *
 * Чому не `where: { userId }` в include: тоді набір залежав би від актора, і
 * `EVENT_INCLUDE` мусив би стати функцією — а з функції вже не виводиться
 * літеральний тип для `GetPayload`. Ціна поточного варіанту — кілька зайвих
 * рядків на подію, і вона менша за втрату типізації.
 */
const EVENT_INCLUDE = {
  owner: { select: { id: true, email: true, name: true } },
  customer: { select: { id: true, name: true } },
  attendees: {
    include: { user: { select: { id: true, email: true, name: true } } },
    // Обовʼязкові перед необовʼязковими, далі за часом додавання: порядок у
    // картці не має «стрибати» між запитами
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  },
  reminders: { orderBy: { minutesBefore: 'asc' } },
} as const satisfies Prisma.CalendarEventInclude;

export type CalendarEventWithRelations = Prisma.CalendarEventGetPayload<{
  include: typeof EVENT_INCLUDE;
}>;

/** Префікс ключів матеріалізації однієї події — ним же вона й скасовується */
function eventKeyPrefix(eventId: string): string {
  return `calendar_event:${eventId}:`;
}

/** Курсор agenda — той самий непрозорий base64url, що в activities */
function encodeCursor(startsAt: Date, id: string): string {
  return Buffer.from(`${startsAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { startsAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const startsAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(startsAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { startsAt, id };
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
    private readonly notifications: NotificationRecorder,
    private readonly scheduled: ScheduledNotificationService,
    private readonly settings: SettingsService,
    private readonly access: CalendarAccessService,
    private readonly tenantContext: TenantContextService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  // ------------------------------------------------------------- читання

  /**
   * Вікно, а не сторінки. Перетин — `startsAt < to AND endsAt > from`, обидві
   * нерівності СТРОГІ: інтервал напіввідкритий, тому подія, що закінчується
   * рівно на початку вікна, у нього не входить.
   */
  async findWindow(
    query: CalendarEventQuery,
    actor: JwtPayload,
  ): Promise<{ items: CalendarEventWithRelations[]; from: Date; to: Date }> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException({
        message: 'Window "to" must be after "from"',
        fieldErrors: [{ field: 'to', message: 'Must be after from', code: 'invalid_range' }],
      });
    }
    // Без стелі `from=2000&to=2100` вивантажив би всю таблицю
    if (daysBetween(from, to) > MAX_CALENDAR_WINDOW_DAYS) {
      throw new BadRequestException({
        message: `Window must not exceed ${String(MAX_CALENDAR_WINDOW_DAYS)} days`,
        fieldErrors: [{ field: 'to', message: 'Window is too wide', code: 'window_too_wide' }],
      });
    }

    const items = await this.prisma.calendarEvent.findMany({
      where: {
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...this.scopeFilter(query, actor),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: EVENT_INCLUDE,
    });

    this.logger.debug(`Calendar window ${query.from}…${query.to}: ${String(items.length)} events`);
    return { items, from, to };
  }

  /** Agenda — курсорний фід «що далі»: keyset по (startsAt, id) ASC */
  async findAgenda(
    query: CalendarAgendaQuery,
    actor: JwtPayload,
  ): Promise<{ items: CalendarEventWithRelations[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const from = cursor?.startsAt ?? (query.from ? new Date(query.from) : new Date());

    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        // Показуємо все, що ЩЕ НЕ ЗАКІНЧИЛОСЬ: зустріч, яка триває, у «що далі»
        // потрібна найбільше
        endsAt: { gt: from },
        ...(cursor && {
          OR: [
            { startsAt: { gt: cursor.startsAt } },
            { startsAt: cursor.startsAt, id: { gt: cursor.id } },
          ],
        }),
        ...this.scopeFilter({ customerId: query.customerId, kind: query.kind }, actor),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: EVENT_INCLUDE,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.startsAt, last.id) : null,
    };
  }

  async findOne(id: string, actor: JwtPayload): Promise<CalendarEventWithRelations> {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id },
      include: EVENT_INCLUDE,
    });
    if (!event) {
      throw new NotFoundException(`Calendar event with id "${id}" not found`);
    }
    // Учасників для перевірки доступу беремо з уже завантаженого рядка
    this.access.assertCanView(event, actor, id);
    return event;
  }

  // ------------------------------------------------------------- запис

  async create(data: CreateCalendarEvent, actor: JwtPayload): Promise<CalendarEventWithRelations> {
    const timeZone = await this.resolveTimeZone(data.timeZone, actor);
    const range = this.buildRange(
      new Date(data.startsAt),
      new Date(data.endsAt),
      data.allDay ?? false,
      timeZone,
    );
    if (data.customerId) {
      await this.assertCustomerExists(data.customerId);
    }
    const attendees = await this.resolveAttendees(data.attendees ?? [], actor);
    const reminders = data.reminders ?? (await this.defaultReminders(data.allDay ?? false));

    const event = await this.tenantTx.withTenantTx(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          location: data.location ?? null,
          kind: data.kind ?? 'MEETING',
          status: data.status ?? 'CONFIRMED',
          visibility: data.visibility ?? 'DEFAULT',
          busy: data.busy ?? true,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          timeZone,
          allDay: data.allDay ?? false,
          ownerId: actor.sub,
          customerId: data.customerId ?? null,
          createdById: actor.sub,
          attendees: {
            create: [
              // Організатор — ТЕЖ рядок учасника (як `organizer` у attendees
              // Google/Graph): інакше його не видно в списку запрошених, а
              // фільтр «мій календар» довелося б збирати з двох умов замість
              // однієї. Він одразу ACCEPTED — сам себе не запрошує
              {
                userId: actor.sub,
                role: 'REQUIRED',
                response: AttendeeResponseEnum.ACCEPTED,
                respondedAt: new Date(),
              },
              ...attendees
                .filter((attendee) => attendee.userId !== actor.sub)
                .map((attendee) => ({ userId: attendee.userId, role: attendee.role })),
            ],
          },
          reminders: {
            create: reminders.map((reminder) => ({
              userId: actor.sub,
              minutesBefore: reminder.minutesBefore,
              channel: reminder.channel ?? 'in_app',
            })),
          },
        },
        include: EVENT_INCLUDE,
      });

      await this.rescheduleReminders(tx, created.id);

      await this.activities.record(tx, {
        type: 'calendar_event.created',
        actor: this.actorOf(actor),
        payload: {
          event: this.refOf(created),
          startsAt: created.startsAt.toISOString(),
          customer: created.customer
            ? { kind: 'customer', id: created.customer.id, label: created.customer.name }
            : null,
        },
        links: this.linksOf(created),
      });

      await this.notifyAttendees(tx, created, 'calendar_event.invited', actor);
      this.emitChanged(tx, created, 'created');

      return created;
    });

    this.logger.log(`Calendar event created: ${event.title} (${event.startsAt.toISOString()})`);
    return event;
  }

  async update(
    id: string,
    data: UpdateCalendarEvent,
    actor: JwtPayload,
  ): Promise<CalendarEventWithRelations> {
    const current = await this.findOne(id, actor);
    this.access.assertCanEdit(current, actor, id);

    const timeZone = data.timeZone ?? current.timeZone;
    const allDay = data.allDay ?? current.allDay;
    const range = this.buildRange(
      data.startsAt ? new Date(data.startsAt) : current.startsAt,
      data.endsAt ? new Date(data.endsAt) : current.endsAt,
      allDay,
      timeZone,
    );
    if (data.customerId) {
      await this.assertCustomerExists(data.customerId);
    }

    const isRescheduled =
      range.startsAt.getTime() !== current.startsAt.getTime() ||
      range.endsAt.getTime() !== current.endsAt.getTime();

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.calendarEvent.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.location !== undefined && { location: data.location }),
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.visibility !== undefined && { visibility: data.visibility }),
          ...(data.busy !== undefined && { busy: data.busy }),
          ...(data.customerId !== undefined && { customerId: data.customerId }),
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          timeZone,
          allDay,
        },
        include: EVENT_INCLUDE,
      });

      // Перенесення — окремий тип активності і окреме сповіщення: «хто пересунув
      // зустріч» питають найчастіше. Правка назви чи опису в журнал не йде взагалі
      if (isRescheduled) {
        await this.rescheduleReminders(tx, id);
        await this.activities.record(tx, {
          type: 'calendar_event.rescheduled',
          actor: this.actorOf(actor),
          payload: {
            event: this.refOf(updated),
            previousStartsAt: current.startsAt.toISOString(),
            startsAt: updated.startsAt.toISOString(),
          },
          links: this.linksOf(updated),
        });
        await this.notifyAttendees(tx, updated, 'calendar_event.rescheduled', actor);
      }

      this.emitChanged(
        tx,
        updated,
        'updated',
        // Перенесення міняє ДВА вікна: те, з якого подія зникла, і те, у яке
        // приїхала. Клієнт бачить лише свій період, тож стару межу він мусить
        // отримати окремою дельтою — інакше «дірка» на місці події лишилась би
        // до наступного фетчу
        isRescheduled ? { startsAt: current.startsAt, endsAt: current.endsAt } : undefined,
      );

      this.logger.log(`Calendar event updated: ${updated.title}`);
      return updated;
    });
  }

  /**
   * Скасування/відновлення — подія, а не поле в PATCH (як статус кастомера).
   * Повторний виклик із тим самим значенням — no-op без записів: активність це
   * факт зміни, а не факт натискання кнопки.
   */
  async setStatus(
    id: string,
    status: CalendarEventStatusValue,
    actor: JwtPayload,
  ): Promise<CalendarEventWithRelations> {
    const current = await this.findOne(id, actor);
    this.access.assertCanEdit(current, actor, id);
    if (current.status === status) {
      return current;
    }
    const wasCancelled = current.status === CalendarEventStatus.CANCELLED;

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.calendarEvent.update({
        where: { id },
        data: { status },
        include: EVENT_INCLUDE,
      });

      // Скасували — знімаємо заплановані нагадування; відновили — ставимо назад.
      // Обидва напрямки робить той самий rescheduleReminders: він читає статус
      await this.rescheduleReminders(tx, id);

      if (status === CalendarEventStatus.CANCELLED) {
        await this.activities.record(tx, {
          type: 'calendar_event.cancelled',
          actor: this.actorOf(actor),
          payload: { event: this.refOf(updated) },
          links: this.linksOf(updated),
        });
        await this.notifyAttendees(tx, updated, 'calendar_event.cancelled', actor);
      } else if (wasCancelled) {
        await this.activities.record(tx, {
          type: 'calendar_event.restored',
          actor: this.actorOf(actor),
          payload: { event: this.refOf(updated), status },
          links: this.linksOf(updated),
        });
        await this.notifyAttendees(tx, updated, 'calendar_event.invited', actor);
      }

      this.emitChanged(tx, updated, 'updated');
      this.logger.log(`Calendar event ${updated.title} status → ${status}`);
      return updated;
    });
  }

  /**
   * Справжнє видалення — виправлення щойно зробленої помилки. «Прибрати з очей»
   * уже покриває CANCELLED, і саме він лишається нормальним шляхом.
   */
  async remove(id: string, actor: JwtPayload): Promise<void> {
    const event = await this.findOne(id, actor);
    this.access.assertCanEdit(event, actor, id);

    await this.tenantTx.withTenantTx(async (tx) => {
      // Учасники й нагадування підуть каскадом, а заплановані сповіщення — НІ:
      // у них немає FK на подію (вони спільна таблиця), звʼязок тримає dedupeKey
      await this.scheduled.cancel(tx, { dedupeKeyPrefix: eventKeyPrefix(id) });
      await tx.calendarEvent.delete({ where: { id } });

      await this.activities.record(tx, {
        type: 'calendar_event.deleted',
        actor: this.actorOf(actor),
        payload: { event: this.refOf(event) },
        links: this.linksOf(event),
      });
      // Список отримувачів прочитаний ДО видалення: після каскаду учасників
      // уже не існує, а сказати їм про зникнення треба саме їм
      this.emitChanged(tx, event, 'deleted');
    });

    this.logger.log(`Calendar event deleted: ${event.title}`);
  }

  // ------------------------------------------------------------- учасники

  /**
   * Повний склад = документ, але сервер його ДИФАЄ: сповіщення йдуть тільки
   * доданим, активність — тільки на реальні зміни. Без цього кожне збереження
   * події розсилало б запрошення всім, хто вже в списку — найпоширеніший спосіб
   * довести колег до вимкнення сповіщень.
   */
  async setAttendees(
    id: string,
    attendees: CalendarAttendeeInput[],
    actor: JwtPayload,
  ): Promise<CalendarEventWithRelations> {
    const current = await this.findOne(id, actor);
    this.access.assertCanEdit(current, actor, id);
    const resolved = await this.resolveAttendees(attendees, actor);

    const ownerId = current.ownerId;
    const desired = new Map(resolved.map((item) => [item.userId, item.role]));
    // Організатора зі складу вибити неможливо — він у події за визначенням
    if (ownerId) {
      desired.set(ownerId, desired.get(ownerId) ?? 'REQUIRED');
    }
    const existing = new Map(current.attendees.map((item) => [item.userId, item]));

    const added = [...desired.keys()].filter((userId) => !existing.has(userId));
    const removed = [...existing.keys()].filter((userId) => !desired.has(userId));

    if (added.length === 0 && removed.length === 0) {
      // Той самий склад — жодного запису, жодного сповіщення. Саме це й
      // перевіряє головний тест модуля
      return current;
    }

    return this.tenantTx.withTenantTx(async (tx) => {
      if (added.length > 0) {
        await tx.calendarEventAttendee.createMany({
          data: added.map((userId) => ({
            eventId: id,
            userId,
            role: desired.get(userId) ?? 'REQUIRED',
          })),
        });
      }
      if (removed.length > 0) {
        await tx.calendarEventAttendee.deleteMany({
          where: { eventId: id, userId: { in: removed } },
        });
        // Прибраний учасник не має отримати нагадування про подію, до якої вже
        // не має стосунку — знімаємо і декларації, і матеріалізовані рядки
        await tx.calendarReminder.deleteMany({ where: { eventId: id, userId: { in: removed } } });
        for (const userId of removed) {
          await this.scheduled.cancel(tx, {
            dedupeKeyPrefix: eventKeyPrefix(id),
            recipientId: userId,
          });
        }
      }

      const updated = await tx.calendarEvent.findUniqueOrThrow({
        where: { id },
        include: EVENT_INCLUDE,
      });

      for (const userId of added) {
        const attendee = updated.attendees.find((item) => item.userId === userId);
        await this.activities.record(tx, {
          type: 'calendar_event.attendee_added',
          actor: this.actorOf(actor),
          payload: {
            event: this.refOf(updated),
            attendee: {
              kind: 'user',
              id: userId,
              label: attendee?.user.name ?? attendee?.user.email ?? userId,
            },
          },
          links: this.linksOf(updated),
        });
      }
      for (const userId of removed) {
        const attendee = existing.get(userId);
        await this.activities.record(tx, {
          type: 'calendar_event.attendee_removed',
          actor: this.actorOf(actor),
          payload: {
            event: this.refOf(updated),
            attendee: {
              kind: 'user',
              id: userId,
              label: attendee?.user.name ?? attendee?.user.email ?? userId,
            },
          },
          links: this.linksOf(updated),
        });
      }

      if (added.length > 0) {
        await this.notifications.notify(tx, {
          type: 'calendar_event.invited',
          recipientIds: added,
          actor: this.actorOf(actor),
          payload: {
            event: this.refOf(updated),
            startsAt: updated.startsAt.toISOString(),
            allDay: updated.allDay,
          },
          target: { kind: 'calendar_event', id: updated.id },
        });
      }

      // Прибрані теж мусять дізнатись: подія зникає з ЇХНЬОГО календаря, а в
      // room-ах події їх уже немає — тому обʼєднання складів
      this.emitChanged(tx, updated, 'updated', undefined, removed);

      this.logger.log(
        `Calendar event ${id} attendees: +${String(added.length)} / -${String(removed.length)}`,
      );
      return updated;
    });
  }

  /**
   * Моя відповідь. Id учасника в шляху немає — суб'єкт із токена (доктрина
   * `/account`), тому «відповісти за колегу» неможливо не за домовленістю, а
   * за формою API.
   */
  async setRsvp(
    id: string,
    input: SetCalendarRsvp,
    actor: JwtPayload,
  ): Promise<CalendarEventWithRelations> {
    const current = await this.findOne(id, actor);
    const mine = current.attendees.find((attendee) => attendee.userId === actor.sub);
    if (!mine) {
      throw new BadRequestException('You are not an attendee of this event');
    }
    if (mine.response === input.response && (input.comment ?? null) === mine.comment) {
      return current;
    }

    return this.tenantTx.withTenantTx(async (tx) => {
      await tx.calendarEventAttendee.update({
        where: { id: mine.id },
        data: {
          response: input.response,
          comment: input.comment ?? null,
          respondedAt: new Date(),
        },
      });

      const updated = await tx.calendarEvent.findUniqueOrThrow({
        where: { id },
        include: EVENT_INCLUDE,
      });

      const attendeeRef = { kind: 'user', id: actor.sub, label: actor.email };
      await this.activities.record(tx, {
        type: 'calendar_event.rsvp_changed',
        actor: this.actorOf(actor),
        payload: {
          event: this.refOf(updated),
          attendee: attendeeRef,
          response: input.response,
        },
        links: this.linksOf(updated),
      });

      // Відповідь потрібна ОРГАНІЗАТОРУ, а не всім учасникам: на зустрічі з
      // десятьма людьми решта дев'ять отримали б по дев'ять сповіщень
      if (updated.ownerId) {
        await this.notifications.notify(tx, {
          type: 'calendar_event.rsvp_changed',
          recipientIds: [updated.ownerId],
          actor: this.actorOf(actor),
          payload: {
            event: this.refOf(updated),
            attendee: attendeeRef,
            response: input.response,
          },
          target: { kind: 'calendar_event', id: updated.id },
        });
      }

      this.emitChanged(tx, updated, 'updated');
      return updated;
    });
  }

  // ------------------------------------------------------------- нагадування

  /**
   * Мої нагадування на подію — повний набір, ідемпотентно. Учасник міняє свої і
   * тільки свої: право на нагадування дає участь, а не організаторство.
   */
  async setReminders(
    id: string,
    reminders: CalendarReminderInput[],
    actor: JwtPayload,
  ): Promise<CalendarEventWithRelations> {
    await this.findOne(id, actor);

    return this.tenantTx.withTenantTx(async (tx) => {
      await tx.calendarReminder.deleteMany({ where: { eventId: id, userId: actor.sub } });
      if (reminders.length > 0) {
        await tx.calendarReminder.createMany({
          data: reminders.map((reminder) => ({
            eventId: id,
            userId: actor.sub,
            minutesBefore: reminder.minutesBefore,
            channel: reminder.channel ?? 'in_app',
          })),
        });
      }
      await this.rescheduleReminders(tx, id);

      const updated = await tx.calendarEvent.findUniqueOrThrow({
        where: { id },
        include: EVENT_INCLUDE,
      });
      // Нагадування персональні, тож дельта — лише в мої ж вкладки: складу
      // події вона не змінює, і сусідам показувати нічого
      this.emitChanged(tx, updated, 'updated', undefined, [], [actor.sub]);
      return updated;
    });
  }

  /**
   * Перепланування: зняти незахоплене і поставити наново. Викликається В ТІЙ
   * САМІЙ транзакції, що й зміна, від якої залежить час спрацювання — інакше
   * зʼявилось би вікно, у якому нагадування бреше про подію.
   *
   * Читає стан із tx, а не приймає його аргументом, свідомо: єдине джерело
   * правди — рядки, і жоден викликач не може «забути» частину змін.
   */
  private async rescheduleReminders(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
    await this.scheduled.cancel(tx, { dedupeKeyPrefix: eventKeyPrefix(eventId) });

    const event = await tx.calendarEvent.findUnique({
      where: { id: eventId },
      include: { reminders: true },
    });
    if (!event || event.status === CalendarEventStatus.CANCELLED) {
      return;
    }

    const now = Date.now();
    const inputs: ScheduleNotificationInput[] = [];
    for (const reminder of event.reminders) {
      const fireAt = reminderFireAt(event.startsAt, reminder.minutesBefore);
      // Нагадування, чий момент уже минув, не створюємо взагалі: сканер однаково
      // позначив би його `stale`, а рядок-сміття в таблиці нічого не додає
      if (fireAt.getTime() <= now) {
        continue;
      }
      inputs.push({
        fireAt,
        // occurrenceStart у ключі — те, що дозволить матеріалізувати горизонт
        // серій у CAL-4 без зміни формату
        dedupeKey: `${eventKeyPrefix(eventId)}reminder:${reminder.id}:${event.startsAt.toISOString()}`,
        recipientId: reminder.userId,
        type: 'calendar_event.reminder',
        payload: {
          event: { kind: 'calendar_event', id: event.id, label: event.title },
          startsAt: event.startsAt.toISOString(),
          allDay: event.allDay,
          minutesBefore: reminder.minutesBefore,
        },
        target: { kind: 'calendar_event', id: event.id },
        actor: { type: 'system' },
      });
    }
    await this.scheduled.schedule(tx, inputs);
  }

  // ------------------------------------------------------------- внутрішнє

  /**
   * Фільтр списку = видимість + доменні фільтри. `mine: false` НЕ означає «всі
   * події тенанта»: видимість лишається на місці, знімається лише звуження до
   * власних — тому чужий приватний календар недосяжний і через query-параметр.
   */
  private scopeFilter(
    query: { ownerId?: string; customerId?: string; kind?: string; includeCancelled?: boolean },
    actor: JwtPayload,
  ): Prisma.CalendarEventWhereInput {
    return {
      AND: [
        this.access.visibilityFilter(actor),
        {
          ...(query.ownerId && { ownerId: query.ownerId }),
          ...(query.customerId && { customerId: query.customerId }),
          ...(query.kind && { kind: query.kind as Prisma.CalendarEventWhereInput['kind'] }),
          // Скасовані приховані за замовчуванням — як архівні кастомери в гріді
          ...(query.includeCancelled ? {} : { status: { not: CalendarEventStatus.CANCELLED } }),
        },
      ],
    };
  }

  /** Явна перевірка діапазону → 400 із полем; для all-day межі нормалізуються */
  private buildRange(
    startsAt: Date,
    endsAt: Date,
    allDay: boolean,
    timeZone: string,
  ): { startsAt: Date; endsAt: Date } {
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    if (allDay) {
      return normalizeAllDayRange(startsAt, endsAt, timeZone);
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException({
        message: 'Event must end after it starts',
        fieldErrors: [
          { field: 'endsAt', message: 'Must be after the start', code: 'invalid_range' },
        ],
      });
    }
    return { startsAt, endsAt };
  }

  /**
   * Зона події: явна з запиту → зона юзера → зона організації. Саме в такому
   * порядку: клієнт знає, у якій зоні людина щойно набирала час, і його вибір
   * важливіший за профіль.
   */
  private async resolveTimeZone(explicit: string | undefined, actor: JwtPayload): Promise<string> {
    if (explicit) {
      return explicit;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { timeZone: true },
    });
    if (user?.timeZone) {
      return user.timeZone;
    }
    return (await this.settings.calendar()).timeZone;
  }

  /** Дефолтні нагадування компанії; для all-day — своє поле (900 хв = 09:00 попереднього дня) */
  private async defaultReminders(allDay: boolean): Promise<CalendarReminderInput[]> {
    const settings = await this.settings.calendar();
    const minutes = allDay
      ? settings.defaultAllDayReminderMinutes
      : settings.defaultReminderMinutes;
    return minutes === null ? [] : [{ minutesBefore: minutes }];
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      throw new BadRequestException({
        message: 'customerId must reference a customer of this workspace',
        fieldErrors: [{ field: 'customerId', message: 'Unknown customer', code: 'invalid_customer' }],
      });
    }
  }

  /**
   * Учасники — тільки живі юзери цього тенанта (чужих відсіє RLS, тому окремої
   * перевірки на tenant немає — і саме тому ця виглядає як звичайна перевірка
   * існування).
   */
  private async resolveAttendees(
    attendees: CalendarAttendeeInput[],
    actor: JwtPayload,
  ): Promise<{ userId: string; role: 'REQUIRED' | 'OPTIONAL' }[]> {
    const unique = new Map<string, 'REQUIRED' | 'OPTIONAL'>();
    for (const attendee of attendees) {
      unique.set(attendee.userId, attendee.role ?? 'REQUIRED');
    }
    const ids = [...unique.keys()].filter((id) => id !== actor.sub);
    if (ids.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      });
      if (users.length !== ids.length) {
        throw new BadRequestException({
          message: 'attendees must reference active users of this workspace',
          fieldErrors: [
            { field: 'attendees', message: 'Unknown user', code: 'invalid_attendee' },
          ],
        });
      }
    }
    return [...unique.entries()].map(([userId, role]) => ({ userId, role }));
  }

  /**
   * Дельта в особисті room-и учасників — ПІСЛЯ КОМІТУ (`onCommit` того самого
   * `withTenantTx`, що й доменна зміна). До коміту клієнт перечитав би стан
   * «до», а через чергу це були б секунди polling-у — тому підписника в
   * `MESSAGE_TOPOLOGY` тут немає (чинне §3.12 EDA, як і в сповіщеннях).
   *
   * Втрата дельти не втрачає стан: джерелом правди лишається REST, а
   * `connect`-хук клієнта робить resync, коли Socket.IO не відновив сесію.
   */
  private emitChanged(
    tx: Prisma.TransactionClient,
    event: {
      id: string;
      startsAt: Date;
      endsAt: Date;
      attendees: { userId: string }[];
      ownerId: string | null;
    },
    change: 'created' | 'updated' | 'deleted',
    previous?: { startsAt: Date; endsAt: Date },
    extraRecipientIds: readonly string[] = [],
    onlyRecipientIds?: readonly string[],
  ): void {
    const tenantId = this.tenantContext.requireTenantId();
    const recipients =
      onlyRecipientIds ??
      [
        ...new Set([
          ...event.attendees.map((attendee) => attendee.userId),
          ...(event.ownerId ? [event.ownerId] : []),
          ...extraRecipientIds,
        ]),
      ];
    if (recipients.length === 0) {
      return;
    }

    const occurredAt = new Date().toISOString();
    this.tenantTx.onCommit(tx, () => {
      this.realtime.calendarEventChanged(tenantId, recipients, {
        eventId: event.id,
        change,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        occurredAt,
      });
      if (previous) {
        this.realtime.calendarEventChanged(tenantId, recipients, {
          eventId: event.id,
          change,
          startsAt: previous.startsAt.toISOString(),
          endsAt: previous.endsAt.toISOString(),
          occurredAt,
        });
      }
    });
  }

  private actorOf(actor: JwtPayload): ActivityActor {
    return { type: 'user', id: actor.sub, label: actor.email };
  }

  /** Снапшот назви на момент події — фід рендериться без join-ів */
  private refOf(event: { id: string; title: string }): {
    kind: string;
    id: string;
    label: string;
  } {
    return { kind: 'calendar_event', id: event.id, label: event.title };
  }

  /**
   * Лінк на кастомера з роллю `context` — те, завдяки чому зустрічі зʼявляються
   * у стрічці клієнта БЕЗ жодного нового ендпоінта: наявний
   * `GET /activities?entityType=customer` уже все віддає.
   */
  private linksOf(event: {
    id: string;
    customerId: string | null;
  }): { entityType: string; entityId: string; role: 'subject' | 'context' }[] {
    const links: { entityType: string; entityId: string; role: 'subject' | 'context' }[] = [
      { entityType: 'calendar_event', entityId: event.id, role: 'subject' },
    ];
    if (event.customerId) {
      links.push({ entityType: 'customer', entityId: event.customerId, role: 'context' });
    }
    return links;
  }

  /** Усім учасникам, крім автора дії (його ж відсіє і recorder) */
  private async notifyAttendees(
    tx: Prisma.TransactionClient,
    event: CalendarEventWithRelations,
    type: Extract<
      NotificationType,
      'calendar_event.invited' | 'calendar_event.rescheduled' | 'calendar_event.cancelled'
    >,
    actor: JwtPayload,
  ): Promise<void> {
    const recipientIds = event.attendees
      .map((attendee) => attendee.userId)
      .filter((userId) => userId !== actor.sub);
    if (recipientIds.length === 0) {
      return;
    }
    await this.notifications.notify(tx, {
      type,
      recipientIds,
      actor: this.actorOf(actor),
      payload: {
        event: this.refOf(event),
        startsAt: event.startsAt.toISOString(),
        allDay: event.allDay,
      },
      target: { kind: 'calendar_event', id: event.id },
      // П'ять правок часу поспіль дадуть ОДИН рядок із groupCount, а не п'ять.
      // Скасування не колапсується — воно одне й остаточне
      ...(type === 'calendar_event.rescheduled' && {
        groupKey: `calendar_event:${event.id}:rescheduled`,
      }),
      ...(type === 'calendar_event.invited' && {
        groupKey: `calendar_event:${event.id}:invited`,
      }),
    });
  }
}
