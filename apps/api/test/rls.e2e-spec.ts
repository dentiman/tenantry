/// <reference types="jest" />

// MT-2: захисна сітка RLS (docs/multi-tenancy-plan.md §12).
// Ганяється в CI разом з рештою e2e — окремий CI-крок для pg_policies не потрібен.

import { Client } from 'pg';
import { buildTestDatabaseUrl } from './test-database';

/** Таблиці рівня 1 (tenant-scoped) + tenants; інфра (processed_jobs, pgboss.*) — поза RLS */
const TENANT_TABLES = [
  'users',
  'auth_sessions',
  'verification_tokens',
  'files',
  'attachments',
  'ai_conversations',
  'ai_messages',
  'ai_usage_counters',
];

describe('RLS enforcement (SQL-рівень, роль saas_app)', () => {
  // Голий pg-клієнт під saas_app — БЕЗ Nest, БЕЗ extension, БЕЗ set_config:
  // саме так виглядав би «забутий» шлях повз tenant-контекст
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: buildTestDatabaseUrl() });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it('кожна таблиця з tenant_id має ENABLE RLS і політику (ловить «забули політику»)', async () => {
    const missing = await db.query<{ table_name: string }>(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        AND (
          NOT t.rowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.table_name)
        )
    `);
    expect(missing.rows).toEqual([]);
  });

  it('без tenant-контексту читання дає НУЛЬ рядків (fail-closed), не помилку і не все', async () => {
    for (const table of [...TENANT_TABLES, 'tenants']) {
      const result = await db.query<{ count: string }>(`SELECT count(*) FROM "${table}"`);
      expect({ table, count: result.rows[0]?.count }).toEqual({ table, count: '0' });
    }
  });

  it('без tenant-контексту INSERT падає на політиці (fail-closed на запис)', async () => {
    await expect(
      db.query(`INSERT INTO users (id, email) VALUES ('rls-smoke', 'rls@smoke.test')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('з set_config видно рівно свій tenant, transaction-local (не протікає в наступний запит)', async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [
      '00000000-0000-4000-8000-000000000001',
    ]);
    const inTx = await db.query<{ count: string }>(`SELECT count(*) FROM tenants`);
    expect(inTx.rows[0]?.count).toBe('1'); // власний рядок tenants
    await db.query('COMMIT');

    // Після COMMIT контекст зник — той самий конекшн знову бачить нуль
    const after = await db.query<{ count: string }>(`SELECT count(*) FROM tenants`);
    expect(after.rows[0]?.count).toBe('0');
  });

  /**
   * AI-0: розмова асистента особиста, і межі тут ДВІ. Цей тест доводить нижню —
   * межу тенанта на рівні SQL. Верхню (чужу розмову не бачить навіть ADMIN свого
   * тенанта) тримає сервіс, і перевіряє її ai.e2e-spec.ts: RLS про учасника нічого
   * не знає за побудовою.
   *
   * Юзера сьют створює САМ і прибирає за собою: спиратись на сід означало б
   * залежність від порядку сьютів (спіймано живим прогоном — окремо тест
   * проходив, у повному наборі падав на NOT NULL user_id).
   */
  it('розмова асистента, написана під tenant A, невидима під tenant B', async () => {
    const tenantA = '00000000-0000-4000-8000-000000000001';
    const tenantB = '00000000-0000-4000-8000-0000000000ff';
    const userId = 'rls-ai-smoke-user';
    const conversationId = 'rls-ai-smoke-conversation';

    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await db.query(
        `INSERT INTO users (id, tenant_id, email, updated_at)
         VALUES ($1, $2, $3, now())`,
        [userId, tenantA, 'rls-ai-smoke@example.test'],
      );
      await db.query(
        `INSERT INTO ai_conversations (id, tenant_id, user_id, status, updated_at)
         VALUES ($1, $2, $3, 'RETIRED', now())`,
        [conversationId, tenantA, userId],
      );
      const ownTenant = await db.query<{ count: string }>(
        `SELECT count(*) FROM ai_conversations WHERE id = $1`,
        [conversationId],
      );
      expect(ownTenant.rows[0]?.count).toBe('1');
      await db.query('COMMIT');

      // Інший tenant на ТОМУ САМОМУ конекшні: рядок просто не існує
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const otherTenant = await db.query<{ count: string }>(
        `SELECT count(*) FROM ai_conversations WHERE id = $1`,
        [conversationId],
      );
      expect(otherTenant.rows[0]?.count).toBe('0');
      await db.query('COMMIT');
    } finally {
      // ROLLBACK, а не COMMIT: якщо асерт упав усередині транзакції, конекшн
      // лишився б у стані aborted і ПОХОВАВ би всі наступні тести сьюту
      await db.query('ROLLBACK').catch(() => undefined);
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await db.query(`DELETE FROM ai_conversations WHERE id = $1`, [conversationId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await db.query('COMMIT');
    }
  });

  /**
   * ai-1d: лічильники квот — та сама межа тенанта, що й розмови асистента вище.
   * Юзера сьют створює й прибирає сам (той самий прийом, що для ai_conversations):
   * спиратись на сід означало б залежність від порядку сьютів.
   */
  it('лічильник квоти, написаний під tenant A, невидимий і недоступний для запису під tenant B', async () => {
    const tenantA = '00000000-0000-4000-8000-000000000001';
    const tenantB = '00000000-0000-4000-8000-0000000000ff';
    const userId = 'rls-quota-smoke-user';
    const counterId = 'rls-quota-smoke-counter';

    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await db.query(
        `INSERT INTO users (id, tenant_id, email, updated_at)
         VALUES ($1, $2, $3, now())`,
        [userId, tenantA, 'rls-quota-smoke@example.test'],
      );
      await db.query(
        `INSERT INTO ai_usage_counters (id, tenant_id, user_id, period_start, updated_at)
         VALUES ($1, $2, $3, date_trunc('day', now()), now())`,
        [counterId, tenantA, userId],
      );
      const ownTenant = await db.query<{ count: string }>(
        `SELECT count(*) FROM ai_usage_counters WHERE id = $1`,
        [counterId],
      );
      expect(ownTenant.rows[0]?.count).toBe('1');
      await db.query('COMMIT');

      // Читання під іншим тенантом на ТОМУ САМОМУ конекшні: рядок не існує
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const otherTenantRead = await db.query<{ count: string }>(
        `SELECT count(*) FROM ai_usage_counters WHERE id = $1`,
        [counterId],
      );
      expect(otherTenantRead.rows[0]?.count).toBe('0');

      // Запис під іншим тенантом на чужий id: WITH CHECK відхиляє UPDATE (0 рядків, не помилка)
      const otherTenantWrite = await db.query(
        `UPDATE ai_usage_counters SET prompt_tokens = prompt_tokens + 1 WHERE id = $1`,
        [counterId],
      );
      expect(otherTenantWrite.rowCount).toBe(0);
      await db.query('COMMIT');
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await db.query(`DELETE FROM ai_usage_counters WHERE id = $1`, [counterId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await db.query('COMMIT');
    }
  });

  it('resolve_tenant(slug): EXECUTE дозволено, прямого перебору tenants немає', async () => {
    const known = await db.query<{ resolve_tenant: string | null }>(
      `SELECT resolve_tenant('default')`,
    );
    expect(known.rows[0]?.resolve_tenant).toBe('00000000-0000-4000-8000-000000000001');

    const unknown = await db.query<{ resolve_tenant: string | null }>(
      `SELECT resolve_tenant('no-such-tenant')`,
    );
    expect(unknown.rows[0]?.resolve_tenant).toBeNull();
  });
});
