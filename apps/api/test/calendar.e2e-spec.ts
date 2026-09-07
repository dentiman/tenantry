/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { ScheduledNotificationService } from '@saas-skeleton/shared';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

interface EventBody {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  allDay: boolean;
  status: string;
  visibility: string;
  occurrenceStart: string;
  occurrenceEnd: string;
  recurringEventId: string | null;
  ownerId: string | null;
  customerId: string | null;
  isOrganizer: boolean;
  canEdit: boolean;
  myResponse: string | null;
  attendees: { id: string; userId: string; response: string; role: string }[];
  reminders: { id: string; minutesBefore: number }[];
}

interface WindowBody {
  items: EventBody[];
  window: { from: string; to: string };
}

/** Далеке майбутнє: нагадування мусять лягати «попереду», а не бути stale */
const START = '2027-03-10T10:00:00.000Z';
const END = '2027-03-10T11:00:00.000Z';

describe('Calendar API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.scheduledNotification.deleteMany();
    await prisma.calendarReminder.deleteMany();
    await prisma.calendarEventAttendee.deleteMany();
    await prisma.calendarEvent.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.numberSequence.deleteMany();
    await prisma.numberSeries.deleteMany();
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.notificationState.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    // Секція calendar живе в settings JSON — скидаємо, щоб тести не залежали
    // від того, що лишив попередній
    await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { settings: {} } });
  });

  afterAll(async () => {
    // Сьют пише секцію `calendar` у `tenant.settings` — прибираємо за собою,
    // щоб сусідні сьюти не залежали від порядку запуску
    await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { settings: {} } });
    await app.close();
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER' = 'ADMIN',
  ): Promise<{ headers: { Authorization: string }; id: string; email: string }> => {
    const email = `cal-${suffix}@example.com`;
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: `Cal ${suffix}`,
      role,
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, id: user.id, email };
  };

  const createEvent = async (
    headers: { Authorization: string },
    body: Record<string, unknown> = {},
  ): Promise<EventBody> => {
    const response = await request(app.getHttpServer())
      .post('/api/calendar/events')
      .set(headers)
      .send({ title: 'Weekly sync', startsAt: START, endsAt: END, ...body })
      .expect(201);
    return response.body as EventBody;
  };

  const window = async (
    headers: { Authorization: string },
    from: string,
    to: string,
    extra: Record<string, string> = {},
  ): Promise<WindowBody> => {
    const response = await request(app.getHttpServer())
      .get('/api/calendar/events')
      .query({ from, to, ...extra })
      .set(headers)
      .expect(200);
    return response.body as WindowBody;
  };

  // ------------------------------------------------------------ вікно

  it('includes an event that overlaps the window and excludes one that ends exactly at its start', async () => {
    const admin = await login('window');
    await createEvent(admin.headers, { title: 'Inside' });
    // Закінчується РІВНО на початку вікна: інтервал напіввідкритий, тому не
    // потрапляє (обидві нерівності строгі)
    await createEvent(admin.headers, {
      title: 'Touching',
      startsAt: '2027-03-10T08:00:00.000Z',
      endsAt: '2027-03-10T09:00:00.000Z',
    });

    const body = await window(admin.headers, '2027-03-10T09:00:00.000Z', '2027-03-10T12:00:00.000Z');
    expect(body.items.map((item) => item.title)).toEqual(['Inside']);
    expect(body.window.from).toBe('2027-03-10T09:00:00.000Z');
  });

  it('rejects a window wider than the documented limit', async () => {
    const admin = await login('wide');
    await request(app.getHttpServer())
      .get('/api/calendar/events')
      .query({ from: '2027-01-01T00:00:00.000Z', to: '2027-12-31T00:00:00.000Z' })
      .set(admin.headers)
      .expect(400);
  });

  it('returns occurrence fields equal to the row itself (V1 has no recurrence)', async () => {
    const admin = await login('occurrence');
    const event = await createEvent(admin.headers);
    expect(event.occurrenceStart).toBe(event.startsAt);
    expect(event.occurrenceEnd).toBe(event.endsAt);
    expect(event.recurringEventId).toBeNull();
  });

  // ------------------------------------------------------------ час і all-day

  it('rejects an event that ends before it starts, pointing at the field', async () => {
    const admin = await login('range');
    const response = await request(app.getHttpServer())
      .post('/api/calendar/events')
      .set(admin.headers)
      .send({ title: 'Broken', startsAt: END, endsAt: START })
      .expect(400);
    const body = response.body as { fieldErrors?: { field: string }[] };
    expect(body.fieldErrors?.[0]?.field).toBe('endsAt');
  });

  it('normalizes an all-day event to midnight boundaries of its own zone', async () => {
    const admin = await login('allday');
    const event = await createEvent(admin.headers, {
      title: 'Trade show',
      allDay: true,
      timeZone: 'Europe/Kyiv',
      // Час доби для all-day не значущий — сервер його ігнорує
      startsAt: '2027-03-10T13:45:00.000Z',
      endsAt: '2027-03-10T13:45:00.000Z',
    });

    // Київ у березні — UTC+2 (перехід ще не відбувся): доба = 22:00 попереднього дня
    expect(event.startsAt).toBe('2027-03-09T22:00:00.000Z');
    expect(event.endsAt).toBe('2027-03-10T22:00:00.000Z');
    expect(event.allDay).toBe(true);
    expect(event.timeZone).toBe('Europe/Kyiv');
  });

  it('keeps the event zone even when the request comes from another one', async () => {
    const admin = await login('zone');
    const event = await createEvent(admin.headers, { timeZone: 'America/New_York' });
    expect(event.timeZone).toBe('America/New_York');
    // Інстант не «переїхав»: зона описує, ЯК його задали, а не зсуває його
    expect(event.startsAt).toBe(START);
  });

  it('rejects an unknown IANA zone', async () => {
    const admin = await login('badzone');
    await request(app.getHttpServer())
      .post('/api/calendar/events')
      .set(admin.headers)
      .send({ title: 'Nowhere', startsAt: START, endsAt: END, timeZone: 'Mordor/Barad-dur' })
      .expect(400);
  });

  // ------------------------------------------------------------ доступ

  it('hides an event from a stranger with 404, not 403', async () => {
    const owner = await login('owner');
    const stranger = await login('stranger', 'USER');
    const event = await createEvent(owner.headers);

    // 404 свідомо: 403 підтвердив би існування зустрічі
    await request(app.getHttpServer())
      .get(`/api/calendar/events/${event.id}`)
      .set(stranger.headers)
      .expect(404);

    const body = await window(
      stranger.headers,
      '2027-03-10T00:00:00.000Z',
      '2027-03-11T00:00:00.000Z',
    );
    expect(body.items).toHaveLength(0);
  });

  it('lets an attendee see the event but not edit it', async () => {
    const owner = await login('owner2');
    const guest = await login('guest2', 'USER');
    const event = await createEvent(owner.headers, { attendees: [{ userId: guest.id }] });

    const seen = await request(app.getHttpServer())
      .get(`/api/calendar/events/${event.id}`)
      .set(guest.headers)
      .expect(200);
    const body = seen.body as EventBody;
    expect(body.canEdit).toBe(false);
    expect(body.isOrganizer).toBe(false);
    expect(body.myResponse).toBe('NEEDS_ACTION');

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}`)
      .set(guest.headers)
      .send({ title: 'Hijacked' })
      .expect(403);
  });

  it('does not let a tenant ADMIN read someone else private event', async () => {
    const owner = await login('privateowner', 'USER');
    const admin = await login('nosyadmin', 'ADMIN');
    const event = await createEvent(owner.headers, { visibility: 'PRIVATE' });

    await request(app.getHttpServer())
      .get(`/api/calendar/events/${event.id}`)
      .set(admin.headers)
      .expect(404);
  });

  it('shows a customer-linked event to colleagues who are not attendees', async () => {
    const owner = await login('crmowner');
    const colleague = await login('crmcolleague', 'USER');
    const customer = await request(app.getHttpServer())
      .post('/api/customers')
      .set(owner.headers)
      .send({ name: 'Acme Inc' })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;

    const event = await createEvent(owner.headers, { customerId });
    // Зустріч із клієнтом — робота компанії: колега її бачить (а приватну — ні)
    await request(app.getHttpServer())
      .get(`/api/calendar/events/${event.id}`)
      .set(colleague.headers)
      .expect(200);
  });

  // ------------------------------------------------------------ учасники і RSVP

  it('does not notify anyone when the attendee list is submitted unchanged', async () => {
    const owner = await login('diffowner');
    const guest = await login('diffguest', 'USER');
    const event = await createEvent(owner.headers, { attendees: [{ userId: guest.id }] });

    const afterCreate = await prisma.notification.count({ where: { recipientId: guest.id } });
    expect(afterCreate).toBe(1);

    // Той самий склад ще двічі: жодного нового сповіщення, жодної активності
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app.getHttpServer())
        .put(`/api/calendar/events/${event.id}/attendees`)
        .set(owner.headers)
        .send({ attendees: [{ userId: guest.id }, { userId: owner.id }] })
        .expect(200);
    }

    expect(await prisma.notification.count({ where: { recipientId: guest.id } })).toBe(1);
    expect(
      await prisma.activity.count({ where: { type: 'calendar_event.attendee_added' } }),
    ).toBe(0);
  });

  it('drops reminders of a removed attendee', async () => {
    const owner = await login('rmowner');
    const guest = await login('rmguest', 'USER');
    const event = await createEvent(owner.headers, { attendees: [{ userId: guest.id }] });

    await request(app.getHttpServer())
      .put(`/api/calendar/events/${event.id}/reminders`)
      .set(guest.headers)
      .send({ reminders: [{ minutesBefore: 30 }] })
      .expect(200);
    expect(await prisma.calendarReminder.count({ where: { userId: guest.id } })).toBe(1);

    await request(app.getHttpServer())
      .put(`/api/calendar/events/${event.id}/attendees`)
      .set(owner.headers)
      .send({ attendees: [{ userId: owner.id }] })
      .expect(200);

    expect(await prisma.calendarReminder.count({ where: { userId: guest.id } })).toBe(0);
    expect(
      await prisma.scheduledNotification.count({ where: { recipientId: guest.id } }),
    ).toBe(0);
  });

  it('records RSVP and notifies the organizer only', async () => {
    const owner = await login('rsvpowner');
    const guest = await login('rsvpguest', 'USER');
    const other = await login('rsvpother', 'USER');
    const event = await createEvent(owner.headers, {
      attendees: [{ userId: guest.id }, { userId: other.id }],
    });

    const response = await request(app.getHttpServer())
      .post(`/api/calendar/events/${event.id}/rsvp`)
      .set(guest.headers)
      .send({ response: 'ACCEPTED' })
      .expect(200);
    const body = response.body as EventBody;
    expect(body.myResponse).toBe('ACCEPTED');

    expect(
      await prisma.notification.count({
        where: { recipientId: owner.id, type: 'calendar_event.rsvp_changed' },
      }),
    ).toBe(1);
    // Решті учасників чужий RSVP не потрібен — інакше зустріч на десятьох
    // згенерувала б дев'ять сповіщень кожному
    expect(
      await prisma.notification.count({
        where: { recipientId: other.id, type: 'calendar_event.rsvp_changed' },
      }),
    ).toBe(0);
  });

  it('refuses RSVP from a non-attendee', async () => {
    const owner = await login('rsvpsolo');
    const stranger = await login('rsvpstranger', 'USER');
    const customer = await request(app.getHttpServer())
      .post('/api/customers')
      .set(owner.headers)
      .send({ name: 'Visible Inc' })
      .expect(201);
    // Подія видима (привʼязана до клієнта), але сторонній у ній не учасник
    const event = await createEvent(owner.headers, {
      customerId: (customer.body as { id: string }).id,
    });

    await request(app.getHttpServer())
      .post(`/api/calendar/events/${event.id}/rsvp`)
      .set(stranger.headers)
      .send({ response: 'ACCEPTED' })
      .expect(400);
  });

  // ------------------------------------------------------------ активності

  it('links the activity to the customer, so the customer feed shows the meeting', async () => {
    const admin = await login('feed');
    const customer = await request(app.getHttpServer())
      .post('/api/customers')
      .set(admin.headers)
      .send({ name: 'Feed Inc' })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
    await createEvent(admin.headers, { title: 'Kickoff', customerId });

    // Жодного нового ендпоінта: generic-фід кастомера з Activity Log
    const feed = await request(app.getHttpServer())
      .get('/api/activities')
      .query({ entityType: 'customer', entityId: customerId })
      .set(admin.headers)
      .expect(200);
    const types = (feed.body as { items: { type: string }[] }).items.map((item) => item.type);
    expect(types).toContain('calendar_event.created');
  });

  it('records a reschedule with both moments and notifies attendees', async () => {
    const owner = await login('moveowner');
    const guest = await login('moveguest', 'USER');
    const event = await createEvent(owner.headers, { attendees: [{ userId: guest.id }] });

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}`)
      .set(owner.headers)
      .send({ startsAt: '2027-03-10T14:00:00.000Z', endsAt: '2027-03-10T15:00:00.000Z' })
      .expect(200);

    const activity = await prisma.activity.findFirst({
      where: { type: 'calendar_event.rescheduled' },
    });
    const payload = activity?.payload as { previousStartsAt: string; startsAt: string } | undefined;
    expect(payload?.previousStartsAt).toBe(START);
    expect(payload?.startsAt).toBe('2027-03-10T14:00:00.000Z');
    expect(
      await prisma.notification.count({
        where: { recipientId: guest.id, type: 'calendar_event.rescheduled' },
      }),
    ).toBe(1);
  });

  it('keeps a cancelled event visible and only then removes it on delete', async () => {
    const admin = await login('cancel');
    const event = await createEvent(admin.headers);

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}/status`)
      .set(admin.headers)
      .send({ status: 'CANCELLED' })
      .expect(200);

    // Скасоване не показується за замовчуванням, але доступне за прапорцем
    const hidden = await window(
      admin.headers,
      '2027-03-10T00:00:00.000Z',
      '2027-03-11T00:00:00.000Z',
    );
    expect(hidden.items).toHaveLength(0);
    const shown = await window(
      admin.headers,
      '2027-03-10T00:00:00.000Z',
      '2027-03-11T00:00:00.000Z',
      { includeCancelled: 'true' },
    );
    expect(shown.items[0]?.status).toBe('CANCELLED');

    await request(app.getHttpServer())
      .delete(`/api/calendar/events/${event.id}`)
      .set(admin.headers)
      .expect(204);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  // ------------------------------------------------------------ нагадування

  it('materializes a reminder at start minus lead time', async () => {
    const admin = await login('remind');
    const event = await createEvent(admin.headers, { reminders: [{ minutesBefore: 30 }] });
    expect(event.reminders).toHaveLength(1);

    const rows = await prisma.scheduledNotification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fireAt.toISOString()).toBe('2027-03-10T09:30:00.000Z');
    expect(rows[0]?.recipientId).toBe(admin.id);
    expect(rows[0]?.type).toBe('calendar_event.reminder');
    // Ключ несе і подію, і момент входження — саме він дозволить матеріалізувати
    // горизонт серій у CAL-4
    expect(rows[0]?.dedupeKey).toContain(`calendar_event:${event.id}:reminder:`);
  });

  it('reschedules the materialized reminder when the event moves, without duplicating it', async () => {
    const admin = await login('remindmove');
    const event = await createEvent(admin.headers, { reminders: [{ minutesBefore: 30 }] });

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}`)
      .set(admin.headers)
      .send({ startsAt: '2027-03-10T16:00:00.000Z', endsAt: '2027-03-10T17:00:00.000Z' })
      .expect(200);

    const rows = await prisma.scheduledNotification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fireAt.toISOString()).toBe('2027-03-10T15:30:00.000Z');
  });

  it('drops materialized reminders when the event is cancelled and restores them back', async () => {
    const admin = await login('remindcancel');
    const event = await createEvent(admin.headers, { reminders: [{ minutesBefore: 15 }] });
    expect(await prisma.scheduledNotification.count()).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}/status`)
      .set(admin.headers)
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(await prisma.scheduledNotification.count()).toBe(0);

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}/status`)
      .set(admin.headers)
      .send({ status: 'CONFIRMED' })
      .expect(200);
    expect(await prisma.scheduledNotification.count()).toBe(1);
  });

  it('does not materialize a reminder whose moment is already in the past', async () => {
    const admin = await login('remindpast');
    // Подія в минулому: нагадування про неї не має сенсу навіть створювати —
    // сканер однаково позначив би його stale
    await createEvent(admin.headers, {
      startsAt: '2020-01-01T10:00:00.000Z',
      endsAt: '2020-01-01T11:00:00.000Z',
      reminders: [{ minutesBefore: 10 }],
    });
    expect(await prisma.scheduledNotification.count()).toBe(0);
  });

  it('claims a due reminder exactly once', async () => {
    const admin = await login('claim');
    const event = await createEvent(admin.headers, { reminders: [{ minutesBefore: 30 }] });
    expect(event.reminders).toHaveLength(1);

    const scheduled = app.get(ScheduledNotificationService);
    const tenantTx = app.get(TenantTransactions);
    const tenantContext = app.get(TenantContextService);

    // «Зараз» передається параметром — саме тому тест детермінований і не
    // спирається ні на sleep, ні на системний годинник
    const now = new Date('2027-03-10T09:31:00.000Z');
    const claim = async (): Promise<number> =>
      tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        tenantTx.withTenantTx(async (tx) => {
          const rows = await scheduled.claimDue(tx, now);
          await scheduled.markDelivered(
            tx,
            rows.map((row) => row.id),
            now,
          );
          return rows.length;
        }),
      );

    expect(await claim()).toBe(1);
    // Другий прогін (ретрай тіка, друга нода) не бере той самий рядок
    expect(await claim()).toBe(0);
  });

  it('keeps a claimed row when reminders are rescheduled', async () => {
    const admin = await login('claimkeep');
    const event = await createEvent(admin.headers, { reminders: [{ minutesBefore: 30 }] });

    const scheduled = app.get(ScheduledNotificationService);
    const tenantTx = app.get(TenantTransactions);
    const tenantContext = app.get(TenantContextService);
    await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) => scheduled.claimDue(tx, new Date('2027-03-10T09:31:00.000Z'))),
    );

    await request(app.getHttpServer())
      .patch(`/api/calendar/events/${event.id}`)
      .set(admin.headers)
      .send({ startsAt: '2027-03-11T10:00:00.000Z', endsAt: '2027-03-11T11:00:00.000Z' })
      .expect(200);

    // Захоплений рядок — правда про минуле, його не переписують; поруч
    // зʼявляється новий на новий час
    const rows = await prisma.scheduledNotification.findMany({ orderBy: { fireAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.claimedAt).not.toBeNull();
    expect(rows[1]?.claimedAt).toBeNull();
  });

  // ------------------------------------------------------------ налаштування

  it('uses organization defaults for zone and reminder when the request omits them', async () => {
    const admin = await login('defaults');
    await request(app.getHttpServer())
      .put('/api/settings/calendar')
      .set(admin.headers)
      .send({
        timeZone: 'Europe/Kyiv',
        weekStartsOn: 1,
        workDayStart: '08:00',
        workDayEnd: '17:00',
        defaultEventDurationMinutes: 45,
        defaultReminderMinutes: 20,
        defaultAllDayReminderMinutes: 900,
      })
      .expect(200);

    const event = await createEvent(admin.headers);
    expect(event.timeZone).toBe('Europe/Kyiv');
    expect(event.reminders[0]?.minutesBefore).toBe(20);
  });

  it('prefers the user own zone over the organization default', async () => {
    const admin = await login('userzone');
    await request(app.getHttpServer())
      .patch('/api/account/profile')
      .set(admin.headers)
      .send({ timeZone: 'America/New_York' })
      .expect(200);

    const event = await createEvent(admin.headers);
    expect(event.timeZone).toBe('America/New_York');
  });

  it('refuses calendar settings writes from a non-admin', async () => {
    const user = await login('nonadmin', 'USER');
    await request(app.getHttpServer())
      .put('/api/settings/calendar')
      .set(user.headers)
      .send({
        timeZone: 'UTC',
        weekStartsOn: 1,
        workDayStart: '09:00',
        workDayEnd: '18:00',
        defaultEventDurationMinutes: 30,
        defaultReminderMinutes: 10,
        defaultAllDayReminderMinutes: 900,
      })
      .expect(403);
  });

  // ------------------------------------------------------------ agenda

  it('pages the agenda by cursor without repeating events', async () => {
    const admin = await login('agenda');
    for (let index = 0; index < 3; index += 1) {
      await createEvent(admin.headers, {
        title: `Event ${String(index)}`,
        startsAt: `2027-03-1${String(index)}T10:00:00.000Z`,
        endsAt: `2027-03-1${String(index)}T11:00:00.000Z`,
      });
    }

    const first = await request(app.getHttpServer())
      .get('/api/calendar/agenda')
      .query({ limit: 2, from: '2027-01-01T00:00:00.000Z' })
      .set(admin.headers)
      .expect(200);
    const firstBody = first.body as { items: EventBody[]; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await request(app.getHttpServer())
      .get('/api/calendar/agenda')
      .query({ limit: 2, cursor: firstBody.nextCursor })
      .set(admin.headers)
      .expect(200);
    const secondBody = second.body as { items: EventBody[]; nextCursor: string | null };
    expect(secondBody.items).toHaveLength(1);
    const ids = [...firstBody.items, ...secondBody.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

});
