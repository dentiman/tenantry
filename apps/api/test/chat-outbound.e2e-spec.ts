/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-2b: відповідь клієнтові, нотатка, повторна відправка, статус і призначення — проти справжньої
// БД. Воркера тут немає (pg-boss замінений мокою): що робить доставка, перевіряє chat-delivery.

// Fake-адаптер потрапляє в реєстр лише під цим прапорцем (читається під час побудови застосунку)
process.env.CHAT_DEV_TOOLS = 'true';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000046';
const TENANT_B_SLUG = 'chat-outbound-b';
const DELIVER_QUEUE = 'channels.deliver-outbound/channels-deliver';

interface Person {
  id: string;
  headers: { Authorization: string };
}

interface MessageBody {
  id: string;
  seq: number;
  status: string;
  visibility: string;
  direction: string | null;
  body: string | null;
  senderId: string | null;
  failure: { class: string; code: string } | null;
  payload: Record<string, unknown>;
}

describe('Customer replies and workflow (e2e, CHAT-2b)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let accountId: string;
  let channelId: string;
  const userIds: string[] = [];
  const customerIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'Outbound tenant B' },
    });
  });

  beforeEach(async () => {
    sentJobs.reset();
    const account = await prisma.messagingAccount.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        provider: 'fake',
        name: 'outbound e2e',
        verifyToken: 'v',
        webhookKey: randomBytes(16).toString('hex'),
      },
    });
    accountId = account.id;
    channelId = (
      await prisma.channel.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId,
          type: 'WHATSAPP',
          provider: 'fake',
          externalId: `out-${randomUUID()}`,
          displayPhoneNumber: '+1 555 000 0003',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.messagingAccount.delete({ where: { id: accountId } });
    await prisma.activity.deleteMany({ where: { type: { startsWith: 'conversation.' } } });
    if (customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      customerIds.length = 0;
    }
    if (userIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: userIds } } } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.user.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const login = async (prefix: string): Promise<Person> => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
      password: 'SecurePass123',
      name: prefix,
      role: 'USER',
    });
    userIds.push(user.id);
    return { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  /** Клієнтська розмова з одним вхідним; `customerAt` — час провайдера останнього вхідного */
  async function conversation(opts: {
    customerAt?: Date | null;
    status?: 'OPEN' | 'PENDING' | 'RESOLVED';
    assigneeId?: string;
    customerId?: string;
    contactId?: string;
  } = {}): Promise<{ id: string; contactId: string }> {
    const customerAt = opts.customerAt === undefined ? new Date() : opts.customerAt;
    const contactId =
      opts.contactId ??
      (
        await prisma.channelContact.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            channelId,
            displayName: 'Клієнт',
            ...(opts.customerId && { customerId: opts.customerId }),
          },
        })
      ).id;
    if (!opts.contactId) {
      await prisma.channelContactAddress.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          contactId,
          channelId,
          kind: 'phone',
          value: `38050${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
        },
      });
    }
    const created = await prisma.conversation.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        kind: 'CUSTOMER',
        access: 'tenant',
        status: opts.status ?? 'OPEN',
        channelId,
        contactId,
        assigneeId: opts.assigneeId ?? null,
        customerLastMessageAt: customerAt,
        lastSeq: 1,
        lastMessageAt: customerAt ?? new Date(),
        lastMessagePreview: 'hello',
        ...(opts.status === 'RESOLVED' && { resolvedAt: new Date() }),
      },
    });
    await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: created.id,
        seq: 1,
        kind: 'TEXT',
        senderType: 'customer',
        senderLabel: 'Клієнт',
        body: 'hello',
        direction: 'INBOUND',
        channelId,
        externalId: randomUUID(),
      },
    });
    if (opts.assigneeId) {
      await prisma.conversationParticipant.create({
        data: { tenantId: DEFAULT_TENANT_ID, conversationId: created.id, userId: opts.assigneeId },
      });
    }
    return { id: created.id, contactId };
  }

  const reply = (who: Person, id: string, body: string, extra: Record<string, unknown> = {}, cid = randomUUID()) =>
    http()
      .post(`/api/conversations/${id}/messages`)
      .set(who.headers)
      .send({ body, clientMessageId: cid, ...extra });

  const entries = (id: string) =>
    prisma.chatMessage.findMany({ where: { conversationId: id, kind: 'SYSTEM' }, orderBy: { seq: 'asc' } });

  describe('відповідь', () => {
    it('приймається як QUEUED/OUTBOUND і ставить рівно одну доставку з ключем розмови', async () => {
      const agent = await login('out-agent');
      const { id } = await conversation();

      const res = await reply(agent, id, 'Добрий день!').expect(201);
      const message = res.body as MessageBody;
      expect(message).toMatchObject({ status: 'QUEUED', direction: 'OUTBOUND', visibility: 'PUBLIC', senderId: agent.id });

      const jobs = sentJobs.forQueue(DELIVER_QUEUE);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.envelope).toMatchObject({
        name: 'channels.deliver-outbound',
        tenantId: DEFAULT_TENANT_ID,
        actor: { type: 'user', id: agent.id },
        data: { messageId: message.id },
      });
      expect(jobs[0]?.options).toMatchObject({ singletonKey: id });
      // у pgboss.* (поза RLS) тексту листування немає
      expect(JSON.stringify(jobs[0]?.envelope)).not.toContain('Добрий день');
    });

    it('повтор clientMessageId повертає те саме повідомлення й не ставить другу доставку', async () => {
      const agent = await login('out-replay');
      const { id } = await conversation();
      const cid = randomUUID();

      const first = (await reply(agent, id, 'once', {}, cid).expect(201)).body as MessageBody;
      const second = (await reply(agent, id, 'once', {}, cid).expect(201)).body as MessageBody;

      expect(second.id).toBe(first.id);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });

    it('повтор після закриття вікна повертає збережене, а не 422', async () => {
      const agent = await login('out-replay-late');
      const { id } = await conversation();
      const cid = randomUUID();
      const first = (await reply(agent, id, 'once', {}, cid).expect(201)).body as MessageBody;
      await prisma.conversation.update({ where: { id }, data: { customerLastMessageAt: new Date(Date.now() - 48 * 3_600_000) } });

      const again = (await reply(agent, id, 'once', {}, cid).expect(201)).body as MessageBody;
      expect(again.id).toBe(first.id);
    });

    it('два однакові запити одночасно: одне повідомлення, одна доставка, обидва 201, одне призначення', async () => {
      const agent = await login('out-race');
      const { id } = await conversation();
      const cid = randomUUID();

      const [a, b] = await Promise.all([reply(agent, id, 'race', {}, cid), reply(agent, id, 'race', {}, cid)]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect((a.body as MessageBody).id).toBe((b.body as MessageBody).id);
      expect(await prisma.chatMessage.count({ where: { conversationId: id, clientMessageId: cid } })).toBe(1);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
      // програвший відкотився цілком: жодного зайвого «призначено»
      expect((await entries(id)).filter((e) => (e.payload as { type?: string }).type === 'conversation.assigned')).toHaveLength(1);
    });

    it('поза вікном — 422 CHANNEL_WINDOW_CLOSED, нічого не записано й не поставлено в чергу', async () => {
      const agent = await login('out-window');
      const { id } = await conversation({ customerAt: new Date(Date.now() - 25 * 3_600_000) });

      const res = await reply(agent, id, 'late').expect(422);

      expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
      expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(1);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
    });

    it('у межах вікна (23 год) — приймається; клієнт ніколи не писав — 422', async () => {
      const agent = await login('out-window-edge');
      const inside = await conversation({ customerAt: new Date(Date.now() - 23 * 3_600_000) });
      await reply(agent, inside.id, 'ok').expect(201);

      const never = await conversation({ customerAt: null });
      const res = await reply(agent, never.id, 'who?').expect(422);
      expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
    });

    it('тіло понад ліміт чату — 400 і нічого не записано', async () => {
      const agent = await login('out-long');
      const { id } = await conversation();
      await reply(agent, id, 'x'.repeat(4001)).expect(400);
      expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(1);
    });

    it('користувач іншого тенанта отримує 404 і нічого не записує', async () => {
      const { id } = await conversation();
      const email = `out-b-${String(Date.now())}@example.com`;
      await prisma.user.create({
        data: { tenantId: TENANT_B_ID, email, name: 'B', role: 'USER', passwordHash: await argon2.hash('SecurePass123') },
      });
      const login2 = await http().post('/api/auth/login').send({ email, password: 'SecurePass123', tenant: TENANT_B_SLUG }).expect(200);
      const headers = { Authorization: `Bearer ${(login2.body as { tokens: { accessToken: string } }).tokens.accessToken}` };

      await http().post(`/api/conversations/${id}/messages`).set(headers).send({ body: 'x', clientMessageId: randomUUID() }).expect(404);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
    });
  });

  describe('вікно в картці розмови', () => {
    it('canReply і replyWindowEndsAt: відкрите, закрите, ще не писав; внутрішня завжди true', async () => {
      const agent = await login('out-card');
      const peer = await login('out-card-peer');
      const card = async (id: string) =>
        (await http().get(`/api/conversations/${id}`).set(agent.headers).expect(200)).body as {
          canReply: boolean;
          replyWindowEndsAt: string | null;
        };

      const at = new Date(Date.now() - 2 * 3_600_000);
      const open = await card((await conversation({ customerAt: at })).id);
      expect(open.canReply).toBe(true);
      expect(new Date(open.replyWindowEndsAt ?? 0).getTime()).toBe(at.getTime() + 24 * 3_600_000);

      const closed = await card((await conversation({ customerAt: new Date(Date.now() - 30 * 3_600_000) })).id);
      expect(closed.canReply).toBe(false);
      expect(closed.replyWindowEndsAt).not.toBeNull();

      expect(await card((await conversation({ customerAt: null })).id)).toMatchObject({
        canReply: false,
        replyWindowEndsAt: null,
      });

      const internal = await http().post('/api/conversations').set(agent.headers).send({ participantUserIds: [peer.id] }).expect(201);
      expect(await card((internal.body as { id: string }).id)).toMatchObject({ canReply: true, replyWindowEndsAt: null });
    });
  });

  describe('нотатки', () => {
    it('поза вікном: записується для колег, не йде в чергу, не чіпає порядок і прев’ю', async () => {
      const agent = await login('out-note');
      const stale = new Date(Date.now() - 72 * 3_600_000);
      const { id } = await conversation({ customerAt: stale });
      const before = await prisma.conversation.findUniqueOrThrow({ where: { id } });

      const res = await reply(agent, id, 'внутрішня примітка', { visibility: 'INTERNAL' }).expect(201);

      expect(res.body).toMatchObject({ visibility: 'INTERNAL', status: 'SENT', direction: null });
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
      const after = await prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(after.lastMessageAt).toEqual(before.lastMessageAt);
      expect(after.lastMessagePreview).toBe(before.lastMessagePreview);
      expect(after.assigneeId).toBeNull(); // нотатка не привласнює розмову
    });

    it('не рахується в «чекає відповіді»: остання публічна репліка лишається клієнтською', async () => {
      const agent = await login('out-note-await');
      const { id } = await conversation();
      await reply(agent, id, 'нотатка', { visibility: 'INTERNAL' }).expect(201);

      const inbox = await http().get('/api/chat/inbox').query({ filter: 'all' }).set(agent.headers).expect(200);
      const row = (inbox.body as { items: { id: string; awaitingReply: boolean }[] }).items.find((i) => i.id === id);
      expect(row?.awaitingReply).toBe(true);
    });

    it('у внутрішній розмові нотатка недопустима — 400', async () => {
      const agent = await login('out-note-internal');
      const peer = await login('out-note-peer');
      const created = await http().post('/api/conversations').set(agent.headers).send({ participantUserIds: [peer.id] }).expect(201);
      await reply(agent, (created.body as { id: string }).id, 'x', { visibility: 'INTERNAL' }).expect(400);
    });
  });

  describe('привласнення і повторне відкриття відповіддю', () => {
    it('перша відповідь у нічию розмову привласнює її автору (з рядком учасника і записом)', async () => {
      const agent = await login('out-claim');
      const { id } = await conversation();

      await reply(agent, id, 'беру').expect(201);

      const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(row.assigneeId).toBe(agent.id);
      expect(await prisma.conversationParticipant.count({ where: { conversationId: id, userId: agent.id, leftAt: null } })).toBe(1);
      const assigned = (await entries(id)).filter((e) => (e.payload as { type?: string }).type === 'conversation.assigned');
      expect(assigned).toHaveLength(1);
      expect(assigned[0]?.senderUserId).toBe(agent.id);
    });

    it('дві перші відповіді одночасно: рівно один відповідальний, обидва повідомлення збережені', async () => {
      const a = await login('out-claim-a');
      const b = await login('out-claim-b');
      const { id } = await conversation();

      const [ra, rb] = await Promise.all([reply(a, id, 'від A'), reply(b, id, 'від B')]);

      expect([ra.status, rb.status]).toEqual([201, 201]);
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect([a.id, b.id]).toContain(row.assigneeId);
      expect(await prisma.conversationParticipant.count({ where: { conversationId: id, leftAt: null } })).toBe(1);
      expect(await prisma.chatMessage.count({ where: { conversationId: id, direction: 'OUTBOUND' } })).toBe(2);
      expect((await entries(id)).filter((e) => (e.payload as { type?: string }).type === 'conversation.assigned')).toHaveLength(1);
    });

    it('відповідь у вже призначену розмову не міняє відповідального', async () => {
      const owner = await login('out-owner');
      const other = await login('out-other');
      const { id } = await conversation({ assigneeId: owner.id });

      await reply(other, id, 'я теж').expect(201);

      expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(owner.id);
    });

    it('відповідь у розв’язану розмову відкриває її; у відкладену (PENDING) — лишає як є', async () => {
      const agent = await login('out-reopen');
      const resolved = await conversation({ status: 'RESOLVED' });
      await reply(agent, resolved.id, 'ще раз').expect(201);
      const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: resolved.id } });
      expect(reopened.status).toBe('OPEN');
      expect(reopened.resolvedAt).toBeNull();
      const change = (await entries(resolved.id)).find((e) => (e.payload as { type?: string }).type === 'conversation.status_changed');
      expect(change?.payload).toMatchObject({ from: 'RESOLVED', to: 'OPEN' });

      const pending = await conversation({ status: 'PENDING' });
      await reply(agent, pending.id, 'чекаю').expect(201);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
    });

    it('запис «відкрито» і «призначено» лягають ДО самої відповіді в стрічці', async () => {
      const agent = await login('out-order');
      const { id } = await conversation({ status: 'RESOLVED' });
      const message = (await reply(agent, id, 'порядок').expect(201)).body as MessageBody;
      const seqs = (await entries(id)).map((e) => e.seq);
      expect(Math.max(...seqs)).toBeLessThan(message.seq);
    });
  });

  describe('повторна відправка', () => {
    async function failedMessage(id: string, agentId: string): Promise<string> {
      const created = await prisma.chatMessage.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          conversationId: id,
          seq: 2,
          kind: 'TEXT',
          visibility: 'PUBLIC',
          status: 'FAILED',
          senderType: 'user',
          senderUserId: agentId,
          senderLabel: 'agent',
          body: 'не дійшло',
          direction: 'OUTBOUND',
          channelId,
          attempts: 5,
          failure: { class: 'TRANSIENT', code: '131000', title: 'boom' },
        },
      });
      await prisma.conversation.update({ where: { id }, data: { lastSeq: 2 } });
      return created.id;
    }

    it('невдале повертається в QUEUED з очищеною причиною, лічильник спроб скинуто, одна доставка', async () => {
      const agent = await login('out-resend');
      const { id } = await conversation();
      const messageId = await failedMessage(id, agent.id);

      const res = await http().post(`/api/conversations/${id}/messages/${messageId}/resend`).set(agent.headers).expect(201);

      expect(res.body).toMatchObject({ id: messageId, status: 'QUEUED', failure: null });
      expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId } })).attempts).toBe(0);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });

    it('не-невдале — 409, нічого не ставиться в чергу', async () => {
      const agent = await login('out-resend-409');
      const { id } = await conversation();
      const sent = (await reply(agent, id, 'ok').expect(201)).body as MessageBody;
      sentJobs.reset();

      await http().post(`/api/conversations/${id}/messages/${sent.id}/resend`).set(agent.headers).expect(409);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
    });

    it('двоє одночасно: одна доставка, один 201 і один 409', async () => {
      const a = await login('out-resend-a');
      const b = await login('out-resend-b');
      const { id } = await conversation();
      const messageId = await failedMessage(id, a.id);

      const results = await Promise.all(
        [a, b].map((who) => http().post(`/api/conversations/${id}/messages/${messageId}/resend`).set(who.headers)),
      );

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });

    it('поки вікно закрите — 422', async () => {
      const agent = await login('out-resend-window');
      const { id } = await conversation({ customerAt: new Date(Date.now() - 30 * 3_600_000) });
      const messageId = await failedMessage(id, agent.id);

      const res = await http().post(`/api/conversations/${id}/messages/${messageId}/resend`).set(agent.headers).expect(422);
      expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
    });

    it('у внутрішній розмові — 404', async () => {
      const agent = await login('out-resend-internal');
      const peer = await login('out-resend-peer');
      const created = await http().post('/api/conversations').set(agent.headers).send({ participantUserIds: [peer.id] }).expect(201);
      await http().post(`/api/conversations/${(created.body as { id: string }).id}/messages/${randomUUID()}/resend`).set(agent.headers).expect(404);
    });
  });

  describe('статус', () => {
    it('розв’язати: статус, час, запис у стрічці й активність на розмові та на клієнті', async () => {
      const agent = await login('out-status');
      const customer = await prisma.customer.create({
        data: { tenantId: DEFAULT_TENANT_ID, name: 'Acme', number: Math.floor(Math.random() * 1_000_000_000) },
      });
      customerIds.push(customer.id);
      const { id } = await conversation({ customerId: customer.id });

      const res = await http().put(`/api/conversations/${id}/status`).set(agent.headers).send({ status: 'RESOLVED' }).expect(200);

      expect(res.body).toMatchObject({ status: 'RESOLVED' });
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(row.resolvedAt).not.toBeNull();
      const entry = (await entries(id)).find((e) => (e.payload as { type?: string }).type === 'conversation.status_changed');
      expect(entry).toMatchObject({ senderUserId: agent.id, visibility: 'INTERNAL' });
      expect(entry?.payload).toMatchObject({ from: 'OPEN', to: 'RESOLVED' });

      const links = await prisma.activityLink.findMany({
        where: { activity: { type: 'conversation.status_changed' } },
        select: { entityType: true, entityId: true },
      });
      expect(links).toEqual(
        expect.arrayContaining([
          { entityType: 'conversation', entityId: id },
          { entityType: 'customer', entityId: customer.id },
        ]),
      );
    });

    it('той самий статус удруге — нічого не пишеться', async () => {
      const agent = await login('out-status-noop');
      const { id } = await conversation({ status: 'PENDING' });

      await http().put(`/api/conversations/${id}/status`).set(agent.headers).send({ status: 'PENDING' }).expect(200);

      expect(await entries(id)).toHaveLength(0);
      expect(await prisma.activity.count({ where: { type: 'conversation.status_changed' } })).toBe(0);
    });

    it('відкрити розв’язану, коли в контакта вже є інша відкрита розмова — 409', async () => {
      const agent = await login('out-status-blocked');
      const old = await conversation({ status: 'RESOLVED' });
      await conversation({ contactId: old.contactId, status: 'OPEN' });

      await http().put(`/api/conversations/${old.id}/status`).set(agent.headers).send({ status: 'OPEN' }).expect(409);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('RESOLVED');
    });

    it('невідомий статус і SNOOZED — 400; внутрішня розмова — 400', async () => {
      const agent = await login('out-status-bad');
      const peer = await login('out-status-peer');
      const { id } = await conversation();
      await http().put(`/api/conversations/${id}/status`).set(agent.headers).send({ status: 'SNOOZED' }).expect(400);
      const internal = await http().post('/api/conversations').set(agent.headers).send({ participantUserIds: [peer.id] }).expect(201);
      await http().put(`/api/conversations/${(internal.body as { id: string }).id}/status`).set(agent.headers).send({ status: 'RESOLVED' }).expect(400);
    });
  });

  describe('призначення', () => {
    it('призначити колегу: відповідальний, рядок учасника, запис і активність; «мої» бачить колега', async () => {
      const agent = await login('out-assign');
      const colleague = await login('out-assign-colleague');
      const { id } = await conversation();

      const res = await http().put(`/api/conversations/${id}/assignee`).set(agent.headers).send({ userId: colleague.id }).expect(200);

      expect((res.body as { assignee: { id: string } | null }).assignee?.id).toBe(colleague.id);
      expect(await prisma.conversationParticipant.count({ where: { conversationId: id, userId: colleague.id, leftAt: null } })).toBe(1);
      const entry = (await entries(id)).find((e) => (e.payload as { type?: string }).type === 'conversation.assigned');
      expect(entry?.payload).toMatchObject({ assignee: { id: colleague.id } });
      expect(entry?.senderUserId).toBe(agent.id);
      expect(await prisma.activity.count({ where: { type: 'conversation.assigned' } })).toBe(1);

      const mine = await http().get('/api/chat/inbox').query({ filter: 'mine' }).set(colleague.headers).expect(200);
      expect((mine.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([id]);
    });

    it('новий відповідальний бачить непрочитаним те, на що чекають; колишній перестає бути учасником', async () => {
      const first = await login('out-assign-first');
      const second = await login('out-assign-second');
      const { id } = await conversation({ assigneeId: first.id });

      await http().put(`/api/conversations/${id}/assignee`).set(first.headers).send({ userId: second.id }).expect(200);

      const mine = await http().get('/api/chat/inbox').query({ filter: 'mine' }).set(second.headers).expect(200);
      expect((mine.body as { items: { id: string; unreadCount: number }[] }).items[0]).toMatchObject({ id, unreadCount: 1 });
      expect(
        (await prisma.conversationParticipant.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId: first.id } } })).leftAt,
      ).not.toBeNull();
    });

    it('зняти призначення → «нерозібрані»; повторно призначити того ж — без запису', async () => {
      const agent = await login('out-unassign');
      const { id } = await conversation({ assigneeId: agent.id });
      await http().put(`/api/conversations/${id}/assignee`).set(agent.headers).send({ userId: null }).expect(200);
      const free = await http().get('/api/chat/inbox').query({ filter: 'unassigned' }).set(agent.headers).expect(200);
      expect((free.body as { items: { id: string }[] }).items.map((i) => i.id)).toContain(id);

      const before = (await entries(id)).length;
      await http().put(`/api/conversations/${id}/assignee`).set(agent.headers).send({ userId: null }).expect(200);
      expect((await entries(id)).length).toBe(before);
    });

    it('деактивований — 400 з полем; користувач іншого тенанта — 404', async () => {
      const agent = await login('out-assign-bad');
      const { id } = await conversation();
      const gone = await prisma.user.create({
        data: { tenantId: DEFAULT_TENANT_ID, email: `gone-${String(Date.now())}@example.com`, name: 'gone', role: 'USER', isActive: false, passwordHash: 'x' },
      });
      userIds.push(gone.id);
      const foreign = await prisma.user.create({
        data: { tenantId: TENANT_B_ID, email: `foreign-${String(Date.now())}@example.com`, name: 'f', role: 'USER', passwordHash: 'x' },
      });

      const res = await http().put(`/api/conversations/${id}/assignee`).set(agent.headers).send({ userId: gone.id }).expect(400);
      expect((res.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe('userId');
      await http().put(`/api/conversations/${id}/assignee`).set(agent.headers).send({ userId: foreign.id }).expect(404);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).assigneeId).toBeNull();
    });

    it('призначена клієнтська розмова не потрапляє у список внутрішніх', async () => {
      const agent = await login('out-list');
      const { id } = await conversation({ assigneeId: agent.id });
      const list = await http().get('/api/conversations').set(agent.headers).expect(200);
      expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(id);
    });
  });
});
