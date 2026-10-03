/// <reference types="jest" />
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaModule,
  SystemPrismaService,
  TenancyModule,
  TenantContextService,
  TenantTransactions,
  type Prisma,
  type Role,
} from '@saas-skeleton/database';
import {
  KNOWLEDGE_EMBEDDING_MODEL,
  PostgresKnowledgeStore,
  serializeKnowledgeVector,
} from '@saas-skeleton/shared';

const tenantA = 'knowledge-test-a';
const tenantB = 'knowledge-test-b';
const vector = (x = 1, y = 0): number[] => [x, y, ...Array<number>(1534).fill(0)];

describe('Postgres knowledge foundation (real pgvector + tenant transactions)', () => {
  let module: TestingModule;
  let system: SystemPrismaService;
  let context: TenantContextService;
  let transactions: TenantTransactions;
  let store: PostgresKnowledgeStore;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TenancyModule.forRoot(), PrismaModule],
      providers: [PostgresKnowledgeStore],
    }).compile();
    await module.init();
    system = module.get(SystemPrismaService);
    context = module.get(TenantContextService);
    transactions = module.get(TenantTransactions);
    store = module.get(PostgresKnowledgeStore);
    for (const id of [tenantA, tenantB]) {
      await system.tenant.create({ data: { id, slug: id, name: id } });
    }
  });

  beforeEach(async () => {
    await system.aiKnowledgeSource.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  });

  afterAll(async () => {
    await system.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await module.close();
  });

  const inTenant = <T>(tenant: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    context.runWith(tenant, () => transactions.withTenantTx(fn));

  const insertChunk = async (
    tx: Prisma.TransactionClient,
    documentId: string,
    embedding = vector(),
    model = KNOWLEDGE_EMBEDDING_MODEL,
    ordinal = 0,
  ) => {
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO ai_knowledge_chunks
        (id, document_id, ordinal, heading, content, content_hash, token_count, embedding_model, embedding)
      VALUES (${id}, ${documentId}, ${ordinal}, 'Setup', 'FMS configuration', ${'b'.repeat(64)},
              4, ${model}, ${JSON.stringify(embedding)}::vector)
    `;
    return id;
  };

  const fixture = (
    tenant = tenantA,
    options: {
      product?: string;
      audience?: Role[];
      enabled?: boolean;
      activeRevision?: string | null;
      revision?: string;
      embedding?: number[];
    } = {},
  ) =>
    inTenant(tenant, async (tx) => {
      const source = await tx.aiKnowledgeSource.create({
        data: {
          key: randomUUID(),
          product: options.product ?? 'fms',
          isEnabled: options.enabled ?? true,
          activeRevision: options.activeRevision === undefined ? 'v1' : options.activeRevision,
        },
      });
      const document = await tx.aiKnowledgeDocument.create({
        data: {
          sourceId: source.id,
          revision: options.revision ?? 'v1',
          canonicalId: 'setup',
          path: '010_platform/setup.md',
          title: 'Setup',
          language: 'en',
          audience: options.audience ?? ['USER', 'ADMIN'],
          contentHash: 'a'.repeat(64),
        },
      });
      const chunkId = await insertChunk(tx, document.id, options.embedding);
      return { source, document, chunkId };
    });

  const search = (tenant = tenantA, role: Role = 'USER', limit = 12) =>
    context.runWith(tenant, () =>
      store.search({
        product: 'fms',
        role,
        limit,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        embedding: vector(),
      }),
    );

  it('runs on pgvector with an unprivileged runtime and migrator', async () => {
    const rows = await inTenant(
      tenantA,
      (tx) => tx.$queryRaw<
        {
          current_user: string;
          version: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }[]
      >`
      SELECT current_user, e.extversion AS version, r.rolsuper, r.rolbypassrls
      FROM pg_extension e CROSS JOIN pg_roles r
      WHERE e.extname = 'vector' AND r.rolname = 'saas_migrator'
    `,
    );
    expect(rows[0]).toMatchObject({
      current_user: 'saas_app',
      rolsuper: false,
      rolbypassrls: false,
    });
    expect(rows[0]?.version).toBe('0.8.6');
  });

  it('ranks exact cosine matches only after tenant, product, audience and revision filters', async () => {
    const farther = await fixture(tenantA, { embedding: vector(0, 1) });
    const nearer = await fixture(tenantA, { embedding: vector(0.8, 0.6) });
    await fixture(tenantB); // closest, but forbidden
    await fixture(tenantA, { product: 'saas-skeleton' });
    await fixture(tenantA, { audience: ['ADMIN'] });
    await fixture(tenantA, { audience: [] });
    await fixture(tenantA, { revision: 'v2' }); // staged, not published
    await fixture(tenantA, { enabled: false });
    await fixture(tenantA, { activeRevision: null });

    const matches = await search();
    expect(matches.map((m) => m.chunkId)).toEqual([nearer.chunkId, farther.chunkId]);
    expect(matches[0]?.distance).toBeCloseTo(0.2);
    expect(matches[0]).toMatchObject({
      path: '010_platform/setup.md',
      revision: 'v1',
      tokenCount: 4,
    });
    expect((await search(tenantA, 'USER', 1)).map((m) => m.chunkId)).toEqual([nearer.chunkId]);
  });

  it('reads current publication and audience on each request', async () => {
    const item = await fixture();
    expect(await search()).toHaveLength(1);
    await inTenant(tenantA, (tx) =>
      tx.aiKnowledgeDocument.update({
        where: { id: item.document.id },
        data: { audience: ['ADMIN'] },
      }),
    );
    expect(await search()).toEqual([]);
    expect(await search(tenantA, 'ADMIN')).toHaveLength(1);
    await inTenant(tenantA, (tx) =>
      tx.aiKnowledgeSource.update({
        where: { id: item.source.id },
        data: { activeRevision: 'v2' },
      }),
    );
    expect(await search(tenantA, 'ADMIN')).toEqual([]);
    await inTenant(tenantA, (tx) =>
      tx.aiKnowledgeSource.update({
        where: { id: item.source.id },
        data: { activeRevision: 'v1', isEnabled: false },
      }),
    );
    expect(await search(tenantA, 'ADMIN')).toEqual([]);
  });

  it('defaults to an unpublished source and denies reads/writes without tenant context', async () => {
    const source = await inTenant(tenantA, (tx) =>
      tx.aiKnowledgeSource.create({
        data: { key: 'new', product: 'fms' },
      }),
    );
    expect(source).toMatchObject({ tenantId: tenantA, isEnabled: false, activeRevision: null });
    await fixture();
    expect(
      await store.search({
        product: 'fms',
        role: 'ADMIN',
        limit: 5,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        embedding: vector(),
      }),
    ).toEqual([]);
    await expect(
      transactions.withTenantTx((tx) =>
        tx.aiKnowledgeSource.create({
          data: { key: 'bad', product: 'fms' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('denies tenant B reading/updating/deleting A and rejects a forged tenant on insert', async () => {
    const { source } = await fixture();
    await inTenant(tenantB, async (tx) => {
      expect(await tx.aiKnowledgeSource.findMany({ where: { id: source.id } })).toEqual([]);
      expect(await tx.aiKnowledgeDocument.count()).toBe(0);
      expect(await tx.aiKnowledgeChunk.count()).toBe(0);
      expect(
        await tx.aiKnowledgeSource.updateMany({
          where: { id: source.id },
          data: { isEnabled: false },
        }),
      ).toEqual({ count: 0 });
      expect(await tx.aiKnowledgeSource.deleteMany({ where: { id: source.id } })).toEqual({
        count: 0,
      });
    });
    await expect(
      inTenant(tenantB, (tx) =>
        tx.aiKnowledgeSource.create({
          data: { tenantId: tenantA, key: 'forged', product: 'fms' },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('composite FKs reject a document or chunk attached to a different tenant parent', async () => {
    const other = await fixture(tenantB);
    await expect(
      inTenant(tenantA, (tx) =>
        tx.aiKnowledgeDocument.create({
          data: {
            sourceId: other.source.id,
            revision: 'v1',
            canonicalId: 'bad',
            path: 'bad.md',
            title: 'Bad',
            language: 'en',
            contentHash: 'a'.repeat(64),
          },
        }),
      ),
    ).rejects.toThrow(/Foreign key constraint/i);
    await expect(inTenant(tenantA, (tx) => insertChunk(tx, other.document.id))).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('database enforces vector dimensions, nonzero vectors, model and unique chunk position', async () => {
    const item = await fixture();
    await expect(
      inTenant(tenantA, (tx) => insertChunk(tx, item.document.id, [1, 0], undefined, 1)),
    ).rejects.toThrow(/1536/);
    await expect(
      inTenant(tenantA, (tx) => insertChunk(tx, item.document.id, vector(0, 0), undefined, 1)),
    ).rejects.toThrow(/embedding_check/);
    await expect(
      inTenant(tenantA, (tx) => insertChunk(tx, item.document.id, vector(), 'different-model', 1)),
    ).rejects.toThrow(/model_check/);
    await expect(inTenant(tenantA, (tx) => insertChunk(tx, item.document.id))).rejects.toThrow(
      /unique constraint/i,
    );
  });

  it('deleting the source removes its documents and vectors', async () => {
    const item = await fixture();
    await inTenant(tenantA, (tx) => tx.aiKnowledgeSource.delete({ where: { id: item.source.id } }));
    expect(await search()).toEqual([]);
    expect(await system.aiKnowledgeDocument.count({ where: { id: item.document.id } })).toBe(0);
    expect(await system.aiKnowledgeChunk.count({ where: { id: item.chunkId } })).toBe(0);
  });

  it('rejects incompatible query embeddings and unbounded limits before SQL', () => {
    for (const bad of [
      [1],
      vector(0, 0),
      vector(NaN),
      vector(Infinity),
      vector(1e39),
      vector(1e-100),
    ]) {
      expect(() => serializeKnowledgeVector(KNOWLEDGE_EMBEDDING_MODEL, bad)).toThrow();
    }
    expect(() => serializeKnowledgeVector('another-model', vector())).toThrow();
    for (const limit of [0, -1, 51, 1.5, Infinity]) {
      expect(() =>
        store.search({
          product: 'fms',
          role: 'USER',
          limit,
          embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
          embedding: vector(),
        }),
      ).toThrow();
    }
  });
});
