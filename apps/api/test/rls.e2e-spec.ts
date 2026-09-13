/// <reference types="jest" />

// MT-2: захисна сітка RLS (docs/multi-tenancy-plan.md §12).
// Ганяється в CI разом з рештою e2e — окремий CI-крок для pg_policies не потрібен.

import { Client } from 'pg';
import { buildTestDatabaseUrl } from './test-database';

/** Таблиці рівня 1 (tenant-scoped) + tenants; інфра (processed_jobs, pgboss.*) — поза RLS */
const TENANT_TABLES = ['users', 'auth_sessions', 'files', 'attachments'];

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
