/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

interface MessageBody {
  id: string;
  seq: number;
  kind: 'TEXT' | 'SYSTEM';
  status: string;
  senderType: 'user' | 'system';
  senderId: string | null;
  senderLabel: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  clientMessageId: string | null;
}

interface ConversationBody {
  id: string;
  title: string | null;
  isDefault: boolean;
  participants: { id: string; email: string; name: string | null }[];
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  lastReadSeq: number;
}

interface ListBody<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Чат, фаза CHAT-0.1. Realtime тут немає за побудовою, тож сьют покриває рівно
 * те, що фаза обіцяє: межу доступу, серверний порядок, ідемпотентність
 * надсилання, стан прочитаного і курсорні сторінки.
 *
 * Юзери створюються напряму через SystemPrismaService (`createTestUser`), тобто
 * ПОЗА `UsersService` — і тому не потрапляють у дефолтний канал. Для чату це
 * зручно (у списку видно рівно те, що створив тест), а сам шлях «юзер через API
 * вступає в дефолтний канал» перевіряється окремим тестом нижче.
 */
describe('Chat API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    // Дефолтний канал НЕ чіпаємо: він інваріант тенанта (його створює міграція
    // або сід), а не дані тесту
    await prisma.conversation.deleteMany({ where: { isDefault: false } });
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<{ id: string; email: string; headers: { Authorization: string } }> => {
    const email = `chat-${role.toLowerCase()}-${suffix}@example.com`;
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: `Chat ${suffix}`,
      role,
    });
    return { id: user.id, email, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const createConversation = async (
    headers: { Authorization: string },
    participantUserIds: string[],
    title?: string,
  ): Promise<ConversationBody> => {
    const response = await http()
      .post('/api/conversations')
      .set(headers)
      .send({ participantUserIds, ...(title !== undefined && { title }) })
      .expect(201);
    return response.body as ConversationBody;
  };

  const post = (headers: { Authorization: string }, id: string, body: string, clientMessageId = randomUUID()) =>
    http().post(`/api/conversations/${id}/messages`).set(headers).send({ body, clientMessageId });

  const transcript = async (
    headers: { Authorization: string },
    id: string,
    query = '',
  ): Promise<ListBody<MessageBody>> => {
    const response = await http()
      .get(`/api/conversations/${id}/messages${query}`)
      .set(headers)
      .expect(200);
    return response.body as ListBody<MessageBody>;
  };

  const list = async (
    headers: { Authorization: string },
    query = '',
  ): Promise<ListBody<ConversationBody>> => {
    const response = await http().get(`/api/conversations${query}`).set(headers).expect(200);
    return response.body as ListBody<ConversationBody>;
  };

  describe('creating a conversation', () => {
    it('includes the creator and opens with a non-empty transcript', async () => {
      const alice = await login(`${Date.now()}-a`);
      const bob = await login(`${Date.now()}-b`);

      const conversation = await createConversation(alice.headers, [bob.id], 'Release 1.0');

      expect(conversation.title).toBe('Release 1.0');
      expect(conversation.participants.map((p) => p.id).sort()).toEqual([alice.id, bob.id].sort());

      // Стрічка непорожня: «створено» + по запису на кожного учасника
      const { items } = await transcript(alice.headers, conversation.id);
      const types = items.map((m) => m.payload.type);
      expect(items.every((m) => m.kind === 'SYSTEM')).toBe(true);
      expect(types).toContain('conversation.created');
      expect(types.filter((t) => t === 'member.added')).toHaveLength(2);
      // Тексту системний запис не зберігає — тільки type + params
      expect(items.every((m) => m.body === null)).toBe(true);
    });

    it('creates a two-participant conversation as an ordinary conversation', async () => {
      const alice = await login(`${Date.now()}-solo-a`);
      const bob = await login(`${Date.now()}-solo-b`);

      const conversation = await createConversation(alice.headers, [bob.id]);

      expect(conversation.title).toBeNull();
      expect(conversation.participants).toHaveLength(2);
      expect(conversation.isDefault).toBe(false);
    });

    it('rejects an unknown participant with a field error and creates nothing', async () => {
      const alice = await login(`${Date.now()}-unknown`);

      const response = await http()
        .post('/api/conversations')
        .set(alice.headers)
        .send({ participantUserIds: [randomUUID()] })
        .expect(400);

      expect((response.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe(
        'participantUserIds',
      );
      const { items } = await list(alice.headers);
      expect(items).toHaveLength(0);
    });

    it('never produces a tenant-wide conversation', async () => {
      const alice = await login(`${Date.now()}-access`);
      const bob = await login(`${Date.now()}-access-b`);

      const conversation = await createConversation(alice.headers, [bob.id]);
      const row = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { access: true },
      });
      expect(row.access).toBe('private');
    });
  });

  describe('access', () => {
    it('answers 404 to a non-participant — including an administrator', async () => {
      const alice = await login(`${Date.now()}-priv-a`);
      const bob = await login(`${Date.now()}-priv-b`);
      const admin = await login(`${Date.now()}-priv-admin`, 'ADMIN');

      const conversation = await createConversation(alice.headers, [bob.id]);

      for (const outsider of [admin.headers]) {
        await http().get(`/api/conversations/${conversation.id}`).set(outsider).expect(404);
        await http().get(`/api/conversations/${conversation.id}/messages`).set(outsider).expect(404);
        await post(outsider, conversation.id, 'let me in').expect(404);
        await http()
          .post(`/api/conversations/${conversation.id}/read`)
          .set(outsider)
          .send({ seq: 1 })
          .expect(404);
      }

      // І в списку її теж немає
      const { items } = await list(admin.headers);
      expect(items.map((c) => c.id)).not.toContain(conversation.id);
    });

    it('answers 404 for a conversation that does not exist', async () => {
      const alice = await login(`${Date.now()}-missing`);
      await http().get(`/api/conversations/${randomUUID()}`).set(alice.headers).expect(404);
    });

    it('drops a departed participant from the card while keeping their messages', async () => {
      const alice = await login(`${Date.now()}-left-a`);
      const bob = await login(`${Date.now()}-left-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);
      await post(bob.headers, conversation.id, 'written before leaving').expect(201);

      // Виходу з розмови в цій фазі ще немає (керування учасниками — 0.3),
      // тому стан «вийшов» ставимо напряму: перевіряємо ЧИТАННЯ такого стану
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: conversation.id, userId: bob.id } },
        data: { leftAt: new Date() },
      });

      const card = await http()
        .get(`/api/conversations/${conversation.id}`)
        .set(alice.headers)
        .expect(200);
      const body = card.body as ConversationBody;
      expect(body.participants.map((p) => p.id)).toEqual([alice.id]);

      // Репліка лишилась у стрічці, з підписом
      const { items } = await transcript(alice.headers, conversation.id);
      const written = items.find((m) => m.body === 'written before leaving');
      expect(written?.senderLabel).toBeTruthy();

      // А сам він доступ втратив
      await http().get(`/api/conversations/${conversation.id}`).set(bob.headers).expect(404);
    });
  });

  describe('ordering', () => {
    it('assigns increasing sequence numbers to sequential posts', async () => {
      const alice = await login(`${Date.now()}-seq-a`);
      const bob = await login(`${Date.now()}-seq-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      const first = await post(alice.headers, conversation.id, 'one').expect(201);
      const second = await post(alice.headers, conversation.id, 'two').expect(201);

      // 1 — conversation.created, 2..3 — member.added ×2, далі репліки
      expect((first.body as MessageBody).seq).toBe(4);
      expect((second.body as MessageBody).seq).toBe(5);
    });

    it('gives concurrent posts distinct sequence numbers and loses neither', async () => {
      const alice = await login(`${Date.now()}-race-a`);
      const bob = await login(`${Date.now()}-race-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      const [one, two] = await Promise.all([
        post(alice.headers, conversation.id, 'from alice'),
        post(bob.headers, conversation.id, 'from bob'),
      ]);

      expect(one.status).toBe(201);
      expect(two.status).toBe(201);
      const seqs = [(one.body as MessageBody).seq, (two.body as MessageBody).seq];
      expect(new Set(seqs).size).toBe(2);

      const { items } = await transcript(alice.headers, conversation.id);
      expect(items.filter((m) => m.kind === 'TEXT')).toHaveLength(2);
    });

    it('numbers each conversation independently', async () => {
      const alice = await login(`${Date.now()}-indep-a`);
      const bob = await login(`${Date.now()}-indep-b`);
      const first = await createConversation(alice.headers, [bob.id]);
      const second = await createConversation(alice.headers, [bob.id]);

      const a = await post(alice.headers, first.id, 'x').expect(201);
      const b = await post(alice.headers, second.id, 'y').expect(201);

      expect((a.body as MessageBody).seq).toBe((b.body as MessageBody).seq);
    });
  });

  describe('posting', () => {
    it('stores the sender snapshot and keeps the transcript readable', async () => {
      const alice = await login(`${Date.now()}-snap-a`);
      const bob = await login(`${Date.now()}-snap-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      const response = await post(alice.headers, conversation.id, 'hello there').expect(201);
      const message = response.body as MessageBody;

      expect(message.senderType).toBe('user');
      expect(message.senderId).toBe(alice.id);
      expect(message.senderLabel).toBeTruthy();
      expect(message.status).toBe('SENT');
    });

    it('rejects an empty body', async () => {
      const alice = await login(`${Date.now()}-empty-a`);
      const bob = await login(`${Date.now()}-empty-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      await post(alice.headers, conversation.id, '   ').expect(400);

      const { items } = await transcript(alice.headers, conversation.id);
      expect(items.filter((m) => m.kind === 'TEXT')).toHaveLength(0);
    });

    it('updates the conversation preview and ordering', async () => {
      const alice = await login(`${Date.now()}-prev-a`);
      const bob = await login(`${Date.now()}-prev-b`);
      const older = await createConversation(alice.headers, [bob.id], 'Older');
      const newer = await createConversation(alice.headers, [bob.id], 'Newer');

      // Прев'ю зʼявляється лише з першою ТЕКСТОВОЮ реплікою: системний запис
      // тексту не має, тому до неї воно null
      expect(newer.lastMessagePreview).toBeNull();

      await post(alice.headers, older.id, 'bumping the older one').expect(201);

      const { items } = await list(alice.headers);
      expect(items[0]?.id).toBe(older.id);
      expect(items[0]?.lastMessagePreview).toBe('bumping the older one');
    });
  });

  describe('idempotency', () => {
    it('returns the same message for a repeated client message id', async () => {
      const alice = await login(`${Date.now()}-idem-a`);
      const bob = await login(`${Date.now()}-idem-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);
      const clientMessageId = randomUUID();

      const first = await post(alice.headers, conversation.id, 'only once', clientMessageId).expect(201);
      const second = await post(alice.headers, conversation.id, 'only once', clientMessageId).expect(201);

      expect((second.body as MessageBody).id).toBe((first.body as MessageBody).id);
      expect((second.body as MessageBody).seq).toBe((first.body as MessageBody).seq);

      const { items } = await transcript(alice.headers, conversation.id);
      expect(items.filter((m) => m.kind === 'TEXT')).toHaveLength(1);
    });

    it('keeps two deliberate sends with different ids', async () => {
      const alice = await login(`${Date.now()}-twice-a`);
      const bob = await login(`${Date.now()}-twice-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      await post(alice.headers, conversation.id, 'same text').expect(201);
      await post(alice.headers, conversation.id, 'same text').expect(201);

      const { items } = await transcript(alice.headers, conversation.id);
      expect(items.filter((m) => m.kind === 'TEXT')).toHaveLength(2);
    });
  });

  describe('read state', () => {
    it('counts only other peopleʼs replies and clears on read', async () => {
      const alice = await login(`${Date.now()}-read-a`);
      const bob = await login(`${Date.now()}-read-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      for (const text of ['one', 'two', 'three']) {
        await post(alice.headers, conversation.id, text).expect(201);
      }

      const authorView = await list(alice.headers);
      const readerView = await list(bob.headers);
      expect(authorView.items[0]?.unreadCount).toBe(0);
      expect(readerView.items[0]?.unreadCount).toBe(3);

      const last = readerView.items[0];
      await http()
        .post(`/api/conversations/${conversation.id}/read`)
        .set(bob.headers)
        .send({ seq: (await transcript(bob.headers, conversation.id)).items[0]?.seq })
        .expect(204);

      const afterRead = await list(bob.headers);
      expect(afterRead.items[0]?.unreadCount).toBe(0);
      expect(afterRead.items[0]?.lastReadSeq).toBeGreaterThan(last?.lastReadSeq ?? 0);
    });

    it('treats a stale cursor as a no-op', async () => {
      const alice = await login(`${Date.now()}-stale-a`);
      const bob = await login(`${Date.now()}-stale-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);
      await post(alice.headers, conversation.id, 'hello').expect(201);

      const newest = (await transcript(bob.headers, conversation.id)).items[0];
      await http()
        .post(`/api/conversations/${conversation.id}/read`)
        .set(bob.headers)
        .send({ seq: newest?.seq })
        .expect(204);
      // Назад — приймається, але курсор не рухається
      await http()
        .post(`/api/conversations/${conversation.id}/read`)
        .set(bob.headers)
        .send({ seq: 1 })
        .expect(204);

      const { items } = await list(bob.headers);
      expect(items[0]?.lastReadSeq).toBe(newest?.seq);
      expect(items[0]?.unreadCount).toBe(0);
    });

    it('does not raise the badge for membership events', async () => {
      const alice = await login(`${Date.now()}-sys-a`);
      const bob = await login(`${Date.now()}-sys-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      // У стрічці вже три системні записи і жодної репліки
      const { items } = await list(bob.headers);
      expect(items[0]?.id).toBe(conversation.id);
      expect(items[0]?.unreadCount).toBe(0);
    });
  });

  describe('paging', () => {
    it('returns pages with no repeats, no gaps and a terminated cursor', async () => {
      const alice = await login(`${Date.now()}-page-a`);
      const bob = await login(`${Date.now()}-page-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      for (let i = 0; i < 7; i += 1) {
        await post(alice.headers, conversation.id, `message ${String(i)}`).expect(201);
      }

      const first = await transcript(alice.headers, conversation.id, '?limit=4');
      expect(first.items).toHaveLength(4);
      expect(first.nextCursor).toBeTruthy();

      // Вставка МІЖ сторінками не має зсунути вже віддане
      await post(alice.headers, conversation.id, 'arrived mid-paging').expect(201);

      const second = await transcript(
        alice.headers,
        conversation.id,
        `?limit=4&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      const seen = [...first.items, ...second.items].map((m) => m.seq);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort((a, b) => b - a)).toEqual(seen);

      // Догортаємо до початку — курсор порожніє
      let cursor = second.nextCursor;
      let guard = 0;
      while (cursor && guard < 10) {
        const page: ListBody<MessageBody> = await transcript(
          alice.headers,
          conversation.id,
          `?limit=4&cursor=${encodeURIComponent(cursor)}`,
        );
        cursor = page.nextCursor;
        guard += 1;
      }
      expect(cursor).toBeNull();
    });

    it('pages the conversation list without repeats or gaps', async () => {
      const alice = await login(`${Date.now()}-clist-a`);
      const bob = await login(`${Date.now()}-clist-b`);

      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const conversation = await createConversation(alice.headers, [bob.id], `Room ${String(i)}`);
        created.push(conversation.id);
      }

      const first = await list(alice.headers, '?limit=3');
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).toBeTruthy();

      const second = await list(
        alice.headers,
        `?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      const seen = [...first.items, ...second.items].map((c) => c.id);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual([...created].sort());
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor', async () => {
      const alice = await login(`${Date.now()}-badcursor-a`);
      const bob = await login(`${Date.now()}-badcursor-b`);
      const conversation = await createConversation(alice.headers, [bob.id]);

      await http()
        .get(`/api/conversations/${conversation.id}/messages?cursor=not-a-cursor`)
        .set(alice.headers)
        .expect(400);
    });
  });

  describe('default channel', () => {
    it('exists for the tenant', async () => {
      const channels = await prisma.conversation.findMany({
        where: { tenantId: DEFAULT_TENANT_ID, isDefault: true },
      });
      expect(channels).toHaveLength(1);
    });

    it('takes in a user created through the API, with full history and no unread', async () => {
      const admin = await login(`${Date.now()}-provision`, 'ADMIN');

      const created = await http()
        .post('/api/users')
        .set(admin.headers)
        .send({
          email: `chat-joiner-${String(Date.now())}@example.com`,
          password: 'SecurePass123',
          name: 'Joiner',
          role: 'USER',
        })
        .expect(201);

      const joinerId = (created.body as { id: string }).id;
      const channel = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: DEFAULT_TENANT_ID, isDefault: true },
        select: { id: true, lastSeq: true },
      });
      const membership = await prisma.conversationParticipant.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId: channel.id, userId: joinerId } },
      });

      // Приєднання не створює непрочитаних, а історія лишається видимою
      expect(membership.unreadCount).toBe(0);
      expect(membership.lastReadSeq).toBe(channel.lastSeq);
      expect(membership.joinSeq).toBe(channel.lastSeq);

      // І сам вступ лишив слід у стрічці
      const entry = await prisma.chatMessage.findFirstOrThrow({
        where: { conversationId: channel.id, seq: channel.lastSeq },
      });
      expect((entry.payload as { type: string }).type).toBe('member.added');
    });
  });
});
