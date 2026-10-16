/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SystemPrismaModule, SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import {
  ChannelAdapterRegistry,
  ActivityRecorder,
  ChannelIngestService,
  ChannelStatusService,
  ConversationWorkflow,
  FakeChannelAdapter,
  buildFakeWebhookBody,
  type IngestOutcome,
} from '@saas-skeleton/shared';
import type { NormalizedEvent } from '@saas-skeleton/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DEFAULT_TENANT_ID } from './test-users';

// CHAT-2a, ingest вхідних повідомлень (chat/inbound, chat/customer-inbox) проти справжньої БД.
// ChannelIngestService у API не підключений (він живе у воркері), тож тут збирається вручну —
// з тим самим реєстром і транзакцією, що в `ChannelsIngestSubscriber`.

const CHANNEL_EXT = 'ingest-phone-1';

describe('Channel ingest (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let ingest: ChannelIngestService;
  let accountId: string;
  let channelId: string;
  const customerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    transactions = app.get(TenantTransactions);
    ingest = new ChannelIngestService(
      new ChannelAdapterRegistry().register(new FakeChannelAdapter()),
      new ChannelStatusService(),
      new ConversationWorkflow(new ActivityRecorder()),
    );
  });

  beforeEach(async () => {
    const account = await prisma.messagingAccount.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        provider: 'fake',
        name: 'ingest e2e',
        verifyToken: 'v',
        webhookKey: randomBytes(16).toString('hex'),
      },
    });
    accountId = account.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        accountId,
        type: 'WHATSAPP',
        provider: 'fake',
        externalId: CHANNEL_EXT,
        displayPhoneNumber: '+1 555 000 0001',
        isEnabled: true,
      },
    });
    channelId = channel.id;
  });

  afterEach(async () => {
    // conversations.channel_id — NO ACTION: розмови прибираються першими (повідомлення каскадом)
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.delete({ where: { id: accountId } });
    if (customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      customerIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function inbound(
    id: string,
    overrides: Partial<Extract<NormalizedEvent, { kind: 'message' }>> = {},
  ): NormalizedEvent {
    return {
      kind: 'message',
      externalMessageId: id,
      channelExternalId: CHANNEL_EXT,
      from: { kind: 'phone', value: '380501234567' },
      profileName: 'Олена',
      sentAt: new Date().toISOString(),
      content: { type: 'text', body: `text ${id}` },
      providerMeta: {},
      ...overrides,
    };
  }

  async function storeEvent(body: string): Promise<string> {
    const event = await prisma.channelWebhookEvent.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        accountId,
        body,
        payloadHash: randomUUID(),
      },
    });
    return event.id;
  }

  /** Зберегти подію й прогнати її в транзакції під контекстом тенанта — як воркер */
  async function run(...events: NormalizedEvent[]): Promise<IngestOutcome> {
    const eventId = await storeEvent(buildFakeWebhookBody(events));
    return runStored(eventId);
  }

  function runStored(eventId: string): Promise<IngestOutcome> {
    return tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      transactions.withTenantTx((tx) => ingest.ingestEvent(tx, eventId)),
    );
  }

  const messages = () =>
    prisma.chatMessage.findMany({ where: { channelId }, orderBy: [{ conversationId: 'asc' }, { seq: 'asc' }] });
  const conversations = () => prisma.conversation.findMany({ where: { channelId } });
  const contacts = () => prisma.channelContact.findMany({ where: { channelId }, include: { addresses: true } });

  async function makeCustomer(name: string, phone: string): Promise<string> {
    const number = Math.floor(Math.random() * 1_000_000_000);
    const customer = await prisma.customer.create({
      data: { tenantId: DEFAULT_TENANT_ID, name, phone, number },
    });
    customerIds.push(customer.id);
    return customer.id;
  }

  describe('exactly-once', () => {
    it('те саме повідомлення в двох доставках: одне повідомлення, лічильник порахований один раз', async () => {
      const first = await run(inbound('dup-1'));
      const second = await run(inbound('dup-1'));
      expect(first).toMatchObject({ state: 'PROCESSED', stored: 1 });
      expect(second).toMatchObject({ state: 'PROCESSED', stored: 0, changedConversationIds: [] });

      expect(await messages()).toHaveLength(1);
      const [conversation] = await conversations();
      expect(conversation?.lastSeq).toBe(1);
    });

    it('паралельна обробка одного повідомлення: одне повідомлення й суцільний seq', async () => {
      const [a, b, c] = await Promise.all([
        storeEvent(buildFakeWebhookBody([inbound('race-1')])),
        storeEvent(buildFakeWebhookBody([inbound('race-1')])),
        storeEvent(buildFakeWebhookBody([inbound('race-1')])),
      ]);
      await Promise.all([runStored(a), runStored(b), runStored(c)]);

      const stored = await messages();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.seq).toBe(1);
      expect(await contacts()).toHaveLength(1);
      expect(await conversations()).toHaveLength(1);
    });

    it('перші повідомлення від одного контакта паралельно: одна розмова, обидва в ній, seq 1 і 2', async () => {
      const [a, b] = await Promise.all([
        storeEvent(buildFakeWebhookBody([inbound('first-a')])),
        storeEvent(buildFakeWebhookBody([inbound('first-b')])),
      ]);
      await Promise.all([runStored(a), runStored(b)]);

      expect(await conversations()).toHaveLength(1);
      expect(await contacts()).toHaveLength(1);
      expect((await messages()).map((m) => m.seq)).toEqual([1, 2]);
    });

    it('дублікат не бере seq: наступне нове повідомлення йде без дірки', async () => {
      await run(inbound('seq-1'));
      await run(inbound('seq-1'));
      await run(inbound('seq-2'));
      expect((await messages()).map((m) => [m.externalId, m.seq])).toEqual([
        ['seq-1', 1],
        ['seq-2', 2],
      ]);
    });
  });

  describe('час і порядок', () => {
    it('запізніла доставка: наступний seq, а час клієнтського повідомлення — час провайдера', async () => {
      await run(inbound('now-1'));
      const wrote = new Date(Date.now() - 3_600_000);
      await run(inbound('late-1', { sentAt: wrote.toISOString() }));

      const stored = await messages();
      expect(stored.map((m) => m.seq)).toEqual([1, 2]);
      expect(stored[1]?.providerSentAt?.toISOString()).toBe(wrote.toISOString());
      const [conversation] = await conversations();
      expect(conversation?.customerLastMessageAt?.toISOString()).toBe(wrote.toISOString());
    });
  });

  describe('контакти й адреси', () => {
    it('номер у двох форматах — один контакт', async () => {
      await run(inbound('fmt-1', { from: { kind: 'phone', value: '+380501234567' } }));
      await run(inbound('fmt-2', { from: { kind: 'phone', value: '380501234567' } }));

      const found = await contacts();
      expect(found).toHaveLength(1);
      expect(found[0]?.addresses).toHaveLength(1);
      expect(await messages()).toHaveLength(2);
    });

    it('новий контакт: профільне імʼя, нікого не привʼязано, клієнт не створений', async () => {
      const before = await prisma.customer.count();
      await run(inbound('new-1', { from: { kind: 'phone', value: '380677000111' }, profileName: 'Нова людина' }));

      const [contact] = await contacts();
      expect(contact).toMatchObject({ displayName: 'Нова людина', customerId: null });
      expect(await prisma.customer.count()).toBe(before);
    });

    it('рівно один клієнт має цей номер — контакт привʼязано', async () => {
      const customerId = await makeCustomer('Один власник', '+380 67 700 0222');
      await run(inbound('link-1', { from: { kind: 'phone', value: '380677000222' } }));
      expect((await contacts())[0]?.customerId).toBe(customerId);
    });

    it('двоє клієнтів мають цей номер — контакт лишається непривʼязаним', async () => {
      await makeCustomer('Перший', '+380 67 700 0333');
      await makeCustomer('Другий', '380677000333');
      await run(inbound('link-2', { from: { kind: 'phone', value: '380677000333' } }));
      expect((await contacts())[0]?.customerId).toBeNull();
    });

    it('привʼязка відбувається лише для НОВОГО контакта: пізніше зʼявився клієнт — не привʼязується сам', async () => {
      await run(inbound('late-link-1', { from: { kind: 'phone', value: '380677000444' } }));
      await makeCustomer('Пізній', '380677000444');
      await run(inbound('late-link-2', { from: { kind: 'phone', value: '380677000444' } }));
      expect((await contacts())[0]?.customerId).toBeNull();
    });
  });

  describe('розмова клієнта', () => {
    it('нова розмова — CUSTOMER з access tenant, на канал і контакт, без учасників', async () => {
      await run(inbound('conv-1'));
      const [conversation] = await conversations();
      expect(conversation).toMatchObject({ kind: 'CUSTOMER', access: 'tenant', status: 'OPEN', assigneeId: null });
      expect(
        await prisma.conversationParticipant.count({ where: { conversationId: conversation?.id ?? '' } }),
      ).toBe(0);
    });

    it('друге повідомлення тієї ж людини йде в ту саму відкриту розмову', async () => {
      await run(inbound('same-1'));
      await run(inbound('same-2'));
      expect(await conversations()).toHaveLength(1);
      expect((await messages()).map((m) => m.seq)).toEqual([1, 2]);
    });

    it('розв\'язана розмова всередині вікна повертається в роботу', async () => {
      await run(inbound('reopen-1'));
      const [conversation] = await conversations();
      await prisma.conversation.update({
        where: { id: conversation?.id ?? '' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), lastMessageAt: new Date(Date.now() - 3_600_000) },
      });
      await run(inbound('reopen-2'));

      const all = await conversations();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ id: conversation?.id, status: 'OPEN', resolvedAt: null });
    });

    it('розв\'язана розмова поза вікном: відкривається нова', async () => {
      await run(inbound('old-1'));
      const [conversation] = await conversations();
      await prisma.conversation.update({
        where: { id: conversation?.id ?? '' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), lastMessageAt: new Date(Date.now() - 48 * 3_600_000) },
      });
      await run(inbound('old-2', { sentAt: new Date().toISOString() }));
      expect(await conversations()).toHaveLength(2);
    });

    it('вікно береться з налаштувань каналу', async () => {
      await prisma.channel.update({ where: { id: channelId }, data: { settings: { reopenHours: 1 } } });
      await run(inbound('win-1'));
      const [conversation] = await conversations();
      await prisma.conversation.update({
        where: { id: conversation?.id ?? '' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), lastMessageAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      await run(inbound('win-2'));
      expect(await conversations()).toHaveLength(2);
    });
  });

  describe('що не маршрутизується й що не розбирається', () => {
    it('невідомий канал: подія UNROUTABLE, повідомлення й розмов немає', async () => {
      const outcome = await run(inbound('x-1', { channelExternalId: 'no-such-phone' }));
      expect(outcome).toMatchObject({ state: 'UNROUTABLE', stored: 0, error: 'unknown_channel' });
      expect(await messages()).toHaveLength(0);
      expect(await conversations()).toHaveLength(0);
      expect((await prisma.channelWebhookEvent.findMany({ where: { accountId } }))[0]?.state).toBe('UNROUTABLE');
    });

    it('вимкнений канал: UNROUTABLE', async () => {
      await prisma.channel.update({ where: { id: channelId }, data: { isEnabled: false } });
      const outcome = await run(inbound('x-2'));
      expect(outcome).toMatchObject({ state: 'UNROUTABLE', error: 'channel_disabled' });
      expect(await messages()).toHaveLength(0);
    });

    it('змішана подія: маршрутизоване збережено, нерозпізнане — ні, стан PROCESSED', async () => {
      const outcome = await run(inbound('mix-1'), inbound('mix-2', { channelExternalId: 'other-phone' }));
      expect(outcome).toMatchObject({ state: 'PROCESSED', stored: 1, error: 'unknown_channel' });
    });

    it('нерозбірне тіло: FAILED, а не виняток', async () => {
      const eventId = await storeEvent('not json');
      const outcome = await runStored(eventId);
      expect(outcome).toMatchObject({ state: 'FAILED', error: 'invalid_json' });
      expect((await prisma.channelWebhookEvent.findUniqueOrThrow({ where: { id: eventId } })).state).toBe('FAILED');
    });

    it('повторний запуск уже опрацьованої події нічого не робить', async () => {
      const eventId = await storeEvent(buildFakeWebhookBody([inbound('again-1')]));
      await runStored(eventId);
      const again = await runStored(eventId);
      expect(again.state).toBe('SKIPPED');
      expect(await messages()).toHaveLength(1);
    });
  });
});
