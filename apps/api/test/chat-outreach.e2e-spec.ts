/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3a, chat/outreach: агент починає розмову з номера. Контакт, адреса, автопривʼязка й «одна відкрита
// розмова на контакт» — проти справжньої БД.

process.env.CHAT_DEV_TOOLS = 'true';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000049';

interface ConversationBody {
  id: string;
  kind: string;
  status: string;
  canReply: boolean;
  contact: { id: string; displayName: string | null; deliveryReceipts: boolean } | null;
}

describe('Starting a conversation from a number (e2e, CHAT-3a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let headers: { Authorization: string };
  let accountId: string;
  let channelId: string;
  const userIds: string[] = [];
  const customerIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const start = (body: Record<string, unknown>) =>
    http().post('/api/chat/outreach').set(headers).send(body);
  const phone = () => `+38050${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'outreach-b', name: 'Outreach tenant B' },
    });
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `outreach-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'outreach',
      role: 'USER',
    });
    userIds.push(user.id);
    headers = { Authorization: `Bearer ${tokens.accessToken}` };
  });

  beforeEach(async () => {
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'outreach e2e',
          verifyToken: 'v',
          webhookKey: randomBytes(16).toString('hex'),
        },
      })
    ).id;
    channelId = (
      await prisma.channel.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId,
          type: 'WHATSAPP',
          provider: 'meta_cloud',
          externalId: `oc-${randomUUID()}`,
          displayPhoneNumber: '+1 555 000 0009',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.messagingAccount.deleteMany({ where: { id: accountId } });
    await prisma.messagingAccount.deleteMany({ where: { tenantId: TENANT_B_ID } });
    if (customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      customerIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const customer = async (name: string, number: string): Promise<string> => {
    const created = await prisma.customer.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        name,
        phone: number,
        number: Math.floor(Math.random() * 1_000_000_000),
      },
    });
    customerIds.push(created.id);
    return created.id;
  };

  it('новий номер: контакт з адресою цифрами, порожня відкрита розмова, повідомлень і записів у стрічці немає, писати можна', async () => {
    const number = phone();
    const res = await start({
      channelId,
      phone: `${number.slice(0, 3)} ${number.slice(3)}`,
      name: 'Олена',
    }).expect(200);
    const body = res.body as ConversationBody;

    expect(body).toMatchObject({
      kind: 'CUSTOMER',
      status: 'OPEN',
      canReply: true,
      contact: { displayName: 'Олена', deliveryReceipts: false },
    });
    const digits = number.replace(/\D/g, '');
    const address = await prisma.channelContactAddress.findFirstOrThrow({
      where: { channelId, value: digits },
    });
    expect(address.normalized).toBe(number);
    const contact = await prisma.channelContact.findUniqueOrThrow({
      where: { id: address.contactId },
    });
    expect(contact.optInAt).toBeNull(); // згоду дає звернення клієнта, не агент
    expect(await prisma.chatMessage.count({ where: { conversationId: body.id } })).toBe(0);
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: body.id } }))
        .customerLastMessageAt,
    ).toBeNull();
  });

  it('номер з відкритою розмовою повертає її, нічого не створюючи; ім’я наявного контакта не затирається', async () => {
    const number = phone();
    const first = (await start({ channelId, phone: number, name: 'Перше' }).expect(200))
      .body as ConversationBody;
    const again = (await start({ channelId, phone: number, name: 'Друге' }).expect(200))
      .body as ConversationBody;

    expect(again.id).toBe(first.id);
    expect(await prisma.conversation.count({ where: { channelId } })).toBe(1);
    expect(await prisma.channelContact.count({ where: { channelId } })).toBe(1);
    expect(again.contact?.displayName).toBe('Перше');
  });

  it('контакт із розв’язаною розмовою: створюється НОВА розмова для того самого контакта', async () => {
    const number = phone();
    const first = (await start({ channelId, phone: number }).expect(200)).body as ConversationBody;
    await prisma.conversation.update({
      where: { id: first.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    const second = (await start({ channelId, phone: number }).expect(200)).body as ConversationBody;

    expect(second.id).not.toBe(first.id);
    expect(second.contact?.id).toBe(first.contact?.id);
    expect(await prisma.channelContact.count({ where: { channelId } })).toBe(1);
  });

  it('два одночасні запити на той самий номер дають одну розмову', async () => {
    const number = phone();
    const [a, b] = await Promise.all([
      start({ channelId, phone: number }),
      start({ channelId, phone: number }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect((a.body as ConversationBody).id).toBe((b.body as ConversationBody).id);
    expect(await prisma.conversation.count({ where: { channelId } })).toBe(1);
    expect(await prisma.channelContact.count({ where: { channelId } })).toBe(1);
  });

  it('невалідний номер — 400 з полем phone; нічого не створено', async () => {
    const res = await start({ channelId, phone: 'не номер' }).expect(400);
    expect((res.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe('phone');
    await start({ channelId, phone: '12' }).expect(400);
    expect(await prisma.channelContact.count({ where: { channelId } })).toBe(0);
  });

  it('вимкнений чи зниклий у провайдера канал — 409; чужий і неіснуючий — 404', async () => {
    await prisma.channel.update({ where: { id: channelId }, data: { isEnabled: false } });
    await start({ channelId, phone: phone() }).expect(409);
    await prisma.channel.update({
      where: { id: channelId },
      data: { isEnabled: true, providerMissingAt: new Date() },
    });
    await start({ channelId, phone: phone() }).expect(409);

    const foreignAccount = await prisma.messagingAccount.create({
      data: {
        tenantId: TENANT_B_ID,
        provider: 'meta_cloud',
        name: 'B',
        verifyToken: 'v',
        webhookKey: randomBytes(16).toString('hex'),
      },
    });
    const foreign = await prisma.channel.create({
      data: {
        tenantId: TENANT_B_ID,
        accountId: foreignAccount.id,
        type: 'WHATSAPP',
        provider: 'meta_cloud',
        externalId: `oc-b-${randomUUID()}`,
        isEnabled: true,
      },
    });
    await start({ channelId: foreign.id, phone: phone() }).expect(404);
    await start({ channelId: randomUUID(), phone: phone() }).expect(404);
    expect(await prisma.channelContact.count({ where: { channelId: foreign.id } })).toBe(0);
  });

  it('номер рівно одного клієнта — контакт привʼязується; номер двох клієнтів — ні; нового клієнта не створюється', async () => {
    const unique = phone();
    const only = await customer('Єдиний', unique);
    const linked = (await start({ channelId, phone: unique }).expect(200)).body as ConversationBody;
    expect(
      (await prisma.channelContact.findUniqueOrThrow({ where: { id: linked.contact?.id ?? '' } }))
        .customerId,
    ).toBe(only);

    const shared = phone();
    await customer('Перший', shared);
    await customer('Другий', shared);
    const unlinked = (await start({ channelId, phone: shared }).expect(200))
      .body as ConversationBody;
    expect(
      (await prisma.channelContact.findUniqueOrThrow({ where: { id: unlinked.contact?.id ?? '' } }))
        .customerId,
    ).toBeNull();

    const before = await prisma.customer.count();
    await start({ channelId, phone: phone() }).expect(200);
    expect(await prisma.customer.count()).toBe(before);
  });

  it('без авторизації — 401', async () => {
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/chat/outreach')
      .send({ channelId, phone: phone() })
      .expect(401);
  });
});
