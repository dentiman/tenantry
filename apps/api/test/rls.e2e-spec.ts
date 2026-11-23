// MT-2: захисна сітка RLS (docs/multi-tenancy-architecture.md §12).
// Ганяється в `pnpm api:test:e2e` / `pnpm verify` разом з рештою e2e.
//
// Автоперевірка (нижче, `describe('автоперевірка RLS з каталогу')`) читає pg_class / pg_attribute /
// pg_policy під суперюзером і для КОЖНОЇ таблиці з `tenant_id` вимагає ENABLE + FORCE RLS,
// політику з предикатом-шаблоном міграцій і відсутність сторонніх PERMISSIVE-політик. Списку
// таблиць у файлі нема: нова tenant-таблиця потрапляє під перевірку сама, а забута політика
// чи FORCE валить тест. Логіка — у `rls-catalog.ts` (чиста функція) і має негативні тести.

import { Client } from 'pg';
import { CONTROL_PLANE_TABLES } from '../../../libs/database/scripts/control-plane-tables';
import {
  evaluateRlsCatalog,
  readRlsCatalog,
  TENANT_PREDICATE,
  type CatalogTable,
  type RlsCatalog,
  type RlsRules,
} from './rls-catalog';
import { buildAdminUrl, buildTestDatabaseUrl, TEST_DB_NAME } from './test-database';

const ROW_FOR_TENANT = (column: string): string =>
  `(${column} = ( SELECT NULLIF(current_setting('app.tenant_id'::text, true), ''::text) AS "nullif"))`;

const RULES: RlsRules = {
  exemptTables: [
    {
      table: 'platform_audit_events',
      reason: 'журнал дій оператора: захищений привілеями (REVOKE для saas_app), не RLS',
    },
  ],
  controlPlane: CONTROL_PLANE_TABLES,
  extraPolicies: [
    {
      table: 'messaging_accounts',
      policy: 'webhook_key_lookup',
      command: 'r',
      using: `(webhook_key = ( SELECT NULLIF(current_setting('app.webhook_lookup_key'::text, true), ''::text) AS "nullif"))`,
      reason: 'resolve_account_by_key: пошук акаунта за ключем вебхука до tenant-контексту',
    },
  ],
  tenantRoot: { table: 'tenants', policy: 'own_tenant', using: ROW_FOR_TENANT('id') },
};

describe('RLS enforcement (SQL-рівень, роль saas_app)', () => {
  // Голий pg-клієнт під saas_app — БЕЗ Nest, БЕЗ extension, БЕЗ set_config:
  // саме так виглядав би «забутий» шлях повз tenant-контекст
  let db: Client;
  // Суперюзер у ТІЙ САМІЙ тестовій БД — лише для читання каталогу й негативних проб у транзакції
  let admin: Client;
  let catalog: RlsCatalog;

  beforeAll(async () => {
    db = new Client({ connectionString: buildTestDatabaseUrl() });
    await db.connect();
    const adminUrl = new URL(buildAdminUrl());
    adminUrl.pathname = `/${TEST_DB_NAME}`;
    admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    catalog = await readRlsCatalog(admin);
  });

  afterAll(async () => {
    await db.end();
    await admin.end();
  });

  describe('автоперевірка RLS з каталогу', () => {
    const goodPolicy = {
      name: 'tenant_isolation',
      command: '*' as const,
      permissive: true,
      using: TENANT_PREDICATE,
      withCheck: TENANT_PREDICATE,
    };
    const goodTable = (name: string, patch: Partial<CatalogTable> = {}): CatalogTable => ({
      name,
      hasTenantId: true,
      rowSecurity: true,
      forceRowSecurity: true,
      policies: [goodPolicy],
      saasAppPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      ...patch,
    });
    const tenantsRoot = (): CatalogTable => ({
      name: 'tenants',
      hasTenantId: false,
      rowSecurity: true,
      forceRowSecurity: false,
      policies: [
        {
          name: 'own_tenant',
          command: '*',
          permissive: true,
          using: ROW_FOR_TENANT('id'),
          withCheck: null,
        },
      ],
      saasAppPrivileges: ['SELECT'],
    });
    const audit = (patch: Partial<CatalogTable> = {}): CatalogTable => ({
      name: 'platform_audit_events',
      hasTenantId: true,
      rowSecurity: false,
      forceRowSecurity: false,
      policies: [],
      saasAppPrivileges: [],
      ...patch,
    });
    const healthy = (...tables: CatalogTable[]): RlsCatalog => ({
      tables: [tenantsRoot(), audit(), ...tables],
      saasApp: { exists: true, superuser: false, bypassRls: false },
    });
    const rulesOf = (catalogToCheck: RlsCatalog): string[] =>
      evaluateRlsCatalog(catalogToCheck, RULES).map((f) => `${f.table}:${f.rule}`);

    it('РЕАЛЬНА БД: кожна таблиця з tenant_id має ENABLE+FORCE RLS і політику-шаблон (ловить «забули політику/FORCE»)', () => {
      expect(evaluateRlsCatalog(catalog, RULES)).toEqual([]);
    });

    it('перевірка не порожня: каталог містить еталонні tenant-таблиці всіх модулів', () => {
      // Якщо запит каталогу колись мовчки поверне нуль рядків, «немає знахідок» нічого не доводить
      const withTenantId = catalog.tables.filter((t) => t.hasTenantId).map((t) => t.name);
      for (const canary of [
        'users',
        'customers',
        'calendar_events',
        'conversations',
        'chat_messages',
        'notifications',
        'activities',
        'number_series',
        'ai_messages',
        'channels',
      ]) {
        expect(withTenantId).toContain(canary);
      }
      expect(withTenantId.length).toBeGreaterThanOrEqual(30);
      expect(catalog.tables.find((t) => t.name === 'platform_audit_events')?.rowSecurity).toBe(
        false,
      );
    });

    it('базовий здоровий знімок не дає знахідок (опорна точка негативних тестів)', () => {
      expect(rulesOf(healthy(goodTable('widgets')))).toEqual([]);
    });

    it('ловить таблицю з tenant_id без RLS поза винятками', () => {
      const found = rulesOf(
        healthy(
          goodTable('widgets', { rowSecurity: false, forceRowSecurity: false, policies: [] }),
        ),
      );
      expect(found).toEqual(
        expect.arrayContaining(['widgets:rls-disabled', 'widgets:policy-missing']),
      );
    });

    it('ловить RLS без FORCE (власник таблиці обходить політику)', () => {
      expect(rulesOf(healthy(goodTable('widgets', { forceRowSecurity: false })))).toEqual([
        'widgets:force-missing',
      ]);
    });

    it('ловить політику USING (true) — наявність політики з іменем таблиці її б не зловила', () => {
      const leaky = goodTable('widgets', {
        policies: [{ ...goodPolicy, using: 'true', withCheck: 'true' }],
      });
      expect(rulesOf(healthy(leaky))).toEqual(
        expect.arrayContaining(['widgets:predicate-not-tenant', 'widgets:check-not-tenant']),
      );
    });

    it('ловить предикат, що лише ЗГАДУЄ tenant-налаштування (tenant_id = X OR true)', () => {
      const orTrue = `${TENANT_PREDICATE.slice(0, -1)} OR true)`;
      const sneaky = goodTable('widgets', {
        policies: [{ ...goodPolicy, using: orTrue, withCheck: orTrue }],
      });
      expect(rulesOf(healthy(sneaky))).toEqual(
        expect.arrayContaining(['widgets:predicate-not-tenant']),
      );
    });

    it('ловить політику без WITH CHECK (запис у чужий tenant)', () => {
      const noCheck = goodTable('widgets', { policies: [{ ...goodPolicy, withCheck: null }] });
      expect(rulesOf(healthy(noCheck))).toEqual(['widgets:check-not-tenant']);
    });

    it('ловить сторонню PERMISSIVE-політику USING (true) поряд із tenant_isolation (OR відкриває все)', () => {
      const withLeak = goodTable('widgets', {
        policies: [
          goodPolicy,
          { name: 'everyone', command: 'r', permissive: true, using: 'true', withCheck: null },
        ],
      });
      expect(rulesOf(healthy(withLeak))).toEqual(['widgets:unexpected-permissive-policy']);
    });

    it('RESTRICTIVE-політика поверх шаблону не є знахідкою (вона лише звужує)', () => {
      const narrowed = goodTable('widgets', {
        policies: [
          goodPolicy,
          { name: 'not_archived', command: '*', permissive: false, using: 'true', withCheck: null },
        ],
      });
      expect(rulesOf(healthy(narrowed))).toEqual([]);
    });

    it('ловить таблицю з правами saas_app, яких не покриває жодна політика', () => {
      const selectOnly = goodTable('widgets', {
        policies: [{ ...goodPolicy, command: 'r', withCheck: null }],
      });
      expect(rulesOf(healthy(selectOnly))).toEqual([
        'widgets:privilege-without-policy',
        'widgets:privilege-without-policy',
        'widgets:privilege-without-policy',
      ]);
      expect(
        rulesOf(healthy(goodTable('widgets', { ...selectOnly, saasAppPrivileges: ['SELECT'] }))),
      ).toEqual([]);
    });

    it('виняток без RLS: saas_app з правами на таку таблицю — знахідка', () => {
      expect(rulesOf(healthy())).toEqual([]); // за здорових прав виняток чистий
      const open: RlsCatalog = {
        ...healthy(),
        tables: [tenantsRoot(), audit({ saasAppPrivileges: ['SELECT'] })],
      };
      expect(rulesOf(open)).toEqual(
        expect.arrayContaining(['platform_audit_events:exempt-privileges']),
      );
    });

    it('виняток, якого нема в CONTROL_PLANE_TABLES, — знахідка (db:roles повернув би DML)', () => {
      const found = evaluateRlsCatalog(healthy(), { ...RULES, controlPlane: [] }).map(
        (f) => `${f.table}:${f.rule}`,
      );
      expect(found).toContain('platform_audit_events:exempt-not-in-control-plane');
    });

    it('застарілий виняток (таблиця вже під RLS або зникла) — знахідка', () => {
      const alreadyRls: RlsCatalog = {
        ...healthy(),
        tables: [
          tenantsRoot(),
          audit({ rowSecurity: true, forceRowSecurity: true, policies: [goodPolicy] }),
        ],
      };
      expect(rulesOf(alreadyRls)).toContain('platform_audit_events:stale-exemption');
      const gone: RlsCatalog = { ...healthy(), tables: [tenantsRoot()] };
      expect(rulesOf(gone)).toContain('platform_audit_events:stale-exemption');
    });

    it('права saas_app на таблицю control plane розходяться зі списком db:roles — знахідка', () => {
      const drift: RlsCatalog = {
        ...healthy(),
        tables: [
          tenantsRoot(),
          audit(),
          {
            name: 'platform_users',
            hasTenantId: false,
            rowSecurity: false,
            forceRowSecurity: false,
            policies: [],
            saasAppPrivileges: ['SELECT'],
          },
        ],
      };
      expect(rulesOf(drift)).toEqual(['platform_users:control-plane-privileges']);
    });

    it('ловить роль saas_app з BYPASSRLS/superuser і зламаний корінь tenants', () => {
      const bypass: RlsCatalog = {
        ...healthy(),
        saasApp: { exists: true, superuser: false, bypassRls: true },
      };
      expect(rulesOf(bypass)).toEqual(['(role saas_app):role-bypasses-rls']);

      const brokenRoot: RlsCatalog = {
        ...healthy(),
        tables: [
          { ...tenantsRoot(), policies: [{ ...tenantsRoot().policies[0]!, using: 'true' }] },
          audit(),
        ],
      };
      expect(rulesOf(brokenRoot)).toEqual(['tenants:predicate-not-tenant']);
    });

    /**
     * Те саме, але проти ЖИВОГО каталогу: тимчасова таблиця створюється під суперюзером у
     * транзакції, яку завжди відкочуємо, тож БД не засмічується, а запити `readRlsCatalog`
     * перевіряються разом із чистою функцією — а не лише на вигаданих знімках.
     */
    it('живий каталог: пробна таблиця проходить шлях «без RLS → без FORCE → USING (true) → шаблон»', async () => {
      const probe = 'zz_rls_probe';
      const rulesFor = async (rules: RlsRules = RULES): Promise<string[]> =>
        evaluateRlsCatalog(await readRlsCatalog(admin), rules)
          .filter((f) => f.table === probe)
          .map((f) => f.rule);

      await admin.query('BEGIN');
      try {
        await admin.query(`CREATE TABLE public.${probe} (id text PRIMARY KEY, tenant_id text)`);
        expect(await rulesFor()).toEqual(
          expect.arrayContaining(['rls-disabled', 'force-missing', 'policy-missing']),
        );

        await admin.query(`ALTER TABLE public.${probe} ENABLE ROW LEVEL SECURITY`);
        await admin.query(
          `CREATE POLICY tenant_isolation ON public.${probe} FOR ALL USING (true) WITH CHECK (true)`,
        );
        expect(await rulesFor()).toEqual(
          expect.arrayContaining(['force-missing', 'predicate-not-tenant', 'check-not-tenant']),
        );

        await admin.query(`ALTER TABLE public.${probe} FORCE ROW LEVEL SECURITY`);
        await admin.query(`DROP POLICY tenant_isolation ON public.${probe}`);
        await admin.query(`
          CREATE POLICY tenant_isolation ON public.${probe} FOR ALL
            USING ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
            WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
        `);
        expect(await rulesFor()).toEqual([]); // шаблон міграцій дослівно — знахідок нема

        await admin.query(`GRANT SELECT, INSERT ON public.${probe} TO saas_app`);
        expect(await rulesFor()).toEqual([]); // SELECT/INSERT покриті політикою FOR ALL

        await admin.query(`CREATE POLICY leak ON public.${probe} FOR SELECT USING (true)`);
        expect(await rulesFor()).toEqual(['unexpected-permissive-policy']);
        await admin.query(`DROP POLICY leak ON public.${probe}`);

        // Виняток без RLS: права saas_app на таку таблицю — дірка
        await admin.query(`DROP POLICY tenant_isolation ON public.${probe}`);
        await admin.query(`ALTER TABLE public.${probe} DISABLE ROW LEVEL SECURITY`);
        const asExempt: RlsRules = {
          ...RULES,
          exemptTables: [...RULES.exemptTables, { table: probe, reason: 'проба' }],
          controlPlane: [...CONTROL_PLANE_TABLES, { table: probe, saasApp: 'none' }],
        };
        expect(await rulesFor(asExempt)).toEqual(
          expect.arrayContaining(['exempt-privileges', 'control-plane-privileges']),
        );
      } finally {
        await admin.query('ROLLBACK');
      }

      const after = await admin.query(`SELECT to_regclass('public.${probe}') AS found`);
      expect(after.rows[0]).toEqual({ found: null }); // БД чиста
    });
  });

  it('без tenant-контексту читання дає НУЛЬ рядків (fail-closed), не помилку і не все', async () => {
    // Список — з каталогу, не вручну: усі tenant-таблиці під RLS, які saas_app може читати
    const readable = catalog.tables
      .filter(
        (t) =>
          (t.hasTenantId && t.rowSecurity && t.saasAppPrivileges.includes('SELECT')) ||
          t.name === RULES.tenantRoot.table,
      )
      .map((t) => t.name);
    expect(readable.length).toBeGreaterThanOrEqual(30);
    for (const table of readable) {
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
        for (const table of [
          'messaging_accounts',
          'channels',
          'channel_contacts',
          'channel_webhook_events',
          'channel_pending_statuses',
          'channel_logs',
        ]) {
          expect({ table, seen: Number(await count(table)) > 0 }).toEqual({ table, seen: true });
        }
      });
      await inTenant(tenantB, async () => {
        for (const table of [
          'messaging_accounts',
          'channels',
          'channel_contacts',
          'channel_webhook_events',
          'channel_pending_statuses',
          'channel_logs',
        ]) {
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
      await expect(
        inTenant(tenantA, async () => {
          await make('rls-chan-def-2', 'rls-def-ext-2', true);
        }),
      ).rejects.toThrow(/channels_account_default_key/);
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

      const wrongProvider = await db.query(
        `SELECT * FROM resolve_account_by_key('meta_cloud', $1)`,
        [webhookKey],
      );
      expect(wrongProvider.rows).toEqual([]);
      const unknown = await db.query(`SELECT * FROM resolve_account_by_key('fake', 'no-such-key')`);
      expect(unknown.rows).toEqual([]);
    });

    it('політика пошуку за ключем не відкриває таблицю поза функцією', async () => {
      const direct = await db.query<{ count: string }>(`SELECT count(*) FROM messaging_accounts`);
      expect(direct.rows[0]?.count).toBe('0');
      // і після виклику функції налаштування не лишається діючим
      await db.query(`SELECT * FROM resolve_account_by_key('fake', $1)`, [webhookKey]);
      const afterCall = await db.query<{ count: string }>(
        `SELECT count(*) FROM messaging_accounts`,
      );
      expect(afterCall.rows[0]?.count).toBe('0');
    });

    it('вимкнений акаунт невидимий для пошуку за ключем, як невідомий', async () => {
      await inTenant(tenantA, async () => {
        await db.query(`UPDATE messaging_accounts SET status = 'DISABLED' WHERE id = $1`, [
          accountId,
        ]);
      });
      const found = await db.query(`SELECT * FROM resolve_account_by_key('fake', $1)`, [
        webhookKey,
      ]);
      expect(found.rows).toEqual([]);
      await inTenant(tenantA, async () => {
        await db.query(`UPDATE messaging_accounts SET status = 'CONNECTED' WHERE id = $1`, [
          accountId,
        ]);
      });
    });

    it('channel_unroutable_events: saas_app лише пише через функцію і не читає напряму', async () => {
      await expect(db.query(`SELECT count(*) FROM channel_unroutable_events`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(
          `INSERT INTO channel_unroutable_events (id, provider, key_hash, reason) VALUES ('x','fake','h','r')`,
        ),
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
