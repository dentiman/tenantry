/// <reference types="jest" />

// Привілеї runtime-ролей після ПОВТОРНОГО `db:roles` (docs/multi-tenancy-architecture.md §3).
//
// Таблиці control plane захищає не RLS, а `REVOKE` у міграції: tenant-роль (`saas_app`) їх не
// бачить узагалі. Але `db:roles` щоразу видає широкий `GRANT ... ON ALL TABLES`, а потім знову
// відкликає зайве лише для таблиць зі свого списку (`CONTROL_PLANE_TABLES`). Таблиця, якої в
// списку немає, після переналаштування ролей (зміна пароля, ops-джоба `db_roles`, `ws:init`)
// мовчки стає доступною tenant-процесам — так було з `platform_audit_events` і
// `channel_unroutable_events`.
//
// Очікування тут НЕ продубльовані вручну: їх читаємо з самих міграцій. Нова таблиця з `REVOKE`
// у міграції, яку забули додати до списку, валить цей тест без жодних правок у ньому.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildTestDatabaseUrl, TEST_DB_NAME } from './test-database';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'libs', 'database', 'prisma', 'migrations');

const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
type Privilege = (typeof PRIVILEGES)[number];

const RUNTIME_ROLES = ['saas_app', 'saas_platform'] as const;
type RuntimeRole = (typeof RUNTIME_ROLES)[number];

interface AclExpectation {
  role: RuntimeRole;
  table: string;
  privileges: Privilege[];
}

/**
 * `GRANT|REVOKE <привілеї> ON "<таблиця>" TO|FROM <ролі>;` — лише рівень таблиці. `ON FUNCTION`,
 * `ON SCHEMA` і `ON ALL TABLES` сюди не потрапляють: після їхнього ключового слова не йде TO/FROM.
 */
const TABLE_ACL =
  /^\s*(GRANT|REVOKE)\s+([A-Za-z, ]+?)\s+ON\s+(?:TABLE\s+)?"?([a-z_][a-z0-9_]*)"?\s+(?:TO|FROM)\s+([a-z_, ]+?)\s*;/gim;

function isRuntimeRole(value: string): value is RuntimeRole {
  return (RUNTIME_ROLES as readonly string[]).includes(value);
}

function parsePrivileges(raw: string): Privilege[] {
  const names = raw.split(',').map((name) => name.trim().toUpperCase());
  if (names.some((name) => name === 'ALL' || name === 'ALL PRIVILEGES')) {
    return [...PRIVILEGES];
  }
  return PRIVILEGES.filter((privilege) => names.includes(privilege));
}

/**
 * Стан, який задумали міграції. Відлік — повний DML для обох ролей: саме його дають default
 * privileges кожній новій таблиці. Далі оператори застосовуються в порядку міграцій.
 */
function expectedFromMigrations(): AclExpectation[] {
  const state = new Map<string, AclExpectation>();
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migration of migrations) {
    const file = join(MIGRATIONS_DIR, migration, 'migration.sql');
    if (!existsSync(file)) continue;

    for (const match of readFileSync(file, 'utf8').matchAll(TABLE_ACL)) {
      const [, verb, rawPrivileges, table, rawRoles] = match;
      if (!verb || !rawPrivileges || !table || !rawRoles) continue;

      const privileges = parsePrivileges(rawPrivileges);
      for (const role of rawRoles.split(',').map((name) => name.trim())) {
        if (!isRuntimeRole(role)) continue;

        const key = `${role}|${table}`;
        const entry = state.get(key) ?? { role, table, privileges: [...PRIVILEGES] };
        const next = new Set(entry.privileges);
        for (const privilege of privileges) {
          if (verb.toUpperCase() === 'REVOKE') {
            next.delete(privilege);
          } else {
            next.add(privilege);
          }
        }
        state.set(key, { role, table, privileges: PRIVILEGES.filter((p) => next.has(p)) });
      }
    }
  }
  return [...state.values()];
}

describe('Привілеї plane-ів після повторного db:roles', () => {
  const expectations = expectedFromMigrations();
  let db: Client;

  beforeAll(async () => {
    // Той самий виклик, що в global-setup, але ПІСЛЯ міграцій — так його запускає оператор на
    // живому стенді. Сьюти йдуть послідовно (--runInBand), тож вікно між широким GRANT і
    // повторним REVOKE сусіднім тестам не видно.
    execSync(`pnpm --filter @saas-skeleton/database db:roles -- --db ${TEST_DB_NAME}`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });

    db = new Client({ connectionString: buildTestDatabaseUrl() });
    await db.connect();
  }, 60_000);

  afterAll(async () => {
    await db.end();
  });

  it('обмеження читаються з міграцій (сьют не порожній)', () => {
    expect(expectations).toContainEqual({
      role: 'saas_app',
      table: 'platform_users',
      privileges: [],
    });
  });

  it('привілеї кожної ролі збігаються з тим, що лишили їй міграції', async () => {
    const mismatches: { role: string; table: string; expected: string[]; actual: string[] }[] = [];

    for (const { role, table, privileges } of expectations) {
      // Таблицю могла прибрати пізніша міграція — тоді й порівнювати нічого
      const exists = await db.query(
        `SELECT 1 WHERE to_regclass('public.' || quote_ident($1)) IS NOT NULL`,
        [table],
      );
      if ((exists.rowCount ?? 0) === 0) continue;

      const granted = await db.query<{ privilege: Privilege }>(
        `SELECT p AS privilege
           FROM unnest($3::text[]) AS p
          WHERE has_table_privilege($1::name, 'public.' || quote_ident($2), p)`,
        [role, table, [...PRIVILEGES]],
      );
      const actual = PRIVILEGES.filter((privilege) =>
        granted.rows.some((row) => row.privilege === privilege),
      );

      if (actual.join() !== privileges.join()) {
        mismatches.push({ role, table, expected: privileges, actual });
      }
    }

    expect(mismatches).toEqual([]);
  });
});
