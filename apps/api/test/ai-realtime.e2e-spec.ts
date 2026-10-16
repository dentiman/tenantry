/// <reference types="jest" />

// `ai.conversation-changed.v1` (AI-0.1, design.md D7, фікс §6.3): справжній
// socket, а не мок — предмет тут саме доставка в ОСОБИСТИЙ room юзера і її межі
// («інша вкладка того самого юзера» проти «інший юзер того самого тенанта»),
// того самого штибу, що вже перевіряють сповіщення й календар у realtime.e2e-spec.ts.

import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type { AiConversationChanged } from '@saas-skeleton/contracts';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser } from './test-users';

interface AskBody {
  reply: { id: string };
}

describe('AI assistant realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    // AiConfig будується фабрикою при створенні застосунку — тому env
    // виставляється ДО compile(), а не в jest-конфізі на весь прогін
    process.env.AI_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Саме listen, а не init: без слухаючого сокета Engine.IO нікуди підключатись
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.disconnect();
    }
    // Дати серверу дообробити disconnect перед наступним тестом
    await sleep(150);
    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
    delete process.env.AI_ENABLED;
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  const waitForConversationChanged = (socket: ClientSocket): Promise<AiConversationChanged> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('ai.conversation-changed.v1 not received'));
      }, 3_000);
      socket.once(REALTIME_EVENTS.aiConversationChanged, (payload: AiConversationChanged) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const ask = (token: string, text: string) =>
    request(app.getHttpServer())
      .post('/api/ai/conversation/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ text });

  it('ask(): reason=turn-created доїжджає власнику й не доїжджає до іншого юзера тенанта', async () => {
    const owner = await createAndLoginTestUser(app, prisma, {
      email: uniqueEmail('ai-rt-owner'),
      password: 'Password123',
    });
    const other = await createAndLoginTestUser(app, prisma, {
      email: uniqueEmail('ai-rt-other'),
      password: 'Password123',
    });

    const ownerSocket = await connect(owner.tokens.accessToken);
    const otherSocket = await connect(other.tokens.accessToken);
    const otherSeen: AiConversationChanged[] = [];
    otherSocket.on(REALTIME_EVENTS.aiConversationChanged, (payload: AiConversationChanged) => {
      otherSeen.push(payload);
    });

    const received = waitForConversationChanged(ownerSocket);
    await ask(owner.tokens.accessToken, 'How do I rename the workspace?').expect(202);

    const payload = await received;
    expect(payload.reason).toBe('turn-created');
    expect(payload.conversationId).toBeTruthy();

    // Дати можливому (хибному) чужому доставленню статися, перш ніж стверджувати відсутність
    await sleep(200);
    expect(otherSeen).toHaveLength(0);
  });

  it("reset(): доїжджає з reason=reset", async () => {
    const owner = await createAndLoginTestUser(app, prisma, {
      email: uniqueEmail('ai-rt-reset'),
      password: 'Password123',
    });
    await ask(owner.tokens.accessToken, 'first question').expect(202);

    const ownerSocket = await connect(owner.tokens.accessToken);
    const received = waitForConversationChanged(ownerSocket);

    await request(app.getHttpServer())
      .post('/api/ai/conversation/reset')
      .set('Authorization', `Bearer ${owner.tokens.accessToken}`)
      .expect(200);

    const payload = await received;
    expect(payload.reason).toBe('reset');
  });

  it('cancel() на PENDING: доїжджає з reason=reply-closed', async () => {
    const owner = await createAndLoginTestUser(app, prisma, {
      email: uniqueEmail('ai-rt-cancel'),
      password: 'Password123',
    });
    const asked = await ask(owner.tokens.accessToken, 'long question').expect(202);
    const replyId = (asked.body as AskBody).reply.id;

    const ownerSocket = await connect(owner.tokens.accessToken);
    const received = waitForConversationChanged(ownerSocket);

    await request(app.getHttpServer())
      .post(`/api/ai/conversation/messages/${replyId}/cancel`)
      .set('Authorization', `Bearer ${owner.tokens.accessToken}`)
      .expect(204);

    const payload = await received;
    expect(payload.reason).toBe('reply-closed');
  });

  it('покинута відповідь, виявлена при читанні розмови: доїжджає з reason=reply-closed', async () => {
    const owner = await createAndLoginTestUser(app, prisma, {
      email: uniqueEmail('ai-rt-abandoned'),
      password: 'Password123',
    });
    const asked = await ask(owner.tokens.accessToken, 'question').expect(202);
    const replyId = (asked.body as AskBody).reply.id;
    // Покинута: PENDING з простроченою орендою — жоден воркер її так і не забрав
    await prisma.aiMessage.update({
      where: { id: replyId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const ownerSocket = await connect(owner.tokens.accessToken);
    const received = waitForConversationChanged(ownerSocket);

    await request(app.getHttpServer())
      .get('/api/ai/conversation')
      .set('Authorization', `Bearer ${owner.tokens.accessToken}`)
      .expect(200);

    const payload = await received;
    expect(payload.reason).toBe('reply-closed');
  });
});
