/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_EVENTS, type ChatInboxChanged } from '@saas-skeleton/contracts';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { NotificationDispatcherRegistry } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { WorkerRealtimeEmitter } from '../../worker/src/realtime/worker-realtime.emitter';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-2a, сигнал скриньці клієнтських розмов (chat/customer-inbox: «An open inbox learns that a
// customer wrote»). Сигнал народжується у воркері, а сокети — в API, тож тест з'єднує їх так само,
// як прод: справжній headless-емітер воркера на тому самому Valkey-адаптері.

const TENANT_B_ID = '00000000-0000-4000-8000-000000000044';
const TENANT_B_SLUG = 'chat-inbox-signal-b';

describe('Chat inbox signal (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let baseUrl: string;
  let emitter: WorkerRealtimeEmitter;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'Inbox signal tenant B' },
    });

    emitter = new WorkerRealtimeEmitter(new NotificationDispatcherRegistry());
    emitter.onModuleInit();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await emitter.onApplicationShutdown();
    await prisma.authSession.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.user.deleteMany({ where: { tenantId: TENANT_B_ID } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = ioClient(`${baseUrl}/tenant`, {
        path: '/socket.io',
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
      });
      sockets.push(socket);
      socket.on('connect', () => {
        resolve(socket);
      });
      socket.on('connect_error', (error: Error) => {
        reject(error);
      });
    });

  const record = (socket: ClientSocket): ChatInboxChanged[] => {
    const seen: ChatInboxChanged[] = [];
    socket.on(REALTIME_EVENTS.chatInboxChanged, (payload: ChatInboxChanged) => {
      seen.push(payload);
    });
    return seen;
  };

  it('сигнал із воркера доїжджає до сокетів свого тенанта й не доїжджає до іншого', async () => {
    const email = `inbox-signal-${String(Date.now())}@example.com`;
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: 'Inbox A',
      role: 'USER',
    });

    const emailB = `inbox-signal-b-${String(Date.now())}@example.com`;
    await prisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: emailB,
        name: 'Inbox B',
        role: 'USER',
        passwordHash: await argon2.hash('SecurePass123'),
      },
    });
    const loginB = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/auth/login')
      .send({ email: emailB, password: 'SecurePass123', tenant: TENANT_B_SLUG })
      .expect(200);
    const tokenB = (loginB.body as { tokens: { accessToken: string } }).tokens.accessToken;

    const socketA1 = await connect(tokens.accessToken);
    const socketA2 = await connect(tokens.accessToken); // друга вкладка того ж користувача
    const socketB = await connect(tokenB);
    const seenA1 = record(socketA1);
    const seenA2 = record(socketA2);
    const seenB = record(socketB);

    const conversationId = randomUUID();
    emitter.toTenant(DEFAULT_TENANT_ID, REALTIME_EVENTS.chatInboxChanged, {
      conversationId,
      occurredAt: new Date().toISOString(),
    });

    const deadline = Date.now() + 3_000;
    while ((seenA1.length < 1 || seenA2.length < 1) && Date.now() < deadline) await sleep(25);
    await sleep(250);

    expect(seenA1).toHaveLength(1);
    expect(seenA2).toHaveLength(1);
    expect(seenA1[0]?.conversationId).toBe(conversationId);
    expect(Object.keys(seenA1[0] ?? {}).sort()).toEqual(['conversationId', 'occurredAt']);
    expect(seenB).toHaveLength(0);
  });
});
