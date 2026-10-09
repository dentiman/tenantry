/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  type ChatConversationChanged,
  type ChatMessageCreated,
} from '@saas-skeleton/contracts';
import { SystemPrismaService } from '@saas-skeleton/database';
import { joinDefaultChannel } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000043';
const TENANT_B_SLUG = 'chat-rt-tenant-b';

interface Participant {
  id: string;
  email: string;
  accessToken: string;
  headers: { Authorization: string };
}

interface ConversationBody {
  id: string;
}

interface TranscriptBody {
  items: ChatMessageCreated['message'][];
}

/**
 * Чат, фаза CHAT-0.2a: що саме сокет повідомляє і кому (docs/chat.md §4.8).
 *
 * Кожен тест тримає одне з обіцяних правил: подія доїжджає до УСІХ активних учасників
 * (автора включно — його інші вкладки), не доїжджає ні до не-учасника того ж тенанта, ні
 * до іншого тенанта, несе той самий рядок, що й REST, і летить лише після успішного
 * збереження. Сокети підключаються ПІСЛЯ підготовки сцени, щоб події підготовки не
 * потрапляли в перевірки.
 */
describe('Chat realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Саме listen, а не init: без слухаючого сокета Engine.IO нікуди підключатись
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);

    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'Chat RT Tenant B' },
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
    // Дати серверу дообробити disconnect перед наступним тестом
    await sleep(150);
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  const login = async (prefix: string, role: 'ADMIN' | 'USER' = 'USER'): Promise<Participant> => {
    const email = uniqueEmail(prefix);
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: prefix,
      role,
    });
    return {
      id: user.id,
      email,
      accessToken: tokens.accessToken,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    };
  };

  /** Юзер tenant-а B; логін — через slug, як у справжнього клієнта */
  const loginInTenantB = async (): Promise<Participant> => {
    const email = uniqueEmail('chat-rt-b');
    const user = await prisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email,
        name: 'Chat RT B',
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

  /** Підключення справжнім клієнтом; resolve — тільки після успішного handshake */
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

  const recordMessages = (socket: ClientSocket): ChatMessageCreated[] => {
    const seen: ChatMessageCreated[] = [];
    socket.on(REALTIME_EVENTS.chatMessageCreated, (payload: ChatMessageCreated) => {
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

  /**
   * Рівно `count` подій: чекаємо, доки набереться, а потім даємо вікно на зайві.
   * Просте «sleep, потім перевір» не відрізняло б «не прийшло» від «ще не дійшло».
   */
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
    participantUserIds: string[],
  ): Promise<string> => {
    const response = await http()
      .post('/api/conversations')
      .set(creator.headers)
      .send({ participantUserIds })
      .expect(201);
    return (response.body as ConversationBody).id;
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

  const transcript = async (
    reader: Participant,
    conversationId: string,
  ): Promise<TranscriptBody['items']> => {
    const response = await http()
      .get(`/api/conversations/${conversationId}/messages`)
      .set(reader.headers)
      .expect(200);
    return (response.body as TranscriptBody).items;
  };

  describe('chat.message-created.v1', () => {
    it('reaches every participant including the author’s other tab, and nobody else', async () => {
      const alice = await login('chat-rt-alice');
      const bob = await login('chat-rt-bob');
      const carol = await login('chat-rt-carol'); // same tenant, not a participant
      const dave = await loginInTenantB();
      const conversationId = await createConversation(alice, [bob.id]);

      const aliceOtherTab = await connect(alice.accessToken);
      const bobSocket = await connect(bob.accessToken);
      const carolSocket = await connect(carol.accessToken);
      const daveSocket = await connect(dave.accessToken);
      const aliceSeen = recordMessages(aliceOtherTab);
      const bobSeen = recordMessages(bobSocket);
      const carolSeen = recordMessages(carolSocket);
      const daveSeen = recordMessages(daveSocket);

      const clientMessageId = randomUUID();
      const response = await post(alice, conversationId, 'hello Bob', clientMessageId).expect(201);

      await settle(bobSeen, 1);
      await settle(aliceSeen, 1);
      // Не-учасник того ж тенанта і юзер чужого тенанта не отримують нічого
      await settle(carolSeen, 0);
      await settle(daveSeen, 0);

      const [stored] = await transcript(alice, conversationId);
      for (const event of [bobSeen[0], aliceSeen[0]]) {
        expect(event?.conversationId).toBe(conversationId);
        // Той самий рядок, що віддає REST: форми не можуть розійтися
        expect(event?.message).toEqual(stored);
        expect(event?.message.seq).toBe((response.body as { seq: number }).seq);
        expect(event?.message.clientMessageId).toBe(clientMessageId);
      }
    });

    it('delivers concurrent posts as two events with consecutive seq and no duplicates', async () => {
      const alice = await login('chat-rt-alice');
      const bob = await login('chat-rt-bob');
      const conversationId = await createConversation(alice, [bob.id]);
      const bobSeen = recordMessages(await connect(bob.accessToken));

      await Promise.all([
        post(alice, conversationId, 'first racer').expect(201),
        post(bob, conversationId, 'second racer').expect(201),
      ]);

      await settle(bobSeen, 2);
      const seqs = bobSeen.map((event) => event.message.seq).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(2);
      expect(seqs[1]).toBe((seqs[0] ?? 0) + 1);
    });

    it('stays silent for a replayed send and for a rejected one', async () => {
      const alice = await login('chat-rt-alice');
      const bob = await login('chat-rt-bob');
      const conversationId = await createConversation(alice, [bob.id]);
      const bobSeen = recordMessages(await connect(bob.accessToken));

      const clientMessageId = randomUUID();
      const first = await post(alice, conversationId, 'once', clientMessageId).expect(201);
      await settle(bobSeen, 1);

      // Повтор з тим самим clientMessageId повертає збережений рядок і нічого не шле
      const replay = await post(alice, conversationId, 'once', clientMessageId).expect(201);
      expect((replay.body as { id: string }).id).toBe((first.body as { id: string }).id);
      // Відхилена відправка (порожнє тіло) нічого не зберігає і нічого не шле
      await post(alice, conversationId, '   ').expect(400);

      await settle(bobSeen, 1);
    });
  });

  describe('chat.conversation-changed.v1', () => {
    it('announces a created conversation to its members only', async () => {
      const alice = await login('chat-rt-alice');
      const bob = await login('chat-rt-bob');
      const carol = await login('chat-rt-carol');
      const aliceSeen = recordChanges(await connect(alice.accessToken));
      const bobSeen = recordChanges(await connect(bob.accessToken));
      const carolSeen = recordChanges(await connect(carol.accessToken));

      const conversationId = await createConversation(alice, [bob.id]);

      await settle(bobSeen, 1);
      await settle(aliceSeen, 1);
      await settle(carolSeen, 0);
      expect(bobSeen[0]).toMatchObject({ conversationId, change: 'created' });
      expect(aliceSeen[0]).toMatchObject({ conversationId, change: 'created' });
    });

    it('tells only the reader, on every tab, when the read cursor really moves', async () => {
      const alice = await login('chat-rt-alice');
      const bob = await login('chat-rt-bob');
      const conversationId = await createConversation(alice, [bob.id]);
      await post(alice, conversationId, 'one').expect(201);
      const last = await post(alice, conversationId, 'two').expect(201);
      const lastSeq = (last.body as { seq: number }).seq;

      const aliceSeen = recordChanges(await connect(alice.accessToken));
      const bobTab1 = recordChanges(await connect(bob.accessToken));
      const bobTab2 = recordChanges(await connect(bob.accessToken));

      const markRead = (seq: number) =>
        http().post(`/api/conversations/${conversationId}/read`).set(bob.headers).send({ seq });
      await markRead(lastSeq).expect(204);

      await settle(bobTab1, 1);
      await settle(bobTab2, 1);
      expect(bobTab1[0]).toMatchObject({ conversationId, change: 'read' });
      // Чужі позиції прочитаного нікому не шлемо
      await settle(aliceSeen, 0);

      // Повтор тієї ж позиції курсор уже не зрушує — і тиші не порушує
      await markRead(lastSeq).expect(204);
      await settle(bobTab1, 1);
    });

    it('announces a new default-channel member to the existing members, atomically with the user', async () => {
      const admin = await login('chat-rt-admin', 'ADMIN');
      const bob = await login('chat-rt-bob');
      const outsider = await login('chat-rt-outsider'); // not in General
      for (const member of [admin, bob]) {
        await prisma.$transaction((tx) =>
          joinDefaultChannel(tx, DEFAULT_TENANT_ID, {
            id: member.id,
            name: null,
            email: member.email,
          }),
        );
      }
      const channel = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: DEFAULT_TENANT_ID, isDefault: true },
        select: { id: true },
      });

      const bobMessages = recordMessages(await connect(bob.accessToken));
      const bobChanges = recordChanges(await connect(bob.accessToken));
      const outsiderMessages = recordMessages(await connect(outsider.accessToken));

      // Відкочена транзакція юзера не лишає за собою жодної події: дубль email → 409
      const email = uniqueEmail('chat-rt-joiner');
      const payload = { email, password: 'SecurePass123', name: 'Joiner', role: 'USER' };
      await http().post('/api/users').set(admin.headers).send(payload).expect(201);
      await http().post('/api/users').set(admin.headers).send(payload).expect(409);

      await settle(bobMessages, 1);
      await settle(bobChanges, 1);
      expect(bobMessages[0]?.conversationId).toBe(channel.id);
      expect(bobMessages[0]?.message).toMatchObject({
        kind: 'SYSTEM',
        payload: { type: 'member.added' },
      });
      expect(bobChanges[0]).toMatchObject({ conversationId: channel.id, change: 'membership' });
      await settle(outsiderMessages, 0);
    });
  });
});
