/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser } from './test-users';
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
