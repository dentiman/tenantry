/**
 * MT-0: ідемпотентне створення ролей БД і грантів (docs/multi-tenancy-plan.md §3).
 *
 * Той самий ефект, що docker/postgres/init/01-roles.sql, але для БД, які вже існують:
 * наявний dev-volume (init-скрипти Postgres виконуються лише на порожньому volume),
 * CI-сервіс і тестова база e2e (globalSetup). Безпечний до повторних запусків.
 *
 * Підключення:
 *  - POSTGRES_ADMIN_URL — суперюзер (дефолт: postgresql://saas:saas@localhost:5432/postgres);
 *  - цільова БД — з DATABASE_URL (pathname) або аргументу --db <name>.
 */
import { Client } from 'pg';

const DEFAULT_ADMIN_URL = 'postgresql://saas:saas@localhost:5432/postgres';
const DEFAULT_DATABASE_URL = 'postgresql://saas:saas@localhost:5432/saas_skeleton';

const ROLES = [
  { name: 'saas_migrator', options: "LOGIN PASSWORD 'saas_migrator' CREATEDB" },
  { name: 'saas_app', options: "LOGIN PASSWORD 'saas_app'" },
  { name: 'saas_platform', options: "LOGIN PASSWORD 'saas_platform' BYPASSRLS" },
] as const;

function targetDbName(): string {
  const argIndex = process.argv.indexOf('--db');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  return url.pathname.replace(/^\//, '');
}

function adminUrlFor(dbName: string): string {
  const url = new URL(process.env.POSTGRES_ADMIN_URL ?? DEFAULT_ADMIN_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Кластерний рівень: ролі (спільні для всіх БД інстанса) */
async function ensureRoles(): Promise<void> {
  const client = new Client({ connectionString: adminUrlFor('postgres') });
  await client.connect();
  try {
    for (const role of ROLES) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]);
      if ((exists.rowCount ?? 0) === 0) {
        await client.query(`CREATE ROLE ${role.name} ${role.options}`);
        console.log(`Created role: ${role.name}`);
      }
    }
  } finally {
    await client.end();
  }
}

/** Рівень БД: власність схеми, гранти на наявні об'єкти, default privileges, pgboss */
async function ensureDbGrants(dbName: string): Promise<void> {
  const client = new Client({ connectionString: adminUrlFor(dbName) });
  await client.connect();
  try {
    await client.query('GRANT USAGE ON SCHEMA public TO saas_app, saas_platform');
    await client.query('ALTER SCHEMA public OWNER TO saas_migrator');

    // Наявні таблиці public → власник migrator (щоб міграції могли їх ALTER-ити,
    // а FORCE RLS у MT-2 діяв передбачувано)
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    for (const { tablename } of tables.rows) {
      await client.query(`ALTER TABLE public."${tablename}" OWNER TO saas_migrator`);
    }
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO saas_app, saas_platform',
    );
    await client.query(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_app, saas_platform',
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO saas_app, saas_platform`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO saas_app, saas_platform`,
    );

    // pg-boss: схема належить runtime-ролі (він сам мігрує свої таблиці при старті).
    // CREATE на database — бо install-шлях pg-boss робить CREATE SCHEMA IF NOT EXISTS,
    // а Postgres перевіряє ACL до перевірки існування схеми
    await client.query(`GRANT CREATE ON DATABASE "${dbName}" TO saas_app`);
    await client.query('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION saas_app');
    await client.query('ALTER SCHEMA pgboss OWNER TO saas_app');
    const bossTables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'pgboss'`,
    );
    for (const { tablename } of bossTables.rows) {
      await client.query(`ALTER TABLE pgboss."${tablename}" OWNER TO saas_app`);
    }
    await client.query('GRANT USAGE ON SCHEMA pgboss TO saas_platform');
    await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO saas_platform');
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE saas_app IN SCHEMA pgboss
         GRANT SELECT ON TABLES TO saas_platform`,
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const dbName = targetDbName();
  await ensureRoles();
  await ensureDbGrants(dbName);
  console.log(`Roles and grants ensured for database: ${dbName}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
