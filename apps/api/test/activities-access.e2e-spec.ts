/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

/**
 * Доступ до записів стрічки сутності (docs/activity-log.md «Хто що бачить у стрічці сутності»).
 * `GET /activities?entityType&entityId` адресується id, тож без фільтра на читанні будь-який
 * юзер тенанта читав приватні події календаря через стрічку клієнта і безпекові події колег.
 */
const START = '2027-03-10T10:00:00.000Z';
const END = '2027-03-10T11:00:00.000Z';

interface Actor {
  headers: { Authorization: string };
  id: string;
}

describe('Activity feed access (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, SystemPrismaModule],
    }).compile();
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
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (suffix: string, role: 'ADMIN' | 'USER'): Promise<Actor> => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `feed-${suffix}@example.com`,
      password: 'SecurePass123',
      name: `Feed ${suffix}`,
      role,
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, id: user.id };
  };

  const createCustomer = async (actor: Actor): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set(actor.headers)
      .send({ name: 'Acme Inc' })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  const createEvent = async (
    actor: Actor,
    body: Record<string, unknown>,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/calendar/events')
      .set(actor.headers)
      .send({ title: 'Secret board meeting', startsAt: START, endsAt: END, ...body })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  const feed = async (
    actor: Actor,
    entityType: string,
    entityId: string,
  ): Promise<{ type: string; payload: Record<string, unknown> }[]> => {
    const response = await request(app.getHttpServer())
      .get('/api/activities')
      .set(actor.headers)
      .query({ entityType, entityId })
      .expect(200);
    return (response.body as { items: { type: string; payload: Record<string, unknown> }[] })
      .items;
  };

  const calendarTypes = (items: { type: string }[]): string[] =>
    items.map((item) => item.type).filter((type) => type.startsWith('calendar_event.'));

  describe('private calendar events', () => {
    it("hides a PRIVATE customer event's activity from colleagues in the customer and event feeds", async () => {
      const owner = await login('owner', 'USER');
      const colleague = await login('colleague', 'USER');
      const customerId = await createCustomer(owner);
      const eventId = await createEvent(owner, { customerId, visibility: 'PRIVATE' });

      expect(calendarTypes(await feed(colleague, 'customer', customerId))).toEqual([]);
      expect(await feed(colleague, 'calendar_event', eventId)).toEqual([]);
      // Ні заголовок, ні час не просочуються ні в якому вигляді
      const raw = await request(app.getHttpServer())
        .get('/api/activities')
        .set(colleague.headers)
        .query({ entityType: 'customer', entityId: customerId })
        .expect(200);
      expect(JSON.stringify(raw.body)).not.toContain('Secret board meeting');

      // Організатор свою подію бачить в обох стрічках
      expect(calendarTypes(await feed(owner, 'customer', customerId))).toEqual([
        'calendar_event.created',
      ]);
      expect(calendarTypes(await feed(owner, 'calendar_event', eventId))).toEqual([
        'calendar_event.created',
      ]);
    });

    it('shows a PRIVATE event to an attendee, and a DEFAULT customer event to everyone', async () => {
      const owner = await login('owner2', 'USER');
      const guest = await login('guest2', 'USER');
      const colleague = await login('colleague2', 'USER');
      const customerId = await createCustomer(owner);
      const privateId = await createEvent(owner, {
        customerId,
        visibility: 'PRIVATE',
        attendees: [{ userId: guest.id }],
      });
      await createEvent(owner, { customerId, title: 'Public call' });

      const guestView = await feed(guest, 'customer', customerId);
      expect(
        guestView.some((a) => (a.payload.event as { id: string } | undefined)?.id === privateId),
      ).toBe(true);
      // Колега без участі бачить лише публічну (привʼязану до клієнта) подію
      const colleagueView = await feed(colleague, 'customer', customerId);
      expect(calendarTypes(colleagueView)).toEqual(['calendar_event.created']);
      expect(
        colleagueView.every(
          (a) => (a.payload.event as { id: string } | undefined)?.id !== privateId,
        ),
      ).toBe(true);
    });

    it('hides old activity once the event becomes PRIVATE (checked on read, not on write)', async () => {
      const owner = await login('owner3', 'USER');
      const colleague = await login('colleague3', 'USER');
      const customerId = await createCustomer(owner);
      const eventId = await createEvent(owner, { customerId });

      // Поки подія публічна, колега бачить її в стрічці клієнта
      expect(calendarTypes(await feed(colleague, 'customer', customerId))).toEqual([
        'calendar_event.created',
      ]);

      await request(app.getHttpServer())
        .patch(`/api/calendar/events/${eventId}`)
        .set(owner.headers)
        .send({ visibility: 'PRIVATE' })
        .expect(200);

      expect(calendarTypes(await feed(colleague, 'customer', customerId))).toEqual([]);
      expect(await feed(colleague, 'calendar_event', eventId)).toEqual([]);
      expect(calendarTypes(await feed(owner, 'customer', customerId))).toEqual([
        'calendar_event.created',
      ]);

      // Назад у публічні — стрічка повертається (лінки не чіпали, рішення живе на читанні)
      await request(app.getHttpServer())
        .patch(`/api/calendar/events/${eventId}`)
        .set(owner.headers)
        .send({ visibility: 'DEFAULT' })
        .expect(200);
      expect(calendarTypes(await feed(colleague, 'customer', customerId))).toEqual([
        'calendar_event.created',
      ]);
    });

    it('does not leak a deleted event: its activity stays hidden from colleagues', async () => {
      const owner = await login('owner4', 'USER');
      const colleague = await login('colleague4', 'USER');
      const customerId = await createCustomer(owner);
      const eventId = await createEvent(owner, { customerId, visibility: 'PRIVATE' });
      await request(app.getHttpServer())
        .delete(`/api/calendar/events/${eventId}`)
        .set(owner.headers)
        .expect(204);

      expect(calendarTypes(await feed(colleague, 'customer', customerId))).toEqual([]);
    });

    it('does not let a page slot be eaten by hidden events (cursor between visible ones)', async () => {
      const owner = await login('owner5', 'USER');
      const colleague = await login('colleague5', 'USER');
      const customerId = await createCustomer(owner);
      await createEvent(owner, { customerId, title: 'Visible one' });
      await createEvent(owner, { customerId, visibility: 'PRIVATE' });
      await createEvent(owner, { customerId, title: 'Visible two' });

      const page = async (
        cursor?: string,
      ): Promise<{ items: { payload: { event?: { label: string } } }[]; nextCursor: string | null }> => {
        const response = await request(app.getHttpServer())
          .get('/api/activities')
          .set(colleague.headers)
          .query({
            entityType: 'customer',
            entityId: customerId,
            type: 'calendar_event.created',
            limit: 1,
            ...(cursor && { cursor }),
          })
          .expect(200);
        return response.body as Awaited<ReturnType<typeof page>>;
      };
      // Приватна подія лежить МІЖ двома видимими: сторінка з limit=1 мусить дати саме видимі
      const first = await page();
      expect(first.items.map((item) => item.payload.event?.label)).toEqual(['Visible two']);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(first.nextCursor ?? undefined);
      expect(second.items.map((item) => item.payload.event?.label)).toEqual(['Visible one']);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('security activities of a user', () => {
    const seed = async (userId: string, type: string): Promise<void> => {
      const activity = await prisma.activity.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          type,
          actorType: 'system',
          payload: { user: { kind: 'user', id: userId, label: 'Subject' }, sessionCount: 1 },
        },
      });
      await prisma.activityLink.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          activityId: activity.id,
          entityType: 'user',
          entityId: userId,
          role: 'subject',
        },
      });
    };

    it("hides colleagues' password/session/email activities, keeps them for the subject and ADMIN", async () => {
      const subject = await login('subject', 'USER');
      const colleague = await login('peer', 'USER');
      const admin = await login('admin', 'ADMIN');
      for (const type of ['user.password_changed', 'user.sessions_revoked', 'user.email_changed']) {
        await seed(subject.id, type);
      }
      // Не безпековий тип лишається видимим усім, хто бачить стрічку
      await seed(subject.id, 'user.enabled');

      expect((await feed(colleague, 'user', subject.id)).map((a) => a.type)).toEqual([
        'user.enabled',
      ]);
      expect((await feed(subject, 'user', subject.id)).map((a) => a.type).sort()).toEqual([
        'user.email_changed',
        'user.enabled',
        'user.password_changed',
        'user.sessions_revoked',
      ]);
      expect(await feed(admin, 'user', subject.id)).toHaveLength(4);

      // Фільтр type не обходить обмеження
      const byType = await request(app.getHttpServer())
        .get('/api/activities')
        .set(colleague.headers)
        .query({ entityType: 'user', entityId: subject.id, type: 'user.password_changed' })
        .expect(200);
      expect((byType.body as { items: unknown[] }).items).toEqual([]);
    });
  });

  describe('GET /settings/activity', () => {
    it('is ADMIN-only', async () => {
      const user = await login('plain', 'USER');
      const admin = await login('boss', 'ADMIN');
      await request(app.getHttpServer())
        .get('/api/settings/activity')
        .set(user.headers)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/settings/activity')
        .set(admin.headers)
        .expect(200);
    });
  });
});
