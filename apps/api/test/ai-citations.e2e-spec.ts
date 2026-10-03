/// <reference types="jest" />
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaService, type Role } from '@saas-skeleton/database';
import type { KnowledgeChunkRef } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';
import { sentJobs } from './__mocks__/pg-boss';

interface CitationBody {
  n: number;
  title: string;
  heading: string;
  path: string;
  content?: string;
}
interface ConversationBody {
  messages: { id: string; role: string; citations: CitationBody[] }[];
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const embedding = JSON.stringify([1, ...Array<number>(1535).fill(0)]);

/**
 * Цитати відповіді асистента (AI-2a.3, design.md D7/D8) через HTTP. Генерації немає:
 * рядок відповіді й індекс знань готуються напряму, перевіряється лише те, що API
 * показує й віддає — і що доступ перевіряється при КОЖНОМУ відкритті.
 */
describe('AI assistant citations (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
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
    await prisma.aiKnowledgeSource.deleteMany({ where: { tenantId: DEFAULT_TENANT_ID } });
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    sentJobs.reset();
  });

  afterAll(async () => {
    await prisma.aiKnowledgeSource.deleteMany({ where: { tenantId: DEFAULT_TENANT_ID } });
    await app.close();
    delete process.env.AI_ENABLED;
  });

  const login = async (suffix: string, role: Role = 'USER') => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `ai-cite-${suffix}-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      role,
    });
    return { userId: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  /** Опублікований фрагмент у default tenant-і (system role: RLS тут не перевіряється) */
  const publishChunk = async (
    options: { audience?: Role[]; hash?: string; revision?: string } = {},
  ) => {
    const revision = options.revision ?? 'r1';
    const source = await prisma.aiKnowledgeSource.upsert({
      where: { tenantId_product_key: { tenantId: DEFAULT_TENANT_ID, product: 'fms', key: 'fms' } },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        key: 'fms',
        product: 'fms',
        isEnabled: true,
        activeRevision: revision,
      },
      update: { isEnabled: true, activeRevision: revision },
    });
    const document = await prisma.aiKnowledgeDocument.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        sourceId: source.id,
        revision,
        canonicalId: randomUUID(),
        path: '010/billing.md',
        title: 'Billing',
        language: 'en',
        audience: options.audience ?? ['ADMIN', 'USER'],
        contentHash: HASH_A,
      },
    });
    const chunkId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO ai_knowledge_chunks
        (id, tenant_id, document_id, ordinal, heading, content, content_hash, token_count, embedding)
      VALUES (${chunkId}, ${DEFAULT_TENANT_ID}, ${document.id}, 0, 'Billing > Fees',
              'Meta charges per conversation window.', ${options.hash ?? HASH_A}, 8, ${embedding}::vector)`;
    return { source, document, chunkId };
  };

  const ref = (n: number, chunkId: string, contentHash = HASH_A): KnowledgeChunkRef => ({
    n,
    chunkId,
    documentId: randomUUID(),
    sourceKey: 'fms',
    revision: 'r1',
    title: 'Billing',
    path: '010/billing.md',
    heading: 'Billing > Fees',
    contentHash,
  });

  /** Відповідь, що посилається на [1] і вигаданий [7]; [2] наданий, але не цитований */
  const answeredReply = async (headers: { Authorization: string }, chunks: KnowledgeChunkRef[]) => {
    const asked = await request(app.getHttpServer())
      .post('/api/ai/conversation/messages')
      .set(headers)
      .send({ text: 'How is WhatsApp billed?' })
      .expect(202);
    const replyId = (asked.body as { reply: { id: string } }).reply.id;
    await prisma.aiMessage.update({
      where: { id: replyId },
      data: {
        status: 'COMPLETE',
        content: 'Per window [1]. See also [7].',
        knowledgeChunks: chunks,
      },
    });
    return replyId;
  };

  const openCitation = (headers: { Authorization: string }, replyId: string, n: number) =>
    request(app.getHttpServer())
      .get(`/api/ai/conversation/messages/${replyId}/citations/${String(n)}`)
      .set(headers);

  it('lists only supplied excerpts the answer cites and returns the text of one', async () => {
    const { headers } = await login('owner');
    const a = await publishChunk();
    const b = await publishChunk({ hash: HASH_B });
    const replyId = await answeredReply(headers, [ref(1, a.chunkId), ref(2, b.chunkId, HASH_B)]);

    const conversation = await request(app.getHttpServer())
      .get('/api/ai/conversation')
      .set(headers)
      .expect(200);
    const reply = (conversation.body as ConversationBody).messages.find((m) => m.id === replyId);
    expect(reply?.citations).toEqual([
      { n: 1, title: 'Billing', heading: 'Billing > Fees', path: '010/billing.md' },
    ]);
    const question = (conversation.body as ConversationBody).messages.find(
      (m) => m.role === 'USER',
    );
    expect(question?.citations).toEqual([]);

    const opened = await openCitation(headers, replyId, 1).expect(200);
    expect(opened.body).toEqual({
      n: 1,
      title: 'Billing',
      heading: 'Billing > Fees',
      path: '010/billing.md',
      content: 'Meta charges per conversation window.',
    });
    await openCitation(headers, replyId, 2).expect(404); // supplied, but not cited
    await openCitation(headers, replyId, 7).expect(404); // invented by the model
  });

  it("another user cannot open someone else's citation", async () => {
    const owner = await login('owner');
    const other = await login('other');
    const { chunkId } = await publishChunk();
    const replyId = await answeredReply(owner.headers, [ref(1, chunkId)]);
    await openCitation(other.headers, replyId, 1).expect(404);
  });

  it("re-checks the audience against the user's CURRENT role on every open", async () => {
    const { userId, headers } = await login('role');
    const { chunkId } = await publishChunk({ audience: ['ADMIN'] });
    const replyId = await answeredReply(headers, [ref(1, chunkId)]);

    await openCitation(headers, replyId, 1).expect(404);
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    await openCitation(headers, replyId, 1).expect(200); // same token, role read from the DB
  });

  it('an unpublished or disabled source makes the citation unavailable', async () => {
    const { headers } = await login('unpublished');
    const { source, chunkId } = await publishChunk();
    const replyId = await answeredReply(headers, [ref(1, chunkId)]);
    await openCitation(headers, replyId, 1).expect(200);

    await prisma.aiKnowledgeSource.update({
      where: { id: source.id },
      data: { activeRevision: 'r2' },
    });
    await openCitation(headers, replyId, 1).expect(404);
    await prisma.aiKnowledgeSource.update({
      where: { id: source.id },
      data: { activeRevision: 'r1', isEnabled: false },
    });
    await openCitation(headers, replyId, 1).expect(404);
  });

  it('after re-indexing, the same text in the new published revision is still found', async () => {
    const { headers } = await login('reindex');
    const first = await publishChunk();
    const replyId = await answeredReply(headers, [ref(1, first.chunkId)]);

    // Re-ingest: old revision removed, same text under a new chunk id and revision
    await prisma.aiKnowledgeDocument.delete({ where: { id: first.document.id } });
    await publishChunk({ revision: 'r2' });
    const opened = await openCitation(headers, replyId, 1).expect(200);
    expect((opened.body as CitationBody).content).toBe('Meta charges per conversation window.');
  });

  it('corrupt stored metadata yields no citations instead of an error', async () => {
    const { headers } = await login('corrupt');
    const replyId = await answeredReply(headers, []);
    await prisma.aiMessage.update({
      where: { id: replyId },
      data: { knowledgeChunks: [{ n: 'x' }] },
    });
    const conversation = await request(app.getHttpServer())
      .get('/api/ai/conversation')
      .set(headers)
      .expect(200);
    const reply = (conversation.body as ConversationBody).messages.find((m) => m.id === replyId);
    expect(reply?.citations).toEqual([]);
    await openCitation(headers, replyId, 1).expect(404);
  });
});
