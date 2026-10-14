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
  'ai_usage_events',
  'ai_knowledge_sources',
  'ai_knowledge_documents',
  'ai_knowledge_chunks',
  // CHAT-2a: канали. channel_unroutable_events — свідомо поза списком (без tenant_id, без RLS)
  'messaging_accounts',
  'channels',
  'channel_contacts',
  'channel_contact_addresses',
  'channel_webhook_events',
  // CHAT-2b: квитанції, що випередили external_id
  'channel_pending_statuses',
  // CHAT-3a: журнал викликів до провайдера
  'channel_logs',
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

  /**
   * CHAT-2a. Канали: усе, що тенант A записав, під B не існує; пошук за ключем вебхука
   * працює ДО tenant-контексту, але повертає лише ідентифікатори, а вимкнений акаунт невидимий.
   */
  describe('канали (CHAT-2a)', () => {
    const tenantA = '00000000-0000-4000-8000-000000000001';
    const tenantB = '00000000-0000-4000-8000-0000000000ff';
    const accountId = 'rls-chan-account';
    const channelId = 'rls-chan-channel';
    const contactId = 'rls-chan-contact';
    const webhookKey = 'rls-chan-key-0123456789abcdef0123456789abcdef';

    const inTenant = async (tenant: string, fn: () => Promise<void>): Promise<void> => {
      await db.query('BEGIN');
      try {
        await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
        await fn();
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    };

    const cleanup = async (): Promise<void> => {
      await inTenant(tenantA, async () => {
        await db.query(`DELETE FROM channel_logs WHERE account_id = $1`, [accountId]);
        await db.query(`DELETE FROM channel_pending_statuses WHERE account_id = $1`, [accountId]);
        await db.query(`DELETE FROM channel_webhook_events WHERE account_id = $1`, [accountId]);
        await db.query(`DELETE FROM channel_contacts WHERE id = $1`, [contactId]);
        await db.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
        await db.query(`DELETE FROM messaging_accounts WHERE id = $1`, [accountId]);
      });
    };

    beforeAll(async () => {
      await cleanup();
      await inTenant(tenantA, async () => {
        await db.query(
          `INSERT INTO messaging_accounts (id, tenant_id, provider, name, verify_token, webhook_key, updated_at)
           VALUES ($1, $2, 'fake', 'RLS smoke', 'vt', $3, now())`,
          [accountId, tenantA, webhookKey],
        );
        await db.query(
          `INSERT INTO channels (id, tenant_id, account_id, type, provider, external_id, updated_at)
           VALUES ($1, $2, $3, 'WHATSAPP', 'fake', 'rls-chan-ext', now())`,
          [channelId, tenantA, accountId],
        );
        await db.query(
          `INSERT INTO channel_contacts (id, tenant_id, channel_id, updated_at)
           VALUES ($1, $2, $3, now())`,
          [contactId, tenantA, channelId],
        );
        await db.query(
          `INSERT INTO channel_webhook_events (id, tenant_id, account_id, body, payload_hash)
           VALUES ('rls-chan-event', $1, $2, '{}', 'hash')`,
          [tenantA, accountId],
        );
        await db.query(
          `INSERT INTO channel_logs (id, tenant_id, account_id, operation, ok, duration_ms)
           VALUES ('rls-chan-log', $1, $2, 'send', true, 12)`,
          [tenantA, accountId],
        );
        await db.query(
          `INSERT INTO channel_pending_statuses (id, tenant_id, account_id, channel_external_id, external_id, status, occurred_at)
           VALUES ('rls-chan-pending', $1, $2, 'rls-chan-ext', 'wamid.x', 'delivered', now())`,
          [tenantA, accountId],
        );
      });
    });

    afterAll(cleanup);

    it('рядки тенанта A невидимі під B в усіх канальних таблицях', async () => {
      const count = async (table: string): Promise<string | undefined> => {
        const r = await db.query<{ count: string }>(`SELECT count(*) FROM "${table}"`);
        return r.rows[0]?.count;
      };
      await inTenant(tenantA, async () => {
        for (const table of ['messaging_accounts', 'channels', 'channel_contacts', 'channel_webhook_events', 'channel_pending_statuses', 'channel_logs']) {
          expect({ table, seen: Number(await count(table)) > 0 }).toEqual({ table, seen: true });
        }
      });
      await inTenant(tenantB, async () => {
        for (const table of ['messaging_accounts', 'channels', 'channel_contacts', 'channel_webhook_events', 'channel_pending_statuses', 'channel_logs']) {
          expect({ table, count: await count(table) }).toEqual({ table, count: '0' });
        }
      });
    });

    it('один default-канал на акаунт: другий у тому самому акаунті — порушення унікальності', async () => {
      const make = (id: string, ext: string, def: boolean) =>
        db.query(
          `INSERT INTO channels (id, tenant_id, account_id, type, provider, external_id, is_default, updated_at)
           VALUES ($1, $2, $3, 'WHATSAPP', 'fake', $4, $5, now())`,
          [id, tenantA, accountId, ext, def],
        );
      await inTenant(tenantA, async () => {
        await db.query(`UPDATE channels SET is_default = false WHERE account_id = $1`, [accountId]);
        await make('rls-chan-def-1', 'rls-def-ext-1', true);
      });
      await expect(inTenant(tenantA, async () => { await make('rls-chan-def-2', 'rls-def-ext-2', true); })).rejects.toThrow(
        /channels_account_default_key/,
      );
      // не-default у тому самому акаунті — можна
      await inTenant(tenantA, async () => {
        await make('rls-chan-def-3', 'rls-def-ext-3', false);
      });
      await inTenant(tenantA, async () => {
        await db.query(`DELETE FROM channels WHERE id IN ('rls-chan-def-1', 'rls-chan-def-3')`);
      });
    });

    it('запис у чужий тенант падає на політиці', async () => {
      await expect(
        inTenant(tenantB, async () => {
          await db.query(
            `INSERT INTO messaging_accounts (id, tenant_id, provider, name, verify_token, webhook_key, updated_at)
             VALUES ('rls-chan-foreign', $1, 'fake', 'x', 'vt', 'rls-chan-foreign-key', now())`,
            [tenantA],
          );
        }),
      ).rejects.toThrow(/row-level security/);
    });

    it('resolve_account_by_key: ключ знайдено без tenant-контексту, повертаються лише ідентифікатори', async () => {
      const found = await db.query<{ tenant_id: string; account_id: string }>(
        `SELECT * FROM resolve_account_by_key('fake', $1)`,
        [webhookKey],
      );
      expect(found.rows).toEqual([{ tenant_id: tenantA, account_id: accountId }]);

      const wrongProvider = await db.query(`SELECT * FROM resolve_account_by_key('meta_cloud', $1)`, [webhookKey]);
      expect(wrongProvider.rows).toEqual([]);
      const unknown = await db.query(`SELECT * FROM resolve_account_by_key('fake', 'no-such-key')`);
      expect(unknown.rows).toEqual([]);
    });

    it('політика пошуку за ключем не відкриває таблицю поза функцією', async () => {
      const direct = await db.query<{ count: string }>(`SELECT count(*) FROM messaging_accounts`);
      expect(direct.rows[0]?.count).toBe('0');
      // і після виклику функції налаштування не лишається діючим
      await db.query(`SELECT * FROM resolve_account_by_key('fake', $1)`, [webhookKey]);
      const afterCall = await db.query<{ count: string }>(`SELECT count(*) FROM messaging_accounts`);
      expect(afterCall.rows[0]?.count).toBe('0');
    });

    it('вимкнений акаунт невидимий для пошуку за ключем, як невідомий', async () => {
      await inTenant(tenantA, async () => {
        await db.query(`UPDATE messaging_accounts SET status = 'DISABLED' WHERE id = $1`, [accountId]);
      });
      const found = await db.query(`SELECT * FROM resolve_account_by_key('fake', $1)`, [webhookKey]);
      expect(found.rows).toEqual([]);
      await inTenant(tenantA, async () => {
        await db.query(`UPDATE messaging_accounts SET status = 'CONNECTED' WHERE id = $1`, [accountId]);
      });
    });

    it('channel_unroutable_events: saas_app лише пише через функцію і не читає напряму', async () => {
      await expect(db.query(`SELECT count(*) FROM channel_unroutable_events`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(`INSERT INTO channel_unroutable_events (id, provider, key_hash, reason) VALUES ('x','fake','h','r')`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`SELECT record_unroutable_event('fake', 'rls-chan-hash', 'unknown_key', NULL)`),
      ).resolves.toBeDefined();
    });
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
