/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { SystemPrismaService } from '@saas-skeleton/database';
import { CryptoService } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-2a: клієнтські розмови — доступ (гілка `tenant`), скринька, привʼязка контакта, акаунт.
// Сцена збирається напряму через SystemPrismaService (BYPASSRLS): що саме приходить із вебхука —
// предмет інших сьютів, тут перевіряється те, що бачить і може робити людина.

// Fake-адаптер у реєстрі лише під цим прапорцем: без нього відповідь відхиляється як «каналу немає»
process.env.CHAT_DEV_TOOLS = 'true';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000045';
const TENANT_B_SLUG = 'chat-inbox-b';
const SECRET_VALUE = 'super-secret-signing-value';

interface Person {
  id: string;
  headers: { Authorization: string };
}

interface InboxBody {
  items: {
    id: string;
    status: string;
    awaitingReply: boolean;
    assigneeId: string | null;
    contact: { id: string; displayName: string | null; phone: string | null; customer: { id: string; name: string } | null };
    channel: { id: string; displayPhoneNumber: string | null };
    lastMessagePreview: string | null;
  }[];
  nextCursor: string | null;
}

describe('Customer inbox (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let accountId: string;
  let channelId: string;
  const customerIds: string[] = [];
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'Inbox tenant B' },
    });
  });

  beforeEach(async () => {
    const account = await prisma.messagingAccount.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        provider: 'fake',
        name: 'inbox e2e',
        verifyToken: 'verify-xyz',
        webhookKey: randomBytes(16).toString('hex'),
        appSecret: app.get(CryptoService).encrypt(SECRET_VALUE),
        credentials: app.get(CryptoService).encrypt('access-token-value'),
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
          externalId: `inbox-${randomUUID()}`,
          displayPhoneNumber: '+1 555 000 0002',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    delete process.env.CHANNEL_WEBHOOK_BASE_URL;
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.delete({ where: { id: accountId } });
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
    await prisma.customer.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.authSession.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.user.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const login = async (prefix: string, role: 'ADMIN' | 'USER' = 'USER'): Promise<Person> => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
      password: 'SecurePass123',
      name: prefix,
      role,
    });
    userIds.push(user.id);
    return { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  const loginTenantB = async (): Promise<Person> => {
    const email = `inbox-b-${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email,
        name: 'B',
        role: 'USER',
        passwordHash: await argon2.hash('SecurePass123'),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'SecurePass123', tenant: TENANT_B_SLUG })
      .expect(200);
    const token = (res.body as { tokens: { accessToken: string } }).tokens.accessToken;
    return { id: user.id, headers: { Authorization: `Bearer ${token}` } };
  };

  /** Клієнтська розмова зі стрічкою; `lastInbound` — чи остання репліка клієнтська */
  async function customerConversation(opts: {
    name: string;
    at: Date;
    assigneeId?: string;
    lastInbound?: boolean;
    status?: 'OPEN' | 'RESOLVED';
  }): Promise<{ conversationId: string; contactId: string }> {
    const contact = await prisma.channelContact.create({
      data: { tenantId: DEFAULT_TENANT_ID, channelId, displayName: opts.name },
    });
    await prisma.channelContactAddress.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        contactId: contact.id,
        channelId,
        kind: 'phone',
        value: `38050${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        kind: 'CUSTOMER',
        access: 'tenant',
        status: opts.status ?? 'OPEN',
        channelId,
        contactId: contact.id,
        assigneeId: opts.assigneeId ?? null,
        lastSeq: 2,
        lastMessageAt: opts.at,
        lastMessagePreview: 'preview',
      },
    });
    await prisma.chatMessage.createMany({
      data: [
        {
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conversation.id,
          seq: 1,
          kind: 'TEXT',
          senderType: 'customer',
          senderLabel: opts.name,
          body: 'hello',
          direction: 'INBOUND',
          channelId,
          externalId: randomUUID(),
        },
        {
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conversation.id,
          seq: 2,
          kind: 'TEXT',
          senderType: opts.lastInbound === false ? 'user' : 'customer',
          senderLabel: opts.name,
          body: 'second',
          direction: opts.lastInbound === false ? 'OUTBOUND' : 'INBOUND',
          channelId,
          externalId: randomUUID(),
        },
      ],
    });
    return { conversationId: conversation.id, contactId: contact.id };
  }

  async function customer(name: string, tenantId = DEFAULT_TENANT_ID): Promise<string> {
    const created = await prisma.customer.create({
      data: { tenantId, name, number: Math.floor(Math.random() * 1_000_000_000) },
    });
    customerIds.push(created.id);
    return created.id;
  }

  describe('доступ: гілка tenant', () => {
    it('не-учасник читає клієнтську розмову і її стрічку', async () => {
      const reader = await login('inbox-reader');
      const { conversationId } = await customerConversation({ name: 'Клієнт', at: new Date() });

      const card = await http().get(`/api/conversations/${conversationId}`).set(reader.headers).expect(200);
      expect((card.body as { kind: string; participants: unknown[] }).kind).toBe('CUSTOMER');
      const transcript = await http()
        .get(`/api/conversations/${conversationId}/messages`)
        .set(reader.headers)
        .expect(200);
      expect((transcript.body as { items: unknown[] }).items).toHaveLength(2);
    });

    it('той самий користувач і далі отримує 404 на приватну внутрішню розмову; адмін теж', async () => {
      const creator = await login('inbox-creator');
      const other = await login('inbox-other');
      const admin = await login('inbox-admin', 'ADMIN');
      const created = await http()
        .post('/api/conversations')
        .set(creator.headers)
        .send({ participantUserIds: [creator.id] })
        .expect(201);
      const id = (created.body as { id: string; access: string; kind: string }).id;
      expect(created.body).toMatchObject({ kind: 'INTERNAL' });

      await http().get(`/api/conversations/${id}`).set(other.headers).expect(404);
      await http().get(`/api/conversations/${id}`).set(admin.headers).expect(404);
    });

    it('користувач іншого тенанта отримує 404 на клієнтську розмову', async () => {
      const outsider = await loginTenantB();
      const { conversationId } = await customerConversation({ name: 'Клієнт', at: new Date() });
      await http().get(`/api/conversations/${conversationId}`).set(outsider.headers).expect(404);
      await http().get(`/api/conversations/${conversationId}/messages`).set(outsider.headers).expect(404);
    });

    it('деактивований користувач не проходить так само, як до цієї зміни: вхід заборонений, новий доступ не видається', async () => {
      // Гілка `tenant` лише розширює, ХТО з автентифікованих бачить розмову; хто автентифікований —
      // як і раніше вирішує вхід (`isActive` перевіряється при логіні й refresh, access JWT живе до 15 хв)
      const email = `inbox-gone-${String(Date.now())}@example.com`;
      const user = await prisma.user.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          email,
          name: 'gone',
          role: 'USER',
          isActive: false,
          passwordHash: await argon2.hash('SecurePass123'),
        },
      });
      userIds.push(user.id);
      await http().post('/api/auth/login').send({ email, password: 'SecurePass123' }).expect(401);
    });

    it('відповідь поза вікном — 422 CHANNEL_WINDOW_CLOSED і нічого не записано; позначити прочитаним — без помилки й без зайвого', async () => {
      const reader = await login('inbox-poster');
      const { conversationId } = await customerConversation({ name: 'Клієнт', at: new Date() });

      await http()
        .post(`/api/conversations/${conversationId}/messages`)
        .set(reader.headers)
        .send({ body: 'hi', clientMessageId: randomUUID() })
        .expect(422)
        .expect((res) => {
          expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
        });
      expect(await prisma.chatMessage.count({ where: { conversationId } })).toBe(2);

      await http()
        .post(`/api/conversations/${conversationId}/read`)
        .set(reader.headers)
        .send({ seq: 2 })
        .expect((res) => {
          expect(res.status).toBeLessThan(300);
        });
      expect(await prisma.conversationParticipant.count({ where: { conversationId } })).toBe(0);
    });
  });

  describe('скринька', () => {
    it('фільтри mine / unassigned / all', async () => {
      const me = await login('inbox-me');
      const colleague = await login('inbox-colleague');
      const now = Date.now();
      const mine = await customerConversation({ name: 'Моя', at: new Date(now - 3000), assigneeId: me.id });
      const theirs = await customerConversation({ name: 'Чужа', at: new Date(now - 2000), assigneeId: colleague.id });
      const free = await customerConversation({ name: 'Вільна', at: new Date(now - 1000) });

      const ids = async (filter: string): Promise<string[]> => {
        const res = await http().get('/api/chat/inbox').query({ filter }).set(me.headers).expect(200);
        return (res.body as InboxBody).items.map((i) => i.id);
      };
      expect(await ids('mine')).toEqual([mine.conversationId]);
      expect(await ids('unassigned')).toEqual([free.conversationId]);
      expect(await ids('all')).toEqual([free.conversationId, theirs.conversationId, mine.conversationId]);
    });

    it('новіше повідомлення піднімає розмову нагору, а превʼю й канал видно у рядку', async () => {
      const me = await login('inbox-order');
      const older = await customerConversation({ name: 'Давня', at: new Date(Date.now() - 5000) });
      const newer = await customerConversation({ name: 'Нова', at: new Date(Date.now() - 4000) });
      let res = await http().get('/api/chat/inbox').set(me.headers).expect(200);
      expect((res.body as InboxBody).items.map((i) => i.id)).toEqual([newer.conversationId, older.conversationId]);

      await prisma.conversation.update({
        where: { id: older.conversationId },
        data: { lastMessageAt: new Date(), lastMessagePreview: 'свіже' },
      });
      res = await http().get('/api/chat/inbox').set(me.headers).expect(200);
      const items = (res.body as InboxBody).items;
      expect(items[0]).toMatchObject({
        id: older.conversationId,
        lastMessagePreview: 'свіже',
        channel: { displayPhoneNumber: '+1 555 000 0002' },
        // Номер співрозмовника — E.164 з плюсом (з адреси без нормалізованого значення: цифри + плюс)
        contact: { displayName: 'Давня', phone: expect.stringMatching(/^\+38050\d{7}$/) as string },
      });
    });

    it('awaitingReply: остання репліка клієнтська → true; після відповіді агента → false; розв\'язана → false', async () => {
      const me = await login('inbox-await');
      const waiting = await customerConversation({ name: 'Чекає', at: new Date(Date.now() - 3000) });
      const answered = await customerConversation({ name: 'Відповіли', at: new Date(Date.now() - 2000), lastInbound: false });
      const resolved = await customerConversation({ name: 'Закрита', at: new Date(Date.now() - 1000), status: 'RESOLVED' });

      const res = await http().get('/api/chat/inbox').set(me.headers).expect(200);
      const byId = new Map((res.body as InboxBody).items.map((i) => [i.id, i.awaitingReply]));
      expect(byId.get(waiting.conversationId)).toBe(true);
      expect(byId.get(answered.conversationId)).toBe(false);
      expect(byId.get(resolved.conversationId)).toBe(false);
    });

    it('курсорні сторінки: без повторів і пропусків, курсор порожній наприкінці', async () => {
      const me = await login('inbox-page');
      const made: string[] = [];
      for (let i = 0; i < 5; i++) {
        made.push((await customerConversation({ name: `P${String(i)}`, at: new Date(Date.now() - (10 - i) * 1000) })).conversationId);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await http()
          .get('/api/chat/inbox')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(me.headers)
          .expect(200);
        const body = res.body as InboxBody;
        seen.push(...body.items.map((i) => i.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toEqual([...made].reverse());
    });

    it('інший тенант не бачить ні розмов, ні каналів', async () => {
      await customerConversation({ name: 'Клієнт', at: new Date() });
      const outsider = await loginTenantB();
      const inbox = await http().get('/api/chat/inbox').set(outsider.headers).expect(200);
      expect((inbox.body as InboxBody).items).toEqual([]);
      const channels = await http().get('/api/chat/channels').set(outsider.headers).expect(200);
      expect((channels.body as { items: unknown[] }).items).toEqual([]);
    });
  });

  describe('привʼязка контакта до клієнта', () => {
    it('привʼязати, створити з розмови, 409 при повторі, відвʼязати й привʼязати знову', async () => {
      const agent = await login('inbox-link');
      const { contactId } = await customerConversation({ name: 'Люди', at: new Date() });
      const existing = await customer('Існуючий клієнт');

      const linked = await http()
        .post(`/api/chat/contacts/${contactId}/link-customer`)
        .set(agent.headers)
        .send({ customerId: existing })
        .expect(200);
      expect((linked.body as { customer: { id: string } }).customer.id).toBe(existing);

      await http()
        .post(`/api/chat/contacts/${contactId}/link-customer`)
        .set(agent.headers)
        .send({ customerId: existing })
        .expect(409);
      await http().post(`/api/chat/contacts/${contactId}/create-customer`).set(agent.headers).expect(409);

      const unlinked = await http().delete(`/api/chat/contacts/${contactId}/customer`).set(agent.headers).expect(200);
      expect((unlinked.body as { customer: unknown }).customer).toBeNull();

      const again = await http()
        .post(`/api/chat/contacts/${contactId}/link-customer`)
        .set(agent.headers)
        .send({ customerId: existing })
        .expect(200);
      expect((again.body as { customer: { id: string } }).customer.id).toBe(existing);
    });

    it('створення клієнта з контакта: імʼя й телефон з розмови, контакт привʼязаний', async () => {
      const agent = await login('inbox-create');
      const { contactId } = await customerConversation({ name: 'Нова Клієнтка', at: new Date() });
      await prisma.channelContactAddress.updateMany({
        where: { contactId },
        data: { value: '380677001122', normalized: '+380677001122' },
      });
      const before = await prisma.customer.count({ where: { tenantId: DEFAULT_TENANT_ID } });

      const res = await http().post(`/api/chat/contacts/${contactId}/create-customer`).set(agent.headers).expect(201);
      const customerId = (res.body as { customer: { id: string; name: string } }).customer.id;
      customerIds.push(customerId);
      expect((res.body as { customer: { name: string } }).customer.name).toBe('Нова Клієнтка');

      const created = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(created.phone).toBe('+380677001122');
      expect(await prisma.customer.count({ where: { tenantId: DEFAULT_TENANT_ID } })).toBe(before + 1);
    });

    it('клієнт іншого тенанта чи неіснуючий — 404, контакт не змінюється', async () => {
      const agent = await login('inbox-foreign');
      const { contactId } = await customerConversation({ name: 'Люди', at: new Date() });
      const foreign = await customer('Чужий', TENANT_B_ID);

      await http()
        .post(`/api/chat/contacts/${contactId}/link-customer`)
        .set(agent.headers)
        .send({ customerId: foreign })
        .expect(404);
      await http()
        .post(`/api/chat/contacts/${contactId}/link-customer`)
        .set(agent.headers)
        .send({ customerId: randomUUID() })
        .expect(404);
      expect((await prisma.channelContact.findUniqueOrThrow({ where: { id: contactId } })).customerId).toBeNull();
    });

    it('гонка двох привʼязок: рівно одна виграє, інша 409', async () => {
      const agent = await login('inbox-race');
      const { contactId } = await customerConversation({ name: 'Люди', at: new Date() });
      const a = await customer('A');
      const b = await customer('B');
      const results = await Promise.all([
        http().post(`/api/chat/contacts/${contactId}/link-customer`).set(agent.headers).send({ customerId: a }),
        http().post(`/api/chat/contacts/${contactId}/link-customer`).set(agent.headers).send({ customerId: b }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('контакт іншого тенанта недоступний', async () => {
      const outsider = await loginTenantB();
      const { contactId } = await customerConversation({ name: 'Люди', at: new Date() });
      await http().get(`/api/chat/contacts/${contactId}`).set(outsider.headers).expect(404);
    });
  });

  describe('акаунт каналів для адміна', () => {
    it('адмін бачить акаунт; облікові дані — лише «задано», у клартексті їх у відповіді немає', async () => {
      const admin = await login('inbox-acc-admin', 'ADMIN');
      const res = await http().get('/api/settings/messaging').set(admin.headers).expect(200);
      const body = res.body as { items: { provider: string; credentialsSet: boolean; appSecretSet: boolean; webhook: { signingSecretSet: boolean } }[] };
      const account = body.items.find((a) => a.provider === 'fake');
      expect(account).toMatchObject({ credentialsSet: true, appSecretSet: true });
      expect(account?.webhook.signingSecretSet).toBe(true);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(SECRET_VALUE);
      expect(raw).not.toContain('access-token-value');
      expect(raw).not.toContain('v1:');
    });

    it('не-адмін не отримує ні адреси, ні verify token', async () => {
      const user = await login('inbox-acc-user');
      await http().get('/api/settings/messaging').set(user.headers).expect(403);
    });

    it('без публічної бази адреса «недоступна», з базою — збирається з ключа; verify token віддається', async () => {
      const admin = await login('inbox-acc-addr', 'ADMIN');
      let res = await http().get('/api/settings/messaging').set(admin.headers).expect(200);
      let account = (res.body as { items: { provider: string; webhook: { address: string | null; verifyToken: string | null } }[] }).items.find((a) => a.provider === 'fake');
      expect(account?.webhook.address).toBeNull();
      expect(account?.webhook.verifyToken).toBe('verify-xyz');

      process.env.CHANNEL_WEBHOOK_BASE_URL = 'https://hooks.example.test/';
      res = await http().get('/api/settings/messaging').set(admin.headers).expect(200);
      account = (res.body as { items: { provider: string; webhook: { address: string | null; verifyToken: string | null } }[] }).items.find((a) => a.provider === 'fake');
      const key = (await prisma.messagingAccount.findUniqueOrThrow({ where: { id: accountId } })).webhookKey;
      expect(account?.webhook.address).toBe(`https://hooks.example.test/api/public/channels/fake/${key}`);
    });

    it('лічильники й час останнього вебхука: нічого не приходило → нулі й порожньо; потім — за станами', async () => {
      const admin = await login('inbox-acc-counts', 'ADMIN');
      type Block = { last24h: Record<string, number>; lastDeliveryAt: string | null };
      const block = async (): Promise<Block> => {
        const res = await http().get('/api/settings/messaging').set(admin.headers).expect(200);
        return (res.body as { items: { provider: string; webhook: Block }[] }).items.find((a) => a.provider === 'fake')!.webhook;
      };
      expect(await block()).toEqual({
        address: null, verifyToken: 'verify-xyz', signingSecretSet: true, lastDeliveryAt: null,
        last24h: { received: 0, processed: 0, failed: 0, unroutable: 0 },
      });

      const make = (state: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'UNROUTABLE', ageHours = 0) =>
        prisma.channelWebhookEvent.create({
          data: {
            tenantId: DEFAULT_TENANT_ID, accountId, body: '{}', payloadHash: randomUUID(), state,
            receivedAt: new Date(Date.now() - ageHours * 3_600_000),
          },
        });
      await make('PROCESSED');
      await make('PROCESSED');
      await make('FAILED');
      await make('UNROUTABLE');
      await make('RECEIVED');
      await make('PROCESSED', 30); // старіше доби — у лічильники не входить

      const after = await block();
      expect(after.last24h).toEqual({ received: 1, processed: 2, failed: 1, unroutable: 1 });
      expect(after.lastDeliveryAt).not.toBeNull();
    });

    it('канали бачить будь-який користувач, без облікових даних', async () => {
      const user = await login('inbox-chan');
      const res = await http().get('/api/chat/channels').set(user.headers).expect(200);
      const items = (res.body as { items: Record<string, unknown>[] }).items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(items)).not.toMatch(/credentials|appSecret|webhookKey/);
    });
  });
});
