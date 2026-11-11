// RLS-автоперевірка з каталогу Postgres (docs/multi-tenancy-architecture.md §12).
//
// Дві частини, свідомо розділені:
//  - `readRlsCatalog(client)` — запити до pg_class / pg_attribute / pg_policy / pg_roles під
//    власником або суперюзером. НЕ під `saas_app`: `information_schema` показує лише таблиці,
//    доступні поточній ролі, тож під `saas_app` таблиця без жодних прав (control plane) просто
//    не видно, а «забуту» таблицю не видно теж, якщо їй не дали прав;
//  - `evaluateRlsCatalog(snapshot, rules)` — ЧИСТА функція над результатом цих запитів. Через
//    неї негативні тести показують, що перевірка справді ловить порушення, а не завжди зелена.
//
// Правила — контракт нового tenant-модуля (§11): кожна таблиця з колонкою `tenant_id` має
// ENABLE + FORCE RLS і політику `tenant_isolation`, чий предикат — той самий шаблон міграцій
// (§5), дослівно. Винятки — явні й з причиною, а не «усе, чого нема в списку».

import type { Client } from 'pg';

export type PolicyCommand = '*' | 'r' | 'a' | 'w' | 'd';
export type DmlPrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export const DML_PRIVILEGES: readonly DmlPrivilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

export interface CatalogPolicy {
  name: string;
  command: PolicyCommand;
  permissive: boolean;
  /** pg_get_expr(polqual) — те, що Postgres реально виконує, а не текст міграції */
  using: string | null;
  withCheck: string | null;
}

export interface CatalogTable {
  name: string;
  hasTenantId: boolean;
  rowSecurity: boolean;
  forceRowSecurity: boolean;
  policies: CatalogPolicy[];
  /** Привілеї `saas_app` на таблицю (рівень таблиці або будь-якої колонки) */
  saasAppPrivileges: DmlPrivilege[];
}

export interface RlsCatalog {
  tables: CatalogTable[];
  saasApp: { exists: boolean; superuser: boolean; bypassRls: boolean };
}

export interface RlsRules {
  /**
   * Таблиці з `tenant_id` БЕЗ RLS: їх захищають привілеї, не політика. Для кожної `saas_app`
   * мусить мати рівно ті права, що записані в CONTROL_PLANE_TABLES (`ensure-roles.ts`).
   */
  exemptTables: readonly { table: string; reason: string }[];
  /** Джерело правди про права `saas_app` на таблиці control plane */
  controlPlane: readonly { table: string; saasApp: 'none' | 'select' | 'select-insert' }[];
  /**
   * Додаткові PERMISSIVE-політики поверх `tenant_isolation`: Postgres об'єднує їх через OR, тож
   * кожна відкриває рядки поза tenant-контекстом і мусить бути названою тут разом з причиною.
   */
  extraPolicies: readonly {
    table: string;
    policy: string;
    command: PolicyCommand;
    using: string;
    reason: string;
  }[];
  /** Корінь ізоляції: таблиця без `tenant_id`, де роль tenant-а — це її `id` */
  tenantRoot: { table: string; policy: string; using: string };
}

export interface RlsFinding {
  table: string;
  rule: string;
  detail: string;
}

/** Предикат `tenant_isolation`, як його повертає pg_get_expr для шаблону з §5 міграцій */
export const TENANT_PREDICATE = `(tenant_id = ( SELECT NULLIF(current_setting('app.tenant_id'::text, true), ''::text) AS "nullif"))`;

export const TENANT_POLICY_NAME = 'tenant_isolation';

const normalize = (expression: string | null): string | null =>
  expression === null ? null : expression.replace(/\s+/g, ' ').trim();

/** Які команди покриває політика (`*` = усі чотири) */
const COMMANDS: Record<PolicyCommand, readonly DmlPrivilege[]> = {
  '*': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  r: ['SELECT'],
  a: ['INSERT'],
  w: ['UPDATE'],
  d: ['DELETE'],
};

const expectedPrivileges = (saasApp: 'none' | 'select' | 'select-insert'): DmlPrivilege[] =>
  saasApp === 'none' ? [] : saasApp === 'select' ? ['SELECT'] : ['SELECT', 'INSERT'];

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item) => b.includes(item));

/** Чи політика цього `command` мусить мати USING / WITH CHECK (Postgres: INSERT — лише CHECK, SELECT/DELETE — лише USING) */
const needsUsing = (command: PolicyCommand): boolean => command !== 'a';
const needsWithCheck = (command: PolicyCommand): boolean =>
  command === '*' || command === 'a' || command === 'w';

export function evaluateRlsCatalog(catalog: RlsCatalog, rules: RlsRules): RlsFinding[] {
  const findings: RlsFinding[] = [];
  const add = (table: string, rule: string, detail: string): void => {
    findings.push({ table, rule, detail });
  };

  // Без цього решта перевірок нічого не варта: роль, що обходить RLS, або відсутня роль
  if (!catalog.saasApp.exists) {
    add(
      '(role saas_app)',
      'role-missing',
      'роль saas_app не знайдена — привілеї перевірити нема як',
    );
  }
  if (catalog.saasApp.superuser || catalog.saasApp.bypassRls) {
    add(
      '(role saas_app)',
      'role-bypasses-rls',
      `saas_app superuser=${String(catalog.saasApp.superuser)} bypassrls=${String(catalog.saasApp.bypassRls)} — RLS на неї не діє`,
    );
  }

  const exempt = new Map(rules.exemptTables.map((entry) => [entry.table, entry]));
  const byName = new Map(catalog.tables.map((table) => [table.name, table]));

  for (const table of catalog.tables) {
    if (table.name === rules.tenantRoot.table) {
      checkTenantRoot(table, rules, add);
      continue;
    }
    if (!table.hasTenantId) continue;

    if (exempt.has(table.name)) {
      checkExempt(table, rules, add);
      continue;
    }
    checkTenantTable(table, rules, add);
  }

  // Застарілий виняток: таблицю перейменували/видалили або їй уже дали RLS — список мусить
  // лишатись чесним, інакше колись новий виняток «сховається» поруч із мертвим
  for (const entry of rules.exemptTables) {
    const table = byName.get(entry.table);
    if (!table) {
      add(
        entry.table,
        'stale-exemption',
        'виняток є, а таблиці в public нема — прибери його зі списку',
      );
    } else if (!table.hasTenantId) {
      add(entry.table, 'stale-exemption', 'виняток є, а колонки tenant_id в таблиці нема');
    } else if (table.rowSecurity) {
      add(
        entry.table,
        'stale-exemption',
        'виняток є, але таблиця вже під RLS — прибери його зі списку',
      );
    }
  }
  if (!byName.has(rules.tenantRoot.table)) {
    add(rules.tenantRoot.table, 'tenant-root-missing', 'корінь ізоляції не знайдено в каталозі');
  }

  // Узгодженість із db:roles: права saas_app на ВСІ таблиці control plane збігаються зі списком
  for (const entry of rules.controlPlane) {
    const table = byName.get(entry.table);
    if (!table) continue; // таблиця ще не створена цією БД — не наша справа
    const expected = expectedPrivileges(entry.saasApp);
    if (!sameSet(table.saasAppPrivileges, expected)) {
      add(
        entry.table,
        'control-plane-privileges',
        `saas_app має [${table.saasAppPrivileges.join(', ') || '—'}], CONTROL_PLANE_TABLES вимагає [${expected.join(', ') || '—'}]`,
      );
    }
  }

  return findings;
}

function checkTenantRoot(
  table: CatalogTable,
  rules: RlsRules,
  add: (table: string, rule: string, detail: string) => void,
): void {
  const { policy: policyName, using } = rules.tenantRoot;
  if (!table.rowSecurity) {
    add(table.name, 'rls-disabled', 'таблиця-корінь без ENABLE ROW LEVEL SECURITY');
  }
  // FORCE тут свідомо немає (resolve_tenant — SECURITY DEFINER від власника, docs §5): його
  // не вимагаємо, але й не забороняємо. Тримається предикат.
  const permissive = table.policies.filter((policy) => policy.permissive);
  if (permissive.length === 0) {
    add(
      table.name,
      'policy-missing',
      'нема жодної PERMISSIVE-політики — saas_app не побачить навіть свій рядок',
    );
  }
  for (const policy of permissive) {
    if (policy.name !== policyName || normalize(policy.using) !== using) {
      add(
        table.name,
        'predicate-not-tenant',
        `політика ${policy.name}: USING ${normalize(policy.using) ?? '∅'}; очікується ${policyName}: ${using}`,
      );
    }
  }
}

function checkExempt(
  table: CatalogTable,
  rules: RlsRules,
  add: (table: string, rule: string, detail: string) => void,
): void {
  const declared = rules.controlPlane.find((entry) => entry.table === table.name);
  if (!declared) {
    add(
      table.name,
      'exempt-not-in-control-plane',
      'таблиця з tenant_id без RLS мусить бути в CONTROL_PLANE_TABLES (ensure-roles): інакше db:roles поверне saas_app повний DML',
    );
    return;
  }
  // Без RLS єдиний захист — привілеї. Виняток для таблиці, яку tenant-роль може читати/писати,
  // — це дірка, а не виняток
  if (table.saasAppPrivileges.length > 0) {
    add(
      table.name,
      'exempt-privileges',
      `таблиця без RLS, а saas_app має [${table.saasAppPrivileges.join(', ')}] — бачитиме рядки всіх tenant-ів`,
    );
  }
}

function checkTenantTable(
  table: CatalogTable,
  rules: RlsRules,
  add: (table: string, rule: string, detail: string) => void,
): void {
  if (!table.rowSecurity) {
    add(
      table.name,
      'rls-disabled',
      'є tenant_id, але RLS не ввімкнено, а таблиці нема у винятках (rules.exemptTables)',
    );
  }
  if (!table.forceRowSecurity) {
    add(
      table.name,
      'force-missing',
      'нема FORCE ROW LEVEL SECURITY — власник таблиці обходить політики',
    );
  }

  const permissive = table.policies.filter((policy) => policy.permissive);
  const tenantPolicies = permissive.filter((policy) => policy.name === TENANT_POLICY_NAME);
  if (tenantPolicies.length === 0) {
    add(table.name, 'policy-missing', `нема політики ${TENANT_POLICY_NAME}`);
  }

  const covered = new Set<DmlPrivilege>();
  let anyInvalid = false;
  for (const policy of tenantPolicies) {
    const using = normalize(policy.using);
    const withCheck = normalize(policy.withCheck);
    let valid = true;
    if (needsUsing(policy.command) && using !== TENANT_PREDICATE) {
      valid = false;
      add(
        table.name,
        'predicate-not-tenant',
        `${policy.name}: USING ${using ?? '∅'}; очікується ${TENANT_PREDICATE}`,
      );
    }
    if (needsWithCheck(policy.command) && withCheck !== TENANT_PREDICATE) {
      valid = false;
      add(
        table.name,
        'check-not-tenant',
        `${policy.name}: WITH CHECK ${withCheck ?? '∅'}; очікується ${TENANT_PREDICATE}`,
      );
    }
    if (!valid) anyInvalid = true;
    if (valid) for (const command of COMMANDS[policy.command]) covered.add(command);
  }

  // Усе, що не tenant_isolation і не названий виняток, відкриває рядки через OR
  for (const policy of permissive) {
    if (policy.name === TENANT_POLICY_NAME) continue;
    const allowed = rules.extraPolicies.find(
      (extra) =>
        extra.table === table.name &&
        extra.policy === policy.name &&
        extra.command === policy.command &&
        normalize(policy.using) === extra.using &&
        policy.withCheck === null,
    );
    if (!allowed) {
      add(
        table.name,
        'unexpected-permissive-policy',
        `політика ${policy.name} (${policy.command}) USING ${normalize(policy.using) ?? '∅'} не в rules.extraPolicies — OR з tenant_isolation відкриває рядки`,
      );
    }
  }
  for (const extra of rules.extraPolicies) {
    if (extra.table !== table.name) continue;
    if (!permissive.some((policy) => policy.name === extra.policy)) {
      add(
        table.name,
        'stale-extra-policy',
        `політики ${extra.policy} нема, а вона є в rules.extraPolicies`,
      );
    }
  }

  // Достатність: кожна дія, на яку saas_app має право, покрита політикою tenant_isolation.
  // Права без політики — не діра (Postgres за замовчуванням забороняє), а мертвий грант, який
  // ламає запис у рантаймі; краще побачити тут, ніж у проді
  // (якщо політика вже визнана хибною — корінь проблеми названо вище, дубль не потрібен)
  for (const privilege of anyInvalid ? [] : table.saasAppPrivileges) {
    if (!covered.has(privilege)) {
      add(
        table.name,
        'privilege-without-policy',
        `saas_app має ${privilege}, але жодна дійсна tenant_isolation його не покриває`,
      );
    }
  }
}

/** Знімок каталогу — читати під власником/суперюзером, не під saas_app */
export async function readRlsCatalog(client: Client): Promise<RlsCatalog> {
  const tables = await client.query<{
    name: string;
    has_tenant_id: boolean;
    rls: boolean;
    force_rls: boolean;
    privileges: string[];
  }>(`
    SELECT c.relname AS name,
           EXISTS (
             SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
               AND a.attnum > 0 AND NOT a.attisdropped
           ) AS has_tenant_id,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS force_rls,
           ARRAY(
             SELECT p FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
             WHERE CASE WHEN p = 'DELETE'
                        THEN has_table_privilege('saas_app', c.oid, p)
                        ELSE has_table_privilege('saas_app', c.oid, p)
                          OR has_any_column_privilege('saas_app', c.oid, p)
                   END
           ) AS privileges
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);

  const policies = await client.query<{
    table_name: string;
    name: string;
    command: PolicyCommand;
    permissive: boolean;
    using: string | null;
    with_check: string | null;
  }>(`
    SELECT c.relname AS table_name, p.polname AS name, p.polcmd::text AS command,
           p.polpermissive AS permissive,
           pg_get_expr(p.polqual, p.polrelid) AS using,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, p.polname
  `);

  const role = await client.query<{ superuser: boolean; bypass: boolean }>(
    `SELECT rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'saas_app'`,
  );

  return {
    tables: tables.rows.map((row) => ({
      name: row.name,
      hasTenantId: row.has_tenant_id,
      rowSecurity: row.rls,
      forceRowSecurity: row.force_rls,
      saasAppPrivileges: row.privileges as DmlPrivilege[],
      policies: policies.rows
        .filter((policy) => policy.table_name === row.name)
        .map((policy) => ({
          name: policy.name,
          command: policy.command,
          permissive: policy.permissive,
          using: policy.using,
          withCheck: policy.with_check,
        })),
    })),
    saasApp: {
      exists: (role.rowCount ?? 0) > 0,
      superuser: role.rows[0]?.superuser ?? false,
      bypassRls: role.rows[0]?.bypass ?? false,
    },
  };
}
