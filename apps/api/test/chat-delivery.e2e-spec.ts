/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import {
  ActivityRecorder,
  ChannelAdapterRegistry,
  ChannelDeliveryService,
  ChannelIngestService,
  ChannelPendingSweeper,
  ChannelStatusService,
  ChatNotifier,
  ConversationWorkflow,
  CryptoService,
  FakeChannelAdapter,
  NonRetryableMessageError,
  NotificationRecorder,
  RetryableDeliveryError,
  buildFakeWebhookBody,
  type IngestOutcome,
} from '@saas-skeleton/shared';
import type { NormalizedEvent } from '@saas-skeleton/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-2b: доставка (ChannelDeliveryService), згортання квитанцій (ingest + sweeper) і вхідне в
// розмову з відповідальним — проти справжньої БД. Воркер у e2e не крутиться: ці класи викликаються
// в `withTenantTx` так, як це робить підписник.

const TENANT_B_ID = '00000000-0000-4000-8000-000000000047';
const CHANNEL_EXT = 'delivery-phone-1';

/** Адаптер-обгортка: рахує виклики `send`, щоб довести «не надсилали вдруге» */
class CountingFakeAdapter extends FakeChannelAdapter {
  sends = 0;
  override async send(...args: Parameters<FakeChannelAdapter['send']>): ReturnType<FakeChannelAdapter['send']> {
    this.sends += 1;
    return super.send(...args);
  }
}

describe('Delivery, receipts and inbound workflow (e2e, CHAT-2b)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let adapter: CountingFakeAdapter;
  let delivery: ChannelDeliveryService;
  let ingest: ChannelIngestService;
  let sweeper: ChannelPendingSweeper;
  let notifier: ChatNotifier;
  let accountId: string;
  let channelId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    transactions = app.get(TenantTransactions);
    adapter = new CountingFakeAdapter();
    const registry = new ChannelAdapterRegistry().register(adapter);
    const statuses = new ChannelStatusService();
    const workflow = new ConversationWorkflow(new ActivityRecorder());
    delivery = new ChannelDeliveryService(registry, transactions, app.get(CryptoService), statuses);
    ingest = new ChannelIngestService(registry, statuses, workflow);
    sweeper = new ChannelPendingSweeper(prisma, tenantContext, transactions, statuses);
    notifier = new ChatNotifier(app.get(NotificationRecorder));
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'chat-delivery-b', name: 'Delivery tenant B' },
    });
  });

  beforeEach(async () => {
    adapter.sends = 0;
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'fake',
          name: 'delivery e2e',
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
          provider: 'fake',
          externalId: CHANNEL_EXT,
          displayPhoneNumber: '+1 555 000 0004',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.channelPendingStatus.deleteMany({ where: { accountId } });
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.deleteMany({ where: { tenantId: { in: [DEFAULT_TENANT_ID, TENANT_B_ID] }, name: { in: ['delivery e2e', 'delivery e2e B'] } } });
    await prisma.notification.deleteMany({ where: { type: { startsWith: 'chat.' } } });
    await prisma.activity.deleteMany({ where: { type: { startsWith: 'conversation.' } } });
    if (userIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  // ------------------------------------------------------------------ сцена

  async function scene(opts: {
    customerAt?: Date | null;
    status?: 'OPEN' | 'PENDING' | 'RESOLVED';
    assigneeId?: string;
  } = {}): Promise<{ conversationId: string; contactId: string }> {
    const customerAt = opts.customerAt === undefined ? new Date() : opts.customerAt;
    const contact = await prisma.channelContact.create({
      data: { tenantId: DEFAULT_TENANT_ID, channelId, displayName: 'Клієнт' },
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
        customerLastMessageAt: customerAt,
        lastSeq: 1,
        lastMessageAt: new Date(),
      },
    });
    await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        seq: 1,
        kind: 'TEXT',
        senderType: 'customer',
        body: 'hello',
        direction: 'INBOUND',
        channelId,
        externalId: randomUUID(),
      },
    });
    if (opts.assigneeId) {
      await prisma.conversationParticipant.create({
        data: { tenantId: DEFAULT_TENANT_ID, conversationId: conversation.id, userId: opts.assigneeId },
      });
    }
    return { conversationId: conversation.id, contactId: contact.id };
  }

  async function outbound(
    conversationId: string,
    body: string,
    overrides: Partial<{ status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ'; externalId: string; sendingStartedAt: Date; attempts: number }> = {},
  ): Promise<string> {
    const last = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const created = await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId,
        seq: last.lastSeq + 1,
        kind: 'TEXT',
        visibility: 'PUBLIC',
        status: overrides.status ?? 'QUEUED',
        senderType: 'user',
        senderLabel: 'agent',
        body,
        direction: 'OUTBOUND',
        channelId,
        ...(overrides.externalId && { externalId: overrides.externalId }),
        ...(overrides.sendingStartedAt && { sendingStartedAt: overrides.sendingStartedAt }),
        ...(overrides.attempts !== undefined && { attempts: overrides.attempts }),
      },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastSeq: last.lastSeq + 1 } });
    return created.id;
  }

  const row = (id: string) => prisma.chatMessage.findUniqueOrThrow({ where: { id } });
  const deliver = (id: string) =>
    tenantContext.runWith(DEFAULT_TENANT_ID, () => delivery.deliver(id));

  // ------------------------------------------------------------- доставка

  describe('доставка (5.1)', () => {
    it('успіх: SENT, id провайдера, одна спроба, час відправки', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, 'hi');

      const result = await deliver(id);

      const m = await row(id);
      expect(m).toMatchObject({ status: 'SENT', externalId: `fake-out-${id}`, attempts: 1 });
      expect(m.sentAt).not.toBeNull();
      expect(result.updated).toEqual([{ messageId: id, conversationId }]);
      expect(adapter.sends).toBe(1);
    });

    it.each([
      ['permanent', 'PERMANENT'],
      ['policy', 'POLICY'],
      ['human', 'HUMAN'],
      ['window', 'WINDOW_CLOSED'],
    ] as const)('клас %s → FAILED(%s) без повтору, робота завершується нормально', async (marker, errorClass) => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, `[[fake:${marker}]] text`);

      await expect(deliver(id)).resolves.toMatchObject({ updated: [{ messageId: id }] });

      const m = await row(id);
      expect(m.status).toBe('FAILED');
      expect((m.failure as { class: string }).class).toBe(errorClass);
      expect(m.attempts).toBe(1);
    });

    it('AUTH → FAILED(AUTH) і акаунт NEEDS_REAUTH', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, '[[fake:auth]] x');

      await deliver(id);

      expect((await row(id)).status).toBe('FAILED');
      expect((await prisma.messagingAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe('NEEDS_REAUTH');
    });

    it('тимчасова відмова: рядок повертається в QUEUED, виняток для повтору, друга спроба вдала (2 спроби)', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, '[[fake:transient-once]] x');

      await expect(deliver(id)).rejects.toBeInstanceOf(RetryableDeliveryError);
      const afterFirst = await row(id);
      expect(afterFirst).toMatchObject({ status: 'QUEUED', attempts: 1 });

      await deliver(id);
      expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 2 });
    });

    it('rate limit повторюється; постійна тимчасова відмова стає FAILED на 5-й спробі', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, '[[fake:transient]] x');

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expect(deliver(id)).rejects.toBeInstanceOf(RetryableDeliveryError);
        expect(await row(id)).toMatchObject({ status: 'QUEUED', attempts: attempt });
      }
      await expect(deliver(id)).resolves.toMatchObject({ updated: [{ messageId: id }] });
      const m = await row(id);
      expect(m).toMatchObject({ status: 'FAILED', attempts: 5 });
      expect((m.failure as { class: string }).class).toBe('TRANSIENT');

      const limited = await outbound(conversationId, '[[fake:ratelimit]] x');
      await expect(deliver(limited)).rejects.toBeInstanceOf(RetryableDeliveryError);
      expect((await row(limited)).status).toBe('QUEUED');
    });

    it('вікно закрилось, поки робота чекала: не надсилається, FAILED(WINDOW_CLOSED)', async () => {
      const { conversationId } = await scene({ customerAt: new Date(Date.now() - 26 * 3_600_000) });
      const id = await outbound(conversationId, 'запізно');

      await deliver(id);

      expect(adapter.sends).toBe(0);
      const m = await row(id);
      expect(m.status).toBe('FAILED');
      expect((m.failure as { class: string }).class).toBe('WINDOW_CLOSED');
    });

    it('повідомлення вже не в QUEUED — не надсилається вдруге', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, 'вже', { status: 'SENT', externalId: 'prov-1' });

      await expect(deliver(id)).resolves.toEqual({ updated: [] });
      expect(adapter.sends).toBe(0);
    });

    it('SENDING без id (обірвана спроба): свіжа — чекаємо без виклику провайдера, стара — FAILED як непідтверджена', async () => {
      const { conversationId } = await scene();
      const fresh = await outbound(conversationId, 'свіжа', { status: 'SENDING', sendingStartedAt: new Date() });
      await expect(deliver(fresh)).rejects.toBeInstanceOf(RetryableDeliveryError);
      expect((await row(fresh)).status).toBe('SENDING');

      const stale = await outbound(conversationId, 'стара', {
        status: 'SENDING',
        sendingStartedAt: new Date(Date.now() - 2 * 60_000),
      });
      await expect(deliver(stale)).resolves.toMatchObject({ updated: [{ messageId: stale }] });
      const m = await row(stale);
      expect(m.status).toBe('FAILED');
      expect(m.failure).toMatchObject({ code: 'outcome_unknown', unconfirmed: true });
      expect(adapter.sends).toBe(0);
    });

    it('відсутнє повідомлення — NonRetryableMessageError', async () => {
      await expect(deliver(randomUUID())).rejects.toBeInstanceOf(NonRetryableMessageError);
    });

    it('квитанція за нашим id, що випередила запис external_id, застосовується одразу після SENT', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, 'гонка');
      await prisma.channelPendingStatus.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId,
          channelExternalId: CHANNEL_EXT,
          externalId: null,
          opaqueId: id,
          status: 'delivered',
          occurredAt: new Date(),
        },
      });

      await deliver(id);

      expect((await row(id)).status).toBe('DELIVERED');
      expect(await prisma.channelPendingStatus.count({ where: { accountId } })).toBe(0);
    });
  });

  // ------------------------------------------------------------ квитанції

  describe('згортання квитанцій (7.1)', () => {
    function receipt(
      externalMessageId: string,
      status: 'sent' | 'delivered' | 'read' | 'failed',
      overrides: Partial<Extract<NormalizedEvent, { kind: 'status' }>> = {},
    ): NormalizedEvent {
      return {
        kind: 'status',
        channelExternalId: CHANNEL_EXT,
        externalMessageId,
        opaqueId: null,
        status,
        occurredAt: new Date().toISOString(),
        failure: status === 'failed' ? { class: 'PERMANENT', code: '131026', title: 'nope' } : null,
        providerMeta: {},
        ...overrides,
      };
    }

    async function run(...events: NormalizedEvent[]): Promise<IngestOutcome> {
      const stored = await prisma.channelWebhookEvent.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, body: buildFakeWebhookBody(events), payloadHash: randomUUID() },
      });
      return tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        transactions.withTenantTx((tx) => ingest.ingestEvent(tx, stored.id)),
      );
    }

    async function sent(conversationId: string, externalId = `prov-${randomUUID()}`): Promise<{ id: string; ext: string }> {
      const id = await outbound(conversationId, 'out', { status: 'SENT', externalId });
      return { id, ext: externalId };
    }

    it('delivered, потім read — READ з обома часами; повтор нічого не змінює і не повертає', async () => {
      const { conversationId } = await scene();
      const { id, ext } = await sent(conversationId);

      const first = await run(receipt(ext, 'delivered'), receipt(ext, 'read'));
      expect(first.updatedMessages.map((m) => m.messageId)).toEqual([id, id]);
      const m = await row(id);
      expect(m.status).toBe('READ');
      expect(m.deliveredAt).not.toBeNull();
      expect(m.readAt).not.toBeNull();

      const again = await run(receipt(ext, 'read'));
      expect(again.updatedMessages).toEqual([]);
    });

    it('запізніле delivered після read: лишається READ', async () => {
      const { conversationId } = await scene();
      const { id, ext } = await sent(conversationId);
      await run(receipt(ext, 'read'));
      const outcome = await run(receipt(ext, 'delivered'));
      expect(outcome.updatedMessages).toEqual([]);
      const m = await row(id);
      expect(m.status).toBe('READ');
      expect(m.deliveredAt).not.toBeNull(); // read заповнив пропущений крок
    });

    it('failed не перекриває доставку; delivered після failed перекриває й очищає причину; sent не скасовує failed', async () => {
      const { conversationId } = await scene();
      const a = await sent(conversationId);
      await run(receipt(a.ext, 'delivered'));
      await run(receipt(a.ext, 'failed'));
      expect((await row(a.id)).status).toBe('DELIVERED');

      const b = await sent(conversationId);
      await run(receipt(b.ext, 'failed'));
      expect(await row(b.id)).toMatchObject({ status: 'FAILED' });
      await run(receipt(b.ext, 'sent'));
      expect((await row(b.id)).status).toBe('FAILED');
      await run(receipt(b.ext, 'delivered'));
      const healed = await row(b.id);
      expect(healed.status).toBe('DELIVERED');
      expect(healed.failure).toBeNull();
    });

    it('квитанція за нашим id (opaque) знаходить повідомлення й виставляє external_id', async () => {
      const { conversationId } = await scene();
      const id = await outbound(conversationId, 'out', { status: 'SENDING' });

      await run(receipt('prov-new', 'sent', { opaqueId: id }));

      expect(await row(id)).toMatchObject({ status: 'SENT', externalId: 'prov-new' });
    });

    it('чуже: повідомлення іншого каналу з тим самим id провайдера не зачіпається', async () => {
      const { conversationId } = await scene();
      const mine = await sent(conversationId, 'shared-ext');
      const otherChannel = await prisma.channel.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, type: 'WHATSAPP', provider: 'fake', externalId: 'other-phone', isEnabled: true },
      });
      const otherContact = await prisma.channelContact.create({ data: { tenantId: DEFAULT_TENANT_ID, channelId: otherChannel.id } });
      const otherConv = await prisma.conversation.create({
        data: { tenantId: DEFAULT_TENANT_ID, kind: 'CUSTOMER', access: 'tenant', channelId: otherChannel.id, contactId: otherContact.id, lastSeq: 1 },
      });
      const foreign = await prisma.chatMessage.create({
        data: { tenantId: DEFAULT_TENANT_ID, conversationId: otherConv.id, seq: 1, kind: 'TEXT', status: 'SENT', senderType: 'user', body: 'x', direction: 'OUTBOUND', channelId: otherChannel.id, externalId: 'shared-ext' },
      });

      await run(receipt('shared-ext', 'delivered')); // канал CHANNEL_EXT

      expect((await row(mine.id)).status).toBe('DELIVERED');
      expect((await row(foreign.id)).status).toBe('SENT');
      await prisma.conversation.delete({ where: { id: otherConv.id } });
      await prisma.channel.delete({ where: { id: otherChannel.id } });
    });

    it('delivered і read одночасно (дві транзакції) → READ', async () => {
      const { conversationId } = await scene();
      const { id, ext } = await sent(conversationId);

      await Promise.all([run(receipt(ext, 'delivered')), run(receipt(ext, 'read'))]);

      expect((await row(id)).status).toBe('READ');
    });

    it('невідоме повідомлення паркується; відоме, але «попереду» — ні', async () => {
      const { conversationId } = await scene();
      const known = await sent(conversationId);
      await run(receipt(known.ext, 'read'));
      await run(receipt(known.ext, 'delivered')); // не змінює, але повідомлення є

      expect(await prisma.channelPendingStatus.count({ where: { accountId } })).toBe(0);

      await run(receipt('prov-nobody', 'delivered'));
      expect(await prisma.channelPendingStatus.count({ where: { accountId, externalId: 'prov-nobody' } })).toBe(1);
    });
  });

  describe('підмітання запаркованого (7.2)', () => {
    it('застосовує, коли повідомлення з’явилося; відкидає після 5 безуспішних проходів', async () => {
      const { conversationId } = await scene();
      await prisma.channelPendingStatus.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, channelExternalId: CHANNEL_EXT, externalId: 'late-ext', status: 'delivered', occurredAt: new Date() },
      });
      await prisma.channelPendingStatus.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, channelExternalId: CHANNEL_EXT, externalId: 'never-ext', status: 'delivered', occurredAt: new Date() },
      });

      const first = await sweeper.sweep();
      expect(first).toMatchObject({ applied: 0, discarded: 0 });

      const id = await outbound(conversationId, 'зʼявилось', { status: 'SENT', externalId: 'late-ext' });
      const second = await sweeper.sweep();
      expect(second.applied).toBe(1);
      expect(second.updated).toEqual([{ tenantId: DEFAULT_TENANT_ID, message: { messageId: id, conversationId } }]);
      expect((await row(id)).status).toBe('DELIVERED');

      // решта проходів до межі: never-ext відкидається на 5-му (1 + 3 ще + останній)
      let discarded = 0;
      for (let i = 0; i < 4; i += 1) discarded += (await sweeper.sweep()).discarded;
      expect(discarded).toBe(1);
      expect(await prisma.channelPendingStatus.count({ where: { accountId } })).toBe(0);
    });
  });

  // -------------------------------------------- вхідне в розмову з відповідальним

  describe('вхідне (7.3)', () => {
    async function login(prefix: string): Promise<string> {
      const { user } = await createAndLoginTestUser(app, prisma, {
        email: `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
        password: 'SecurePass123',
        name: prefix,
        role: 'USER',
      });
      userIds.push(user.id);
      return user.id;
    }

    function inbound(id: string, from: string): NormalizedEvent {
      return {
        kind: 'message',
        externalMessageId: id,
        channelExternalId: CHANNEL_EXT,
        from: { kind: 'phone', value: from },
        profileName: 'Клієнт',
        sentAt: new Date().toISOString(),
        content: { type: 'text', body: `text ${id}` },
        providerMeta: {},
      };
    }

    async function run(...events: NormalizedEvent[]): Promise<IngestOutcome> {
      const stored = await prisma.channelWebhookEvent.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, body: buildFakeWebhookBody(events), payloadHash: randomUUID() },
      });
      return tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        transactions.withTenantTx((tx) => ingest.ingestEvent(tx, stored.id)),
      );
    }

    it('лічильник непрочитаного росте лише відповідальному; дублікат нічого не змінює й не віддається для сповіщень', async () => {
      const assignee = await login('in-assignee');
      const phone = `38067${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
      const first = await run(inbound('i-1', phone));
      const conversationId = first.storedMessages[0]?.conversationId as string;
      await prisma.conversation.update({ where: { id: conversationId }, data: { assigneeId: assignee } });
      await prisma.conversationParticipant.create({ data: { tenantId: DEFAULT_TENANT_ID, conversationId, userId: assignee } });

      const second = await run(inbound('i-2', phone));
      expect(second.storedMessages).toHaveLength(1);
      expect((await prisma.conversationParticipant.findFirstOrThrow({ where: { conversationId } })).unreadCount).toBe(1);

      const dup = await run(inbound('i-2', phone));
      expect(dup.storedMessages).toEqual([]);
      expect((await prisma.conversationParticipant.findFirstOrThrow({ where: { conversationId } })).unreadCount).toBe(1);
    });

    it('PENDING → OPEN одним записом від клієнта; розв’язана в межах вікна — повертається із записом', async () => {
      const phone = `38067${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
      const first = await run(inbound('p-1', phone));
      const conversationId = first.storedMessages[0]?.conversationId as string;

      await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PENDING' } });
      await run(inbound('p-2', phone));
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe('OPEN');
      const pendingEntries = await prisma.chatMessage.findMany({ where: { conversationId, kind: 'SYSTEM' } });
      expect(pendingEntries).toHaveLength(1);
      expect(pendingEntries[0]).toMatchObject({ senderType: 'customer' });
      expect(pendingEntries[0]?.payload).toMatchObject({ type: 'conversation.status_changed', from: 'PENDING', to: 'OPEN' });

      await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
      await run(inbound('p-3', phone));
      const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(reopened.status).toBe('OPEN');
      const entries = await prisma.chatMessage.findMany({ where: { conversationId, kind: 'SYSTEM' }, orderBy: { seq: 'asc' } });
      expect(entries.map((e) => (e.payload as { to?: string }).to)).toEqual(['OPEN', 'OPEN']);
    });
  });

  describe('сповіщення призначеному (7.4)', () => {
    async function login(prefix: string): Promise<string> {
      const { user } = await createAndLoginTestUser(app, prisma, {
        email: `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
        password: 'SecurePass123',
        name: prefix,
        role: 'USER',
      });
      userIds.push(user.id);
      return user.id;
    }

    async function inboundMessage(conversationId: string, body: string): Promise<string> {
      const last = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      const created = await prisma.chatMessage.create({
        data: { tenantId: DEFAULT_TENANT_ID, conversationId, seq: last.lastSeq + 1, kind: 'TEXT', status: 'SENT', senderType: 'customer', body, direction: 'INBOUND', channelId, externalId: randomUUID() },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { lastSeq: last.lastSeq + 1 } });
      return created.id;
    }

    const notify = (conversationId: string, messageId: string, viewerIds: string[] = []) =>
      tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        transactions.withTenantTx((tx) => notifier.notifyCustomerMessage(tx, { conversationId, messageId, viewerIds })),
      );
    const rows = (userId: string) =>
      prisma.notification.findMany({ where: { recipientId: userId, type: 'chat.customer_message_received' } });

    it('відповідальний отримує, нічия розмова нікого не сповіщає, глядач придушується', async () => {
      const assignee = await login('ntf-assignee');
      const bystander = await login('ntf-bystander');
      const owned = await scene({ assigneeId: assignee });
      const free = await scene();

      await notify(owned.conversationId, await inboundMessage(owned.conversationId, 'привіт'));
      await notify(free.conversationId, await inboundMessage(free.conversationId, 'нічия'));
      expect(await rows(assignee)).toHaveLength(1);
      expect(await rows(bystander)).toHaveLength(0);
      expect((await rows(assignee))[0]?.payload).toMatchObject({ conversation: { label: 'Клієнт' }, preview: 'привіт' });

      await prisma.notification.deleteMany({ where: { recipientId: assignee } });
      await notify(owned.conversationId, await inboundMessage(owned.conversationId, 'дивлюсь'), [assignee]);
      expect(await rows(assignee)).toHaveLength(0);
    });

    it('на повідомлення, після якого команда вже відповіла, сповіщення немає', async () => {
      const assignee = await login('ntf-answered');
      const { conversationId } = await scene({ assigneeId: assignee });
      const messageId = await inboundMessage(conversationId, 'питання');
      await outbound(conversationId, 'відповідь команди', { status: 'SENT', externalId: 'prov-answer' });

      await notify(conversationId, messageId);

      expect(await rows(assignee)).toHaveLength(0);
    });

    it('кілька повідомлень зливаються; прочитання розмови гасить сповіщення', async () => {
      const assignee = await login('ntf-collapse');
      const { conversationId } = await scene({ assigneeId: assignee });
      for (const text of ['a', 'b', 'c']) {
        await notify(conversationId, await inboundMessage(conversationId, text));
      }
      const list = await rows(assignee);
      expect(list).toHaveLength(1);
      expect(list[0]?.groupCount).toBe(3);

      await prisma.conversationParticipant.updateMany({ where: { conversationId, userId: assignee }, data: { unreadCount: 3 } });
      const token = (
        await request(app.getHttpServer() as Parameters<typeof request>[0])
          .post('/api/auth/login')
          .send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: assignee } })).email, password: 'SecurePass123' })
          .expect(200)
      ).body as { tokens: { accessToken: string } };
      const last = (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).lastSeq;
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/conversations/${conversationId}/read`)
        .set({ Authorization: `Bearer ${token.tokens.accessToken}` })
        .send({ seq: last })
        .expect(204);

      expect((await rows(assignee))[0]?.readAt).not.toBeNull();
    });
  });
});
