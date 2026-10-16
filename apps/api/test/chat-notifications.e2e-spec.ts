/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  CHAT_CLIENT_SOCKET_EVENTS,
  REALTIME_EVENTS,
  conversationRoom,
  type NotificationChanged,
  type NotificationSummary,
} from '@saas-skeleton/contracts';
import {
  SystemPrismaModule, SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import {
  ChatNotifier,
  NonRetryableMessageError,
  NotificationDispatcherRegistry,
  NotificationRecorder,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RealtimeEmitter } from '../src/realtime/realtime.emitter';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

const POSTED_QUEUE = 'chat.message-posted.v1/chat-notify';

interface Participant {
  id: string;
  name: string;
  accessToken: string;
  headers: { Authorization: string };
}

/**
 * CHAT-0.2c (chat/notifications): публікація події при відправці, «хто дивиться», і те, що
 * `ChatNotifier` робить з нею проти справжньої БД. Воркер у e2e не крутиться, тож його роль
 * виконує виклик `ChatNotifier` у `withTenantTx` — рівно те, що робить `ChatNotifySubscriber`.
 */
describe('Chat notifications (e2e, CHAT-0.2c)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let notifier: ChatNotifier;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    transactions = app.get(TenantTransactions);
    notifier = new ChatNotifier(app.get(NotificationRecorder));
  });

  beforeEach(async () => {
    sentJobs.reset();
    await prisma.notification.deleteMany();
    await prisma.conversation.deleteMany({ where: { isDefault: false } });
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) socket.disconnect();
    await sleep(150);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const login = async (name: string): Promise<Participant> => {
    const email = `${name}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name,
      role: 'USER',
    });
    return {
      id: user.id,
      name,
      accessToken: tokens.accessToken,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    };
  };

  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = ioClient(`${baseUrl}/tenant`, {
        path: '/socket.io',
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
      });
      openSockets.push(socket);
      socket.on('connect', () => {
        resolve(socket);
      });
      socket.on('connect_error', (error: Error) => {
        reject(error);
      });
    });

  const emitAck = (socket: ClientSocket, event: string, payload: unknown): Promise<unknown> =>
    socket.timeout(3_000).emitWithAck(event, payload);

  const subscribe = (socket: ClientSocket, conversationId: string): Promise<unknown> =>
    emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatSubscribe.name, { conversationId });

  const createConversation = async (
    creator: Participant,
    others: Participant[],
    title?: string,
  ): Promise<string> => {
    const response = await http()
      .post('/api/conversations')
      .set(creator.headers)
      .send({ participantUserIds: others.map((p) => p.id), ...(title ? { title } : {}) })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  const post = (
    author: Participant,
    conversationId: string,
    body: string,
    clientMessageId = randomUUID(),
  ) =>
    http()
      .post(`/api/conversations/${conversationId}/messages`)
      .set(author.headers)
      .send({ body, clientMessageId });

  /** Рівно те, що робить `ChatNotifySubscriber` після доставки події воркеру */
  const runNotifier = (
    conversationId: string,
    messageId: string,
    viewerIds: string[] = [],
  ): Promise<void> =>
    tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      transactions.withTenantTx((tx) =>
        notifier.notifyMessagePosted(tx, { conversationId, messageId, viewerIds }),
      ),
    );

  /** Відправити через API й одразу прогнати сповіщувач; повертає id репліки */
  const sendAndNotify = async (
    author: Participant,
    conversationId: string,
    body: string,
    viewerIds: string[] = [],
  ): Promise<string> => {
    const response = await post(author, conversationId, body).expect(201);
    const messageId = (response.body as { id: string }).id;
    await runNotifier(conversationId, messageId, viewerIds);
    return messageId;
  };

  const rows = (userId: string) =>
    prisma.notification.findMany({
      where: { recipientId: userId, type: 'chat.message_received' },
      orderBy: { createdAt: 'asc' },
    });

  const summary = async (user: Participant): Promise<NotificationSummary> =>
    (await http().get('/api/notifications/summary').set(user.headers).expect(200))
      .body as NotificationSummary;

  const lastSeq = async (conversationId: string): Promise<number> =>
    (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).lastSeq;

  describe('chat.message-posted.v1 (4.1)', () => {
    it('публікує рівно одну роботу chat-notify: тенант і автор у конверті, у payload лише id', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      sentJobs.reset();

      await post(alice, conversationId, 'секретний текст реплічки').expect(201);

      const jobs = sentJobs.forQueue(POSTED_QUEUE);
      expect(jobs).toHaveLength(1);
      const envelope = jobs[0]?.envelope as {
        name: string;
        tenantId: string;
        actor: { type: string; id: string };
        data: Record<string, unknown>;
      };
      expect(envelope).toMatchObject({
        name: 'chat.message-posted.v1',
        tenantId: DEFAULT_TENANT_ID,
        actor: { type: 'user', id: alice.id },
      });
      expect(Object.keys(envelope.data).sort()).toEqual(['conversationId', 'messageId', 'viewerIds']);
      // pgboss.* поза RLS: тексту листування там бути не може
      expect(JSON.stringify(jobs[0]?.envelope)).not.toContain('секретний');
    });

    it('не публікує нічого для повтору clientMessageId, відхиленої відправки й відкоченої транзакції', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol'); // не учасник
      const conversationId = await createConversation(alice, [bob]);
      sentJobs.reset();

      const clientMessageId = randomUUID();
      await post(alice, conversationId, 'once', clientMessageId).expect(201);
      expect(sentJobs.forQueue(POSTED_QUEUE)).toHaveLength(1);

      // Повтор: збережений рядок, друга робота не ставиться
      await post(alice, conversationId, 'once', clientMessageId).expect(201);
      expect(sentJobs.forQueue(POSTED_QUEUE)).toHaveLength(1);

      // Відхилені: чужа розмова (404) і невалідне тіло (400)
      await post(carol, conversationId, 'intruder').expect(404);
      await http()
        .post(`/api/conversations/${conversationId}/messages`)
        .set(alice.headers)
        .send({ body: '', clientMessageId: randomUUID() })
        .expect(400);
      expect(sentJobs.forQueue(POSTED_QUEUE)).toHaveLength(1);

      // Гонка двох однакових запитів: переможець публікує, програвший відкочується разом із роботою
      sentJobs.reset();
      const racing = randomUUID();
      const [first, second] = await Promise.all([
        post(alice, conversationId, 'race', racing),
        post(alice, conversationId, 'race', racing),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(sentJobs.forQueue(POSTED_QUEUE)).toHaveLength(1);
    });

    it('viewerIds містить того, хто підписаний на розмову, і не містить того, хто лише підключений', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol');
      const conversationId = await createConversation(alice, [bob, carol]);

      const bobSocket = await connect(bob.accessToken);
      await connect(carol.accessToken); // підключений, але розмову не відкривав
      await subscribe(bobSocket, conversationId);
      sentJobs.reset();

      await post(alice, conversationId, 'hello').expect(201);

      const data = (sentJobs.forQueue(POSTED_QUEUE)[0]?.envelope as { data: { viewerIds: string[] } })
        .data;
      expect(data.viewerIds).toEqual([bob.id]);
    });
  });

  describe('RealtimeEmitter.userIdsInRoom (4.2)', () => {
    it('повертає юзера з двох сокетів один раз, а порожню кімнату — як []', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      const emitter = app.get(RealtimeEmitter);
      const room = conversationRoom(DEFAULT_TENANT_ID, conversationId);

      expect(await emitter.userIdsInRoom(room)).toEqual([]);

      await subscribe(await connect(bob.accessToken), conversationId);
      await subscribe(await connect(bob.accessToken), conversationId);
      await connect(alice.accessToken); // без підписки

      expect(await emitter.userIdsInRoom(room)).toEqual([bob.id]);
    });

    it('fail-open: namespace ще не готовий → []', async () => {
      const unready = new RealtimeEmitter(
        app.get(NotificationDispatcherRegistry),
        tenantContext,
      );
      expect(await unready.userIdsInRoom('tenant:x:conversation:y')).toEqual([]);
      // повернути реєстрацію справжнього емітера: конструктор перереєстрував себе як диспетчер
      app.get(NotificationDispatcherRegistry).register(app.get(RealtimeEmitter));
    });
  });

  describe('ChatNotifier (4.3)', () => {
    it('адресує учасникам, крім автора, глядачів і тих, хто вийшов', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol'); // дивиться
      const dave = await login('np-dave'); // вийшов
      const conversationId = await createConversation(alice, [bob, carol, dave]);
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId: dave.id },
        data: { leftAt: new Date() },
      });

      await sendAndNotify(alice, conversationId, 'hi all', [carol.id]);

      expect(await rows(bob.id)).toHaveLength(1);
      expect(await rows(alice.id)).toHaveLength(0);
      expect(await rows(carol.id)).toHaveLength(0);
      expect(await rows(dave.id)).toHaveLength(0);
      const [row] = await rows(bob.id);
      expect(row).toMatchObject({
        targetKind: 'conversation',
        targetId: conversationId,
        groupKey: `conversation:${conversationId}`,
        actorId: alice.id,
        groupCount: 1,
      });
    });

    it('системний запис нічого не дзвонить', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      const system = await prisma.chatMessage.findFirstOrThrow({
        where: { conversationId, kind: 'SYSTEM' },
      });

      await runNotifier(conversationId, system.id);

      expect(await rows(bob.id)).toHaveLength(0);
    });

    it('три репліки зливаються в один рядок з groupCount 3 і найсвіжішим прев’ю', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);

      await sendAndNotify(alice, conversationId, 'one');
      await sendAndNotify(alice, conversationId, 'two');
      await sendAndNotify(alice, conversationId, 'three');

      const list = await rows(bob.id);
      expect(list).toHaveLength(1);
      expect(list[0]?.groupCount).toBe(3);
      expect(list[0]?.payload).toMatchObject({ preview: 'three' });
    });

    it('після прочитаного наступна репліка дає свіже сповіщення', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);

      await sendAndNotify(alice, conversationId, 'first');
      await prisma.notification.updateMany({
        where: { recipientId: bob.id },
        data: { readAt: new Date() },
      });
      await sendAndNotify(alice, conversationId, 'second');

      const list = await rows(bob.id);
      expect(list).toHaveLength(2);
      expect(list.filter((row) => row.readAt === null)).toHaveLength(1);
      expect(list.at(-1)?.groupCount).toBe(1);
    });

    it('той, хто вимкнув категорію, не отримує нічого', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      await prisma.notificationPreference.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          userId: bob.id,
          type: 'chat.message_received',
          channel: 'in_app',
          enabled: false,
        },
      });

      await sendAndNotify(alice, conversationId, 'muted');

      expect(await rows(bob.id)).toHaveLength(0);
    });

    it('підпис розмови: назва; парна — ім’я автора; без назви — до трьох співрозмовників', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol');
      const dave = await login('np-dave');
      const erin = await login('np-erin');
      const labelOf = async (userId: string): Promise<string> =>
        ((await rows(userId)).at(-1)?.payload as { conversation: { label: string } }).conversation
          .label;

      const titled = await createConversation(alice, [bob], 'Sales team');
      await sendAndNotify(alice, titled, 'a');
      expect(await labelOf(bob.id)).toBe('Sales team');

      await prisma.notification.deleteMany();
      const direct = await createConversation(alice, [bob]);
      await sendAndNotify(alice, direct, 'b');
      expect(await labelOf(bob.id)).toBe('np-alice');

      await prisma.notification.deleteMany();
      const group = await createConversation(alice, [bob, carol, dave, erin]);
      await sendAndNotify(alice, group, 'c');
      const label = await labelOf(bob.id);
      expect(label.split(', ')).toHaveLength(3);
      expect(label).not.toContain('np-bob'); // отримувача в підписі немає
    });

    it('повторний виклик для іншого складу не чіпає рядки попередніх отримувачів', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol');
      const conversationId = await createConversation(alice, [bob, carol]);

      const messageId = await sendAndNotify(alice, conversationId, 'both', [carol.id]);
      expect(await rows(bob.id)).toHaveLength(1);
      expect(await rows(carol.id)).toHaveLength(0);

      // Той самий запис, але тепер carol не дивиться: bob ще раз колапсується, carol отримує своє
      await runNotifier(conversationId, messageId, []);
      expect((await rows(carol.id)).at(0)?.groupCount).toBe(1);
      expect((await rows(bob.id)).at(0)?.groupCount).toBe(2);
    });

    it('відсутня розмова чи репліка — NonRetryableMessageError', async () => {
      await expect(runNotifier(randomUUID(), randomUUID())).rejects.toBeInstanceOf(
        NonRetryableMessageError,
      );
    });
  });

  describe('читання гасить сповіщення (4.4)', () => {
    const readViaRest = (user: Participant, conversationId: string, seq: number) =>
      http()
        .post(`/api/conversations/${conversationId}/read`)
        .set(user.headers)
        .send({ seq })
        .expect(204);

    const watchChanged = (socket: ClientSocket): NotificationChanged[] => {
      const seen: NotificationChanged[] = [];
      socket.on(REALTIME_EVENTS.notificationChanged, (payload: NotificationChanged) => {
        seen.push(payload);
      });
      return seen;
    };

    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 3_000;
      while (!predicate() && Date.now() < deadline) await sleep(25);
    };

    it('REST: сповіщення прочитане, друга вкладка отримує notification.changed, дзвінок меншає', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      await sendAndNotify(alice, conversationId, 'ping');
      // Інші непрочитані юзера в тенанті (системні тощо) — не предмет тесту: рахуємо різницю
      const before = await summary(bob);

      const otherTab = await connect(bob.accessToken);
      const seen = watchChanged(otherTab);

      await readViaRest(bob, conversationId, await lastSeq(conversationId));

      await waitFor(() => seen.length > 0);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ change: 'read', unreadCount: before.unreadCount - 1 });
      expect((await rows(bob.id))[0]?.readAt).not.toBeNull();
      expect((await summary(bob)).unreadCount).toBe(before.unreadCount - 1);
    });

    it('сокет chat.read.v1 теж гасить сповіщення', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      await sendAndNotify(alice, conversationId, 'ping');
      const before = await summary(bob);

      const socket = await connect(bob.accessToken);
      await emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatRead.name, {
        conversationId,
        seq: await lastSeq(conversationId),
      });

      expect((await rows(bob.id))[0]?.readAt).not.toBeNull();
      expect((await summary(bob)).unreadCount).toBe(before.unreadCount - 1);
    });

    it('застарілий seq лишає сповіщення непрочитаним і нічого не шле', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const conversationId = await createConversation(alice, [bob]);
      await sendAndNotify(alice, conversationId, 'one');
      await readViaRest(bob, conversationId, await lastSeq(conversationId));
      await sendAndNotify(alice, conversationId, 'two'); // нове сповіщення після прочитаного
      const seen = watchChanged(await connect(bob.accessToken));

      await readViaRest(bob, conversationId, 1); // назад — no-op

      await sleep(300);
      expect(seen).toHaveLength(0);
      const unread = (await rows(bob.id)).filter((row) => row.readAt === null);
      expect(unread).toHaveLength(1);
    });

    it('читання іншого учасника не змінює сповіщення отримувача', async () => {
      const alice = await login('np-alice');
      const bob = await login('np-bob');
      const carol = await login('np-carol');
      const conversationId = await createConversation(alice, [bob, carol]);
      await sendAndNotify(alice, conversationId, 'ping');

      await readViaRest(carol, conversationId, await lastSeq(conversationId));

      expect((await rows(bob.id))[0]?.readAt).toBeNull();
      expect((await rows(carol.id))[0]?.readAt).not.toBeNull();
    });
  });
});
