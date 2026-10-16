/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  CHAT_CLIENT_SOCKET_EVENTS,
  CHAT_MAX_VIEWED_CONVERSATIONS,
  CHAT_TYPING_TTL_MS,
  REALTIME_EVENTS,
  defineClientSocketEvent,
  type ChatConversationChanged,
  type ChatTypingChanged,
  type ClientEventAck,
} from '@saas-skeleton/contracts';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ClientEventRegistry } from '../src/realtime/client-event.registry';
import { SocketEventError } from '../src/realtime/realtime.errors';
import { createAndLoginTestUser } from './test-users';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000044';
const TENANT_B_SLUG = 'chat-sock-tenant-b';

interface Participant {
  id: string;
  email: string;
  accessToken: string;
  headers: { Authorization: string };
}

/** Тестові події, зареєстровані ДО підключення сокетів: `attach` бере все, що є на момент зʼєднання */
const BOOM_SECRET = 'internal secret detail';
const boomEvent = defineClientSocketEvent('test.boom.v1', z.object({}), z.object({}));
const forbiddenEvent = defineClientSocketEvent('test.forbidden.v1', z.object({}), z.object({}));
const limitEvent = defineClientSocketEvent('test.limit.v1', z.object({}), z.object({}));

const NOT_FOUND = { ok: false, code: 'NOT_FOUND' };

/**
 * Чат, фаза CHAT-0.2b: що сокет дозволяє казати серверу (docs/chat.md §4.8.2). Тримає
 * обіцянки, ради яких ця фаза існує: підписка проходить ту саму перевірку доступу, що й
 * читання (і відмовляє однаково), typing доходить лише до тих, хто дивиться, і нічого не
 * лишає в БД, прочитане через сокет дає той самий слід, що й REST, а будь-яка кривa чи
 * надмірна подія відхиляється без наслідків.
 */
describe('Chat socket events (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);

    const registry = app.get(ClientEventRegistry);
    registry.register(boomEvent, () => {
      throw new Error(BOOM_SECRET);
    });
    registry.register(forbiddenEvent, () => {
      throw new ForbiddenException('nope');
    });
    registry.register(limitEvent, () => {
      throw new SocketEventError('LIMIT_EXCEEDED', 'too many');
    });

    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);

    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'Chat Socket Tenant B' },
    });
  });

  beforeEach(async () => {
    // Дефолтний канал НЕ чіпаємо: він інваріант тенанта, а не дані тесту
    await prisma.conversation.deleteMany({ where: { isDefault: false } });
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.disconnect();
    }
    await sleep(150);
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  const login = async (prefix: string): Promise<Participant> => {
    const email = uniqueEmail(prefix);
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: prefix,
      role: 'USER',
    });
    return {
      id: user.id,
      email,
      accessToken: tokens.accessToken,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    };
  };

  const loginInTenantB = async (): Promise<Participant> => {
    const email = uniqueEmail('chat-sock-b');
    const user = await prisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email,
        name: 'Chat Sock B',
        role: 'USER',
        passwordHash: await argon2.hash('SecurePass123'),
      },
    });
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: 'SecurePass123', tenant: TENANT_B_SLUG })
      .expect(200);
    const accessToken = (response.body as { tokens: { accessToken: string } }).tokens.accessToken;
    return { id: user.id, email, accessToken, headers: { Authorization: `Bearer ${accessToken}` } };
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

  const emitAck = (
    socket: ClientSocket,
    event: string,
    payload: unknown,
  ): Promise<ClientEventAck<unknown>> =>
    socket.timeout(3_000).emitWithAck(event, payload) as Promise<ClientEventAck<unknown>>;

  const subscribe = (socket: ClientSocket, conversationId: string) =>
    emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatSubscribe.name, { conversationId });
  const unsubscribe = (socket: ClientSocket, conversationId: string) =>
    emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatUnsubscribe.name, { conversationId });
  const typing = (socket: ClientSocket, conversationId: string) =>
    emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatTyping.name, { conversationId });
  const read = (socket: ClientSocket, conversationId: string, seq: number) =>
    emitAck(socket, CHAT_CLIENT_SOCKET_EVENTS.chatRead.name, { conversationId, seq });

  const recordTyping = (socket: ClientSocket): ChatTypingChanged[] => {
    const seen: ChatTypingChanged[] = [];
    socket.on(REALTIME_EVENTS.chatTypingChanged, (payload: ChatTypingChanged) => {
      seen.push(payload);
    });
    return seen;
  };

  const recordChanges = (socket: ClientSocket): ChatConversationChanged[] => {
    const seen: ChatConversationChanged[] = [];
    socket.on(REALTIME_EVENTS.chatConversationChanged, (payload: ChatConversationChanged) => {
      seen.push(payload);
    });
    return seen;
  };

  /** Рівно `count` подій: дочекатися, а потім дати вікно на зайві */
  const settle = async (seen: unknown[], count: number): Promise<void> => {
    const deadline = Date.now() + 3_000;
    while (seen.length < count && Date.now() < deadline) {
      await sleep(25);
    }
    await sleep(250);
    expect(seen).toHaveLength(count);
  };

  const createConversation = async (
    creator: Participant,
    others: Participant[],
  ): Promise<string> => {
    const response = await http()
      .post('/api/conversations')
      .set(creator.headers)
      .send({ participantUserIds: others.map((user) => user.id) })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  const post = (author: Participant, conversationId: string, body: string) =>
    http()
      .post(`/api/conversations/${conversationId}/messages`)
      .set(author.headers)
      .send({ body, clientMessageId: randomUUID() });

  const participantRow = (conversationId: string, userId: string) =>
    prisma.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadSeq: true, unreadCount: true },
    });

  describe('subscribe / unsubscribe', () => {
    it('accepts a participant and refuses everyone else with one identical answer', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const carol = await login('chat-sock-carol'); // same tenant, not a participant
      const erin = await login('chat-sock-erin'); // participant who has left
      const dave = await loginInTenantB();
      const conversationId = await createConversation(alice, [bob, erin]);
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId: erin.id },
        data: { leftAt: new Date() },
      });

      const aliceSocket = await connect(alice.accessToken);
      expect(await subscribe(aliceSocket, conversationId)).toEqual({
        ok: true,
        data: { conversationId },
      });

      // Чужий, чужого тенанта, залишений і неіснуючий: відповідь та сама до символу
      for (const outsider of [carol, erin, dave]) {
        const socket = await connect(outsider.accessToken);
        expect(await subscribe(socket, conversationId)).toEqual(NOT_FOUND);
      }
      expect(await subscribe(aliceSocket, randomUUID())).toEqual(NOT_FOUND);
    });

    it('lets anyone withdraw, including from a conversation never announced', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const carol = await login('chat-sock-carol');
      const conversationId = await createConversation(alice, [bob]);

      const aliceSocket = await connect(alice.accessToken);
      await subscribe(aliceSocket, conversationId);
      expect(await unsubscribe(aliceSocket, conversationId)).toEqual({ ok: true, data: {} });
      // Не була підписана, і взагалі не учасниця — відповідь `ok`, нічого не розкриваючи
      const carolSocket = await connect(carol.accessToken);
      expect(await unsubscribe(carolSocket, conversationId)).toEqual({ ok: true, data: {} });
      expect(await unsubscribe(carolSocket, randomUUID())).toEqual({ ok: true, data: {} });
    });

    it('refuses the sixth conversation on one socket without disturbing the first five', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const ids: string[] = [];
      for (let index = 0; index <= CHAT_MAX_VIEWED_CONVERSATIONS; index += 1) {
        ids.push(await createConversation(alice, [bob]));
      }
      const [first, ...rest] = ids;
      const sixth = ids[CHAT_MAX_VIEWED_CONVERSATIONS] as string;

      const aliceSocket = await connect(alice.accessToken);
      const bobSocket = await connect(bob.accessToken);
      const bobSeen = recordTyping(bobSocket);
      for (const id of ids.slice(0, CHAT_MAX_VIEWED_CONVERSATIONS)) {
        expect(await subscribe(aliceSocket, id)).toMatchObject({ ok: true });
      }
      expect(await subscribe(aliceSocket, sixth)).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
      // Повторна підписка на вже тримані розмови слота не їсть
      expect(await subscribe(aliceSocket, first as string)).toMatchObject({ ok: true });
      expect(rest).toHaveLength(CHAT_MAX_VIEWED_CONVERSATIONS);

      // Перші п'ять досі тримаються: typing з першої розмови доходить до того, хто в ній дивиться
      await subscribe(bobSocket, first as string);
      expect(await typing(aliceSocket, first as string)).toEqual({ ok: true, data: {} });
      await settle(bobSeen, 1);
    });
  });

  describe('typing', () => {
    it('reaches only viewers, and leaves no trace in the conversation', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const carol = await login('chat-sock-carol');
      const conversationId = await createConversation(alice, [bob, carol]);
      await post(alice, conversationId, 'hello').expect(201);

      const before = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { lastSeq: true, lastMessagePreview: true, lastMessageAt: true },
      });
      const unreadBefore = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true, unreadCount: true },
        orderBy: { userId: 'asc' },
      });

      const typist = await connect(alice.accessToken);
      const typistOtherTab = await connect(alice.accessToken);
      const bobSocket = await connect(bob.accessToken);
      const carolSocket = await connect(carol.accessToken); // participant who is NOT viewing
      const otherTabSeen = recordTyping(typistOtherTab);
      const bobSeen = recordTyping(bobSocket);
      const carolSeen = recordTyping(carolSocket);
      const typistSeen = recordTyping(typist);
      await subscribe(typist, conversationId);
      await subscribe(typistOtherTab, conversationId);
      await subscribe(bobSocket, conversationId);

      expect(await typing(typist, conversationId)).toEqual({ ok: true, data: {} });

      await settle(bobSeen, 1);
      expect(bobSeen[0]).toEqual({
        conversationId,
        userId: alice.id,
        expiresInMs: CHAT_TYPING_TTL_MS,
      });
      // Інша вкладка друкуючого теж отримує (клієнт відкидає за власним userId); сам сокет — ні
      await settle(otherTabSeen, 1);
      await settle(typistSeen, 0);
      await settle(carolSeen, 0);

      // Нічого не записано: ні стрічка, ні прев'ю, ні лічильники
      const after = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { lastSeq: true, lastMessagePreview: true, lastMessageAt: true },
      });
      expect(after).toEqual(before);
      expect(
        await prisma.conversationParticipant.findMany({
          where: { conversationId },
          select: { userId: true, unreadCount: true },
          orderBy: { userId: 'asc' },
        }),
      ).toEqual(unreadBefore);
    });

    it('refuses a signal from a socket that is not viewing the conversation', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const conversationId = await createConversation(alice, [bob]);

      const bobViewer = await connect(bob.accessToken);
      const aliceNotViewing = await connect(alice.accessToken);
      const bobSeen = recordTyping(bobViewer);
      await subscribe(bobViewer, conversationId);

      expect(await typing(aliceNotViewing, conversationId)).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      await settle(bobSeen, 0);
    });

    it('drops the excess of a flood and keeps the connection usable', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const conversationId = await createConversation(alice, [bob]);
      const typist = await connect(alice.accessToken);
      const bobSocket = await connect(bob.accessToken);
      const bobSeen = recordTyping(bobSocket);
      await subscribe(bobSocket, conversationId);
      await subscribe(typist, conversationId);

      const acks: ClientEventAck<unknown>[] = [];
      for (let index = 0; index < 7; index += 1) {
        acks.push(await typing(typist, conversationId));
      }

      expect(acks.slice(0, 5).every((ack) => ack.ok)).toBe(true);
      expect(acks.slice(5)).toEqual([
        { ok: false, code: 'RATE_LIMITED' },
        { ok: false, code: 'RATE_LIMITED' },
      ]);
      await settle(bobSeen, 5);
      // Ліміт — на подію: інші події того самого сокета живі
      expect(await subscribe(typist, conversationId)).toMatchObject({ ok: true });
    });
  });

  describe('read over the socket', () => {
    it('leaves the same trace as the request, and tells only the reader’s tabs', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const carol = await login('chat-sock-carol');
      const conversationId = await createConversation(alice, [bob, carol]);
      for (const text of ['one', 'two', 'three']) {
        await post(alice, conversationId, text).expect(201);
      }
      const lastSeq = (
        await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
      ).lastSeq;

      const aliceSeen = recordChanges(await connect(alice.accessToken));
      const bobTab1 = await connect(bob.accessToken);
      const bobTab2 = await connect(bob.accessToken);
      const bobTab1Seen = recordChanges(bobTab1);
      const bobTab2Seen = recordChanges(bobTab2);

      // Боб — через сокет, Керол — через REST, ті самі вхідні
      expect(await read(bobTab1, conversationId, lastSeq)).toEqual({ ok: true, data: {} });
      await http()
        .post(`/api/conversations/${conversationId}/read`)
        .set(carol.headers)
        .send({ seq: lastSeq })
        .expect(204);

      expect(await participantRow(conversationId, bob.id)).toEqual(
        await participantRow(conversationId, carol.id),
      );
      expect((await participantRow(conversationId, bob.id)).unreadCount).toBe(0);

      // Рух курсора чує кожна вкладка того, хто читає, і ніхто інший
      await settle(bobTab1Seen, 1);
      await settle(bobTab2Seen, 1);
      expect(bobTab2Seen[0]).toMatchObject({ conversationId, change: 'read' });
      await settle(aliceSeen, 0);

      // Застаріла позиція: `ok`, нічого не рухається, ніхто не чує
      expect(await read(bobTab1, conversationId, 1)).toEqual({ ok: true, data: {} });
      expect((await participantRow(conversationId, bob.id)).lastReadSeq).toBe(lastSeq);
      await settle(bobTab1Seen, 1);
      await settle(bobTab2Seen, 1);
    });

    it('refuses a non-participant exactly like an unknown conversation and changes nothing', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const carol = await login('chat-sock-carol');
      const conversationId = await createConversation(alice, [bob]);
      await post(alice, conversationId, 'hi').expect(201);
      const lastSeq = (
        await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
      ).lastSeq;
      const before = await participantRow(conversationId, bob.id);

      const carolSocket = await connect(carol.accessToken);
      expect(await read(carolSocket, conversationId, lastSeq)).toEqual(NOT_FOUND);
      expect(await read(carolSocket, randomUUID(), lastSeq)).toEqual(NOT_FOUND);
      expect(await participantRow(conversationId, bob.id)).toEqual(before);
    });
  });

  describe('validation and the tenant context', () => {
    it('refuses malformed requests without side effects and stays connected', async () => {
      const alice = await login('chat-sock-alice');
      const bob = await login('chat-sock-bob');
      const conversationId = await createConversation(alice, [bob]);
      const socket = await connect(alice.accessToken);

      const invalid = { ok: false, code: 'INVALID_PAYLOAD' };
      expect(await emitAck(socket, 'chat.subscribe.v1', {})).toEqual(invalid);
      expect(await emitAck(socket, 'chat.subscribe.v1', { conversationId: 123 })).toEqual(invalid);
      expect(await emitAck(socket, 'chat.subscribe.v1', { conversationId: 'not-a-uuid' })).toEqual(
        invalid,
      );
      expect(await emitAck(socket, 'chat.read.v1', { conversationId, seq: -1 })).toEqual(invalid);
      expect(await emitAck(socket, 'chat.read.v1', { conversationId, seq: 'x' })).toEqual(invalid);
      expect((await participantRow(conversationId, alice.id)).lastReadSeq).toBeGreaterThanOrEqual(
        0,
      );

      // Подія без ack-колбека не валить обробник, і зʼєднання живе
      socket.emit('chat.typing.v1', { conversationId });
      expect(socket.connected).toBe(true);
      expect(await subscribe(socket, conversationId)).toMatchObject({ ok: true });
    });

    it('runs handlers under the caller’s own tenant', async () => {
      const alice = await login('chat-sock-alice');
      const dave = await loginInTenantB();
      const foreign = await prisma.conversation.create({
        data: { tenantId: TENANT_B_ID, kind: 'INTERNAL', access: 'private', lastSeq: 1 },
        select: { id: true },
      });
      await prisma.conversationParticipant.create({
        data: {
          tenantId: TENANT_B_ID,
          conversationId: foreign.id,
          userId: dave.id,
          role: 'member',
        },
      });

      const aliceSocket = await connect(alice.accessToken);
      const daveSocket = await connect(dave.accessToken);

      // Тенант A не бачить розмову тенанта B під RLS; її власник у B — бачить
      expect(await subscribe(aliceSocket, foreign.id)).toEqual(NOT_FOUND);
      expect(await read(aliceSocket, foreign.id, 1)).toEqual(NOT_FOUND);
      expect(await subscribe(daveSocket, foreign.id)).toMatchObject({ ok: true });
    });
  });

  describe('registry', () => {
    it('refuses to register the same event twice', () => {
      const registry = app.get(ClientEventRegistry);
      expect(() => {
        registry.register(CHAT_CLIENT_SOCKET_EVENTS.chatTyping, () => ({}));
      }).toThrow(/already registered/);
    });

    it('translates failures into closed codes and never leaks the internal message', async () => {
      const alice = await login('chat-sock-alice');
      const socket = await connect(alice.accessToken);

      const internal = await emitAck(socket, boomEvent.name, {});
      expect(internal).toEqual({ ok: false, code: 'INTERNAL' });
      expect(JSON.stringify(internal)).not.toContain(BOOM_SECRET);

      expect(await emitAck(socket, forbiddenEvent.name, {})).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(await emitAck(socket, limitEvent.name, {})).toEqual({
        ok: false,
        code: 'LIMIT_EXCEEDED',
      });
      // Після відмови зʼєднання придатне до роботи
      expect(socket.connected).toBe(true);
    });
  });
});
