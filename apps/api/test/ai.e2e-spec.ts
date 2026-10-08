/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';
import { startOfUtcDay } from '@saas-skeleton/shared';
import { AI_QUOTA_EXCEEDED_CODE } from '@saas-skeleton/contracts';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';
import { sentJobs } from './__mocks__/pg-boss';

interface MessageBody {
  id: string;
  seq: number;
  role: 'USER' | 'ASSISTANT';
  status: string;
  content: string;
  errorCode: string | null;
}
interface ConversationBody {
  id: string;
  messages: MessageBody[];
}
interface AskBody {
  conversationId: string;
  question: MessageBody;
  reply: MessageBody;
}

/**
 * AI-асистент, HTTP-шар. Генерація тут НЕ відбувається: pg-boss замокано, тож
 * сьют перевіряє рівно свою відповідальність — контракт, межі доступу і те, що
 * команда пішла в чергу з правильним конвертом. Життєвий цикл генерації
 * перевіряє `apps/worker` (ai-generate-reply.subscriber.test.ts).
 */
describe('AI assistant API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    // AiConfig будується фабрикою при створенні застосунку — тому env
    // виставляється ДО compile(), а не в jest-конфізі на весь прогін
    process.env.AI_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
    await prisma.aiUsageCounter.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    sentJobs.reset();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AI_ENABLED;
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<{ Authorization: string }> => {
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `ai-${role.toLowerCase()}-${suffix}@example.com`,
      password: 'SecurePass123',
      role,
    });
    return { Authorization: `Bearer ${tokens.accessToken}` };
  };

  const ask = (headers: { Authorization: string }, text: string) =>
    request(app.getHttpServer()).post('/api/ai/conversation/messages').set(headers).send({ text });

  describe('conversation', () => {
    it('creates the conversation on demand and returns it empty', async () => {
      const headers = await login(`${Date.now()}-first`);

      const response = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(headers)
        .expect(200);

      const body = response.body as ConversationBody;
      expect(body.messages).toEqual([]);
      expect(body.id).toBeTruthy();
    });

    it('returns the SAME conversation on a second read, not a new one', async () => {
      const headers = await login(`${Date.now()}-same`);

      const first = await request(app.getHttpServer()).get('/api/ai/conversation').set(headers);
      const second = await request(app.getHttpServer()).get('/api/ai/conversation').set(headers);

      expect((second.body as ConversationBody).id).toBe((first.body as ConversationBody).id);
    });

    it('appends to the same conversation instead of starting a new one', async () => {
      const headers = await login(`${Date.now()}-append`);

      const first = await ask(headers, 'first question').expect(202);
      await prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });
      const second = await ask(headers, 'second question').expect(202);

      expect((second.body as AskBody).conversationId).toBe((first.body as AskBody).conversationId);
    });

    it('concurrent first use (GET/ask/reset at once) never 5xx and yields exactly one active conversation', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, prisma, {
        email: `ai-concurrent-first-${String(Date.now())}@example.com`,
        password: 'SecurePass123',
      });
      const headers = { Authorization: `Bearer ${tokens.accessToken}` };

      // Три різні шляхи, кожен з яких сам створює розмову на вимогу
      // (design.md D5): жоден не має впасти на конфлікті часткового індексу
      const [getResult, askResult, resetResult] = await Promise.all([
        request(app.getHttpServer()).get('/api/ai/conversation').set(headers),
        ask(headers, 'concurrent first question'),
        request(app.getHttpServer()).post('/api/ai/conversation/reset').set(headers),
      ]);

      for (const response of [getResult, askResult, resetResult]) {
        expect(response.status).toBeLessThan(500);
      }

      // Лише ОДНА активна розмова належить цьому юзеру, попри три конкурентні заявки
      const active = await prisma.aiConversation.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
      });
      expect(active).toHaveLength(1);
    });
  });

  describe('asking', () => {
    it('answers 202 with the question and a PENDING reply in seq order', async () => {
      const headers = await login(`${Date.now()}-ask`);

      const response = await ask(headers, 'How do I rename the workspace?').expect(202);
      const body = response.body as AskBody;

      expect(body.question).toMatchObject({ role: 'USER', status: 'COMPLETE', seq: 0 });
      expect(body.reply).toMatchObject({
        role: 'ASSISTANT',
        status: 'PENDING',
        seq: 1,
        content: '',
        errorCode: null,
      });
    });

    it('publishes ai.generate-reply with the tenant envelope and the tenant job group', async () => {
      const headers = await login(`${Date.now()}-publish`);

      const response = await ask(headers, 'anything').expect(202);
      const body = response.body as AskBody;

      const published = sentJobs.forQueue('ai.generate-reply/ai-generator');
      expect(published).toHaveLength(1);

      const envelope = published[0]?.envelope as {
        name: string;
        tenantId: string | null;
        actor: { type: string; id?: string };
        data: { conversationId: string; messageId: string };
      };
      expect(envelope.name).toBe('ai.generate-reply');
      expect(envelope.tenantId).toBeTruthy();
      expect(envelope.actor.type).toBe('user');
      expect(envelope.data).toEqual({
        conversationId: body.conversationId,
        messageId: body.reply.id,
      });

      // `group` — справедливість між тенантами: pg-boss не дасть одному тенанту
      // зайняти більше воркерів, ніж groupConcurrency у маніфесті
      expect(published[0]?.options.group).toEqual({ id: envelope.tenantId });
    });

    it('refuses a second question while a reply is still being generated', async () => {
      const headers = await login(`${Date.now()}-busy`);
      await ask(headers, 'first').expect(202);

      await ask(headers, 'second').expect(409);

      // Перша відповідь не постраждала, і другої роботи в черзі не зʼявилось
      expect(sentJobs.forQueue('ai.generate-reply/ai-generator')).toHaveLength(1);
    });

    it('two concurrent asks in the same conversation: exactly one 202, one 409, one new pair', async () => {
      const headers = await login(`${Date.now()}-concurrent-ask`);
      // Перше питання встановлює розмову й не залишає її «зайнятою»
      await ask(headers, 'seed question').expect(202);
      await prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });

      const [first, second] = await Promise.all([
        ask(headers, 'concurrent A'),
        ask(headers, 'concurrent B'),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([202, 409]);

      const conversationId = (
        (first.status === 202 ? first : second).body as AskBody
      ).conversationId;
      const pairs = await prisma.aiMessage.findMany({
        where: { conversationId, content: { in: ['concurrent A', 'concurrent B'] } },
      });
      // Рівно ОДНА з двох конкурентних пар потрапила в стрічку, без дубля `seq`
      expect(pairs).toHaveLength(1);
    });

    it('a reply with an expired lease is returned FAILED and a new ask is accepted', async () => {
      const headers = await login(`${Date.now()}-abandoned`);
      const asked = await ask(headers, 'stuck question').expect(202);
      const replyId = (asked.body as AskBody).reply.id;

      // Симулюємо покинуту відповідь: жоден воркер так і не забрав job
      await prisma.aiMessage.update({
        where: { id: replyId },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });

      const conversation = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(headers)
        .expect(200);
      const reply = (conversation.body as ConversationBody).messages.find((m) => m.id === replyId);
      expect(reply?.status).toBe('FAILED');
      expect(reply?.errorCode).toBe('INTERNAL');

      // Розмова більше не «зайнята» покинутою відповіддю
      await ask(headers, 'a follow-up question').expect(202);
    });

    it('rejects an over-long question without enqueuing anything', async () => {
      const headers = await login(`${Date.now()}-long`);

      const response = await ask(headers, 'x'.repeat(4001)).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect((response.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe(
        'text',
      );
      expect(sentJobs.all()).toHaveLength(0);
    });

    it('rejects an empty question', async () => {
      const headers = await login(`${Date.now()}-empty`);

      await ask(headers, '   ').expect(400);
      expect(sentJobs.all()).toHaveLength(0);
    });
  });

  // ai-1d: квоти токенів (design.md D3/D4). Генерація тут не відбувається (pg-boss
  // замокано), тож перевіряємо рівно рубіж checkQuota() — рахунок деталі АТОМАРНОГО
  // списання перевіряє окремий сьют, ai-usage-quota.e2e-spec.ts, справжнім Postgres.
  describe('usage quotas', () => {
    // Ті самі дефолти, що AiConfig підхоплює без AI_QUOTA_* в env (design.md D7)
    const USER_LIMIT = 1_000_000;
    const TENANT_LIMIT = 10_000_000;
    const periodStart = startOfUtcDay(new Date());

    it('rejects a question when the user has already reached their own quota', async () => {
      const headers = await login(`${Date.now()}-quota-user`);
      const conversation = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(headers)
        .expect(200);
      const userId = (
        await prisma.aiConversation.findFirstOrThrow({
          where: { id: (conversation.body as ConversationBody).id },
          select: { userId: true },
        })
      ).userId;
      await prisma.aiUsageCounter.create({
        data: { tenantId: DEFAULT_TENANT_ID, userId, periodStart, promptTokens: USER_LIMIT, completionTokens: 0 },
      });

      const response = await ask(headers, 'one more question').expect(400);

      expect(
        (response.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0],
      ).toMatchObject({ field: 'text', code: AI_QUOTA_EXCEEDED_CODE });
      // Ні питання, ні відповіді не зʼявилось, і job у черзі немає (проповідь до publish)
      expect(await prisma.aiMessage.count()).toBe(0);
      expect(sentJobs.all()).toHaveLength(0);
    });

    it('rejects a question when the tenant aggregate is at its quota, even under the user’s own limit', async () => {
      const headers = await login(`${Date.now()}-quota-tenant`);
      // Кілька ІНШИХ юзерів того самого тенанта, кожен під власним лімітом, що
      // разом перевищують тенантний — саме сценарій, який агрегат мусить зловити
      const others = await Promise.all(
        [0, 1, 2].map((i) =>
          createTestUser(prisma, { email: `quota-tenant-other-${String(i)}-${String(Date.now())}@example.com` }),
        ),
      );
      await prisma.aiUsageCounter.createMany({
        data: others.map((u) => ({
          tenantId: DEFAULT_TENANT_ID,
          userId: u.id,
          periodStart,
          promptTokens: Math.ceil(TENANT_LIMIT / others.length),
          completionTokens: 0,
        })),
      });

      const response = await ask(headers, 'one more question').expect(400);

      expect(
        (response.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0],
      ).toMatchObject({ field: 'text', code: AI_QUOTA_EXCEEDED_CODE });
      expect(await prisma.aiMessage.count()).toBe(0);
      expect(sentJobs.all()).toHaveLength(0);
    });

    it('accepts a question when both limits are under quota, behaving exactly as without quotas', async () => {
      const headers = await login(`${Date.now()}-quota-ok`);

      const response = await ask(headers, 'well under any quota').expect(202);

      const body = response.body as AskBody;
      expect(body.reply).toMatchObject({ role: 'ASSISTANT', status: 'PENDING' });
      expect(sentJobs.forQueue('ai.generate-reply/ai-generator')).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('retires the old conversation, keeps its messages, and starts an empty one', async () => {
      const headers = await login(`${Date.now()}-reset`);
      const asked = await ask(headers, 'old question').expect(202);
      const oldId = (asked.body as AskBody).conversationId;

      const response = await request(app.getHttpServer())
        .post('/api/ai/conversation/reset')
        .set(headers)
        .expect(200);

      const body = response.body as ConversationBody;
      expect(body.id).not.toBe(oldId);
      expect(body.messages).toEqual([]);

      // Стара розмова не видалена — скинуто КОНТЕКСТ, а не історію
      const retired = await prisma.aiConversation.findUnique({ where: { id: oldId } });
      expect(retired?.status).toBe('RETIRED');
      expect(await prisma.aiMessage.count({ where: { conversationId: oldId } })).toBe(2);
    });
  });

  describe('history (assistant page)', () => {
    interface SummaryBody {
      id: string;
      status: 'ACTIVE' | 'RETIRED';
      title: string;
    }
    interface ListBody {
      items: SummaryBody[];
      nextCursor: string | null;
    }

    /** Дві розмови з питаннями: стара RETIRED і нова ACTIVE; порядок у часі — явний */
    const twoConversations = async (
      headers: { Authorization: string },
    ): Promise<{ oldId: string; currentId: string }> => {
      const first = await ask(headers, '  How do   I add a customer?  ').expect(202);
      const oldId = (first.body as AskBody).conversationId;
      await prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });
      await request(app.getHttpServer()).post('/api/ai/conversation/reset').set(headers).expect(200);
      const second = await ask(headers, 'Where are the calendar settings?').expect(202);
      const currentId = (second.body as AskBody).conversationId;
      await prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });
      await prisma.aiConversation.update({
        where: { id: oldId },
        data: { lastMessageAt: new Date(Date.now() - 60_000) },
      });
      return { oldId, currentId };
    };

    it('lists only conversations with a question, newest first, titled by the first question', async () => {
      const headers = await login(`${Date.now()}-history`);
      const { oldId, currentId } = await twoConversations(headers);

      const response = await request(app.getHttpServer())
        .get('/api/ai/conversations')
        .set(headers)
        .expect(200);

      const body = response.body as ListBody;
      expect(body.items.map((item) => [item.id, item.status, item.title])).toEqual([
        [currentId, 'ACTIVE', 'Where are the calendar settings?'],
        [oldId, 'RETIRED', 'How do I add a customer?'],
      ]);
      expect(body.nextCursor).toBeNull();

      // Порожня ACTIVE після reset() в історію не потрапляє
      await request(app.getHttpServer()).post('/api/ai/conversation/reset').set(headers).expect(200);
      const afterReset = await request(app.getHttpServer())
        .get('/api/ai/conversations')
        .set(headers)
        .expect(200);
      expect((afterReset.body as ListBody).items.map((item) => item.id)).toEqual([
        currentId,
        oldId,
      ]);
    });

    it('pages with an opaque cursor and rejects a malformed one', async () => {
      const headers = await login(`${Date.now()}-history-cursor`);
      const { oldId, currentId } = await twoConversations(headers);

      const first = await request(app.getHttpServer())
        .get('/api/ai/conversations?limit=1')
        .set(headers)
        .expect(200);
      const firstBody = first.body as ListBody;
      expect(firstBody.items.map((item) => item.id)).toEqual([currentId]);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer())
        .get(`/api/ai/conversations?limit=1&cursor=${String(firstBody.nextCursor)}`)
        .set(headers)
        .expect(200);
      expect((second.body as ListBody).items.map((item) => item.id)).toEqual([oldId]);
      expect((second.body as ListBody).nextCursor).toBeNull();

      await request(app.getHttpServer())
        .get('/api/ai/conversations?cursor=garbage')
        .set(headers)
        .expect(400);
    });

    it('reads a RETIRED conversation by id, but never another user’s — not even for an ADMIN', async () => {
      const headers = await login(`${Date.now()}-history-read`);
      const admin = await login(`${Date.now()}-history-admin`, 'ADMIN');
      const { oldId } = await twoConversations(headers);

      const response = await request(app.getHttpServer())
        .get(`/api/ai/conversations/${oldId}`)
        .set(headers)
        .expect(200);
      const body = response.body as ConversationBody & { status: string };
      expect(body.status).toBe('RETIRED');
      expect(body.messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);

      await request(app.getHttpServer()).get(`/api/ai/conversations/${oldId}`).set(admin).expect(404);
      const adminList = await request(app.getHttpServer())
        .get('/api/ai/conversations')
        .set(admin)
        .expect(200);
      expect((adminList.body as ListBody).items).toEqual([]);
    });

    it('activate makes a past conversation the current one and retires the previous', async () => {
      const headers = await login(`${Date.now()}-history-activate`);
      const { oldId, currentId } = await twoConversations(headers);

      const response = await request(app.getHttpServer())
        .post(`/api/ai/conversations/${oldId}/activate`)
        .set(headers)
        .expect(200);
      expect((response.body as ConversationBody & { status: string }).status).toBe('ACTIVE');

      expect((await prisma.aiConversation.findUnique({ where: { id: currentId } }))?.status).toBe(
        'RETIRED',
      );
      const current = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(headers)
        .expect(200);
      expect((current.body as ConversationBody).id).toBe(oldId);

      // Наступне питання йде в активовану розмову
      const asked = await ask(headers, 'follow-up').expect(202);
      expect((asked.body as AskBody).conversationId).toBe(oldId);
      expect((asked.body as AskBody).question.seq).toBe(2);

      // Повторна активація вже активної — no-op
      await request(app.getHttpServer())
        .post(`/api/ai/conversations/${oldId}/activate`)
        .set(headers)
        .expect(200);
    });

    it('activate drops an empty current conversation instead of keeping it as RETIRED', async () => {
      const headers = await login(`${Date.now()}-history-empty`);
      const { oldId } = await twoConversations(headers);
      const reset = await request(app.getHttpServer())
        .post('/api/ai/conversation/reset')
        .set(headers)
        .expect(200);
      const emptyId = (reset.body as ConversationBody).id;

      await request(app.getHttpServer())
        .post(`/api/ai/conversations/${oldId}/activate`)
        .set(headers)
        .expect(200);

      expect(await prisma.aiConversation.findUnique({ where: { id: emptyId } })).toBeNull();
    });

    it('does not let another user activate someone else’s conversation', async () => {
      const owner = await login(`${Date.now()}-history-owner`);
      const other = await login(`${Date.now()}-history-other`, 'ADMIN');
      const { oldId } = await twoConversations(owner);
      await ask(other, 'my own question').expect(202);

      await request(app.getHttpServer())
        .post(`/api/ai/conversations/${oldId}/activate`)
        .set(other)
        .expect(404);
      expect((await prisma.aiConversation.findUnique({ where: { id: oldId } }))?.status).toBe(
        'RETIRED',
      );
    });

    it('two concurrent activations of different conversations never 5xx and leave exactly one active', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, prisma, {
        email: `ai-history-race-${String(Date.now())}@example.com`,
        password: 'SecurePass123',
      });
      const headers = { Authorization: `Bearer ${tokens.accessToken}` };
      const { oldId } = await twoConversations(headers);
      await request(app.getHttpServer()).post('/api/ai/conversation/reset').set(headers).expect(200);
      await ask(headers, 'third').expect(202);
      await prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });
      const retired = await prisma.aiConversation.findMany({
        where: { userId: user.id, status: 'RETIRED' },
        select: { id: true },
      });
      expect(retired.map((row) => row.id)).toContain(oldId);
      expect(retired).toHaveLength(2);

      const results = await Promise.all(
        retired.map(({ id }) =>
          request(app.getHttpServer()).post(`/api/ai/conversations/${id}/activate`).set(headers),
        ),
      );
      for (const result of results) {
        expect([200, 409]).toContain(result.status);
      }
      expect(
        await prisma.aiConversation.count({ where: { userId: user.id, status: 'ACTIVE' } }),
      ).toBe(1);
    });
  });

  describe('ownership', () => {
    it('gives each user their own conversation, never another user’s', async () => {
      const alice = await login(`${Date.now()}-alice`);
      const bob = await login(`${Date.now()}-bob`);

      await ask(alice, 'alice question').expect(202);
      const bobView = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(bob)
        .expect(200);

      expect((bobView.body as ConversationBody).messages).toEqual([]);
    });

    it('does not let an ADMIN of the same tenant cancel another user’s reply', async () => {
      const user = await login(`${Date.now()}-owner`);
      const admin = await login(`${Date.now()}-admin`, 'ADMIN');
      const asked = await ask(user, 'private question').expect(202);
      const replyId = (asked.body as AskBody).reply.id;

      // 404, а не 403: 403 підтвердив би, що така відповідь існує
      await request(app.getHttpServer())
        .post(`/api/ai/conversation/messages/${replyId}/cancel`)
        .set(admin)
        .expect(404);
    });

    it('answers 404 for a message id that does not exist', async () => {
      const headers = await login(`${Date.now()}-missing`);

      await request(app.getHttpServer())
        .post('/api/ai/conversation/messages/3f1b7c0e-9d4a-4b7e-8c21-5a6d2e4f9b10/cancel')
        .set(headers)
        .expect(404);
    });
  });

  describe('cancel', () => {
    it('accepts a cancel for a reply in progress', async () => {
      const headers = await login(`${Date.now()}-cancel`);
      const asked = await ask(headers, 'long question').expect(202);

      await request(app.getHttpServer())
        .post(`/api/ai/conversation/messages/${(asked.body as AskBody).reply.id}/cancel`)
        .set(headers)
        .expect(204);
    });

    it('Stop before generation started: the row is CANCELLED immediately, no attempt claims it later', async () => {
      const headers = await login(`${Date.now()}-cancel-pending`);
      const asked = await ask(headers, 'question never generated').expect(202);
      const replyId = (asked.body as AskBody).reply.id;

      await request(app.getHttpServer())
        .post(`/api/ai/conversation/messages/${replyId}/cancel`)
        .set(headers)
        .expect(204);

      // Durable СТОП: рядок термінальний одразу, без жодного worker-делівері
      // (design.md D4) — claim() такий рядок більше ніколи не візьме
      // (перевірено окремо в AiMessageStateService: термінальні статуси не захоплюються)
      const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: replyId } });
      expect(row.status).toBe('CANCELLED');
      expect(row.errorCode).toBeNull();
    });

    it('accepts a cancel for a reply that already finished (no-op, not an error)', async () => {
      const headers = await login(`${Date.now()}-cancel-late`);
      const asked = await ask(headers, 'question').expect(202);
      const replyId = (asked.body as AskBody).reply.id;
      await prisma.aiMessage.update({
        where: { id: replyId },
        data: { status: 'COMPLETE', content: 'done' },
      });

      await request(app.getHttpServer())
        .post(`/api/ai/conversation/messages/${replyId}/cancel`)
        .set(headers)
        .expect(204);
    });
  });

  describe('delete all conversations (ai-1e)', () => {
    it('removes the caller\'s conversations and messages', async () => {
      const headers = await login(`${Date.now()}-delete-mine`);
      const asked = await ask(headers, 'a question worth forgetting').expect(202);
      const conversationId = (asked.body as AskBody).conversationId;

      await request(app.getHttpServer())
        .delete('/api/ai/conversations')
        .set(headers)
        .expect(204);

      expect(await prisma.aiConversation.findUnique({ where: { id: conversationId } })).toBeNull();
      expect(await prisma.aiMessage.count({ where: { conversationId } })).toBe(0);

      // Наступне читання лінькво заводить нову — так само, як юзеру, що ще не питав
      const after = await request(app.getHttpServer())
        .get('/api/ai/conversation')
        .set(headers)
        .expect(200);
      expect((after.body as ConversationBody).id).not.toBe(conversationId);
      expect((after.body as ConversationBody).messages).toEqual([]);
    });

    it('is a harmless no-op when the caller has nothing to delete', async () => {
      const headers = await login(`${Date.now()}-delete-empty`);

      await request(app.getHttpServer())
        .delete('/api/ai/conversations')
        .set(headers)
        .expect(204);
    });

    it('deleting does not touch another user\'s conversations in the same tenant', async () => {
      const alice = await login(`${Date.now()}-delete-alice`);
      const bob = await login(`${Date.now()}-delete-bob`);
      const bobAsked = await ask(bob, 'bob\'s private question').expect(202);
      const bobConversationId = (bobAsked.body as AskBody).conversationId;

      await request(app.getHttpServer())
        .delete('/api/ai/conversations')
        .set(alice)
        .expect(204);

      expect(
        await prisma.aiConversation.findUnique({ where: { id: bobConversationId } }),
      ).not.toBeNull();
    });

    it('deleting does not touch another tenant\'s conversations', async () => {
      const headers = await login(`${Date.now()}-delete-tenant`);

      const otherTenant = await prisma.tenant.create({
        data: { slug: `ai-delete-${String(Date.now())}`, name: 'Other tenant' },
      });
      const otherUser = await prisma.user.create({
        data: { tenantId: otherTenant.id, email: `ai-delete-other-${String(Date.now())}@example.com`, role: 'USER' },
      });
      const otherConversation = await prisma.aiConversation.create({
        data: { tenantId: otherTenant.id, userId: otherUser.id, status: 'ACTIVE' },
      });

      await request(app.getHttpServer())
        .delete('/api/ai/conversations')
        .set(headers)
        .expect(204);

      expect(
        await prisma.aiConversation.findUnique({ where: { id: otherConversation.id } }),
      ).not.toBeNull();
    });
  });

  describe('bootstrap flag', () => {
    it('reports features.ai = true while the assistant is enabled', async () => {
      const headers = await login(`${Date.now()}-flag`);

      const response = await request(app.getHttpServer())
        .get('/api/settings/bootstrap')
        .set(headers)
        .expect(200);

      expect((response.body as { features: Record<string, boolean> }).features.ai).toBe(true);
    });
  });
});
