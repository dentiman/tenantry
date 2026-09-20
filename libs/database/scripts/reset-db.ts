/**
 * DEV-ONLY: повний ресет БД до порожнього стану — DROP DATABASE → CREATE DATABASE →
 * ролі/гранти → міграції (RLS-політики, resolve_tenant) → сід (дефолтні tenant/юзери).
 * Той самий цикл, що вручну ганяли під час MT-фаз — docs/multi-tenancy-architecture.md,
 * розділ «Seed-дані за замовчуванням».
 *
 * СВІДОМО НЕ `prisma migrate reset`: той дропає/перестворює схему `public`, а
 * `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` (ensure-roles.ts) прив'язаний до OID
 * схеми — новий OID після перестворення інвалідує грант, і saas_app лишається без
 * прав на щойно замігровані таблиці. DROP/CREATE цілої DATABASE цього уникає: ролі й
 * default-privileges — кластерний стан, який ensure-roles.ts перевстановлює нижче
 * явно й ідемпотентно, а не покладається на те, що Prisma його збереже.
 *
 * ДЕСТРУКТИВНО: видаляє ВСІ дані цільової БД без підтвердження. Відмовляється
 * працювати проти нелокального хоста — це запобіжник, не заміна обережності.
 *
 * Запуск: pnpm db:reset (з кореня) або pnpm --filter @saas-skeleton/database db:reset
 */
import '../load-root-env';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

const DEFAULT_ADMIN_URL = 'postgresql://saas:saas@localhost:5432/postgres';
const DEFAULT_DATABASE_URL = 'postgresql://saas_app:saas_app@localhost:5432/saas_skeleton';
const REPO_ROOT = join(__dirname, '..', '..', '..');

function targetDbName(): string {
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  return url.pathname.replace(/^\//, '');
}

function adminUrl(): string {
  return process.env.POSTGRES_ADMIN_URL ?? DEFAULT_ADMIN_URL;
}

function assertLocalHost(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    console.error(
      `db:reset відмовляється працювати проти хоста "${hostname}". ` +
        'Це деструктивна dev-команда (DROP DATABASE) — тільки для localhost.',
    );
    process.exit(1);
  }
}

async function dropAndCreate(dbName: string): Promise<void> {
  const admin = adminUrl();
  assertLocalHost(admin);

  const adminDbUrl = new URL(admin);
  adminDbUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminDbUrl.toString() });
  await client.connect();
  try {
    console.log(`Dropping database "${dbName}" (if exists)...`);
    // WITH (FORCE) — Postgres 13+: розриває активні конекшени (наш dev-стек на 17)
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    console.log(`Creating database "${dbName}"...`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

function run(script: string): void {
  console.log(`\n--- ${script} ---`);
  execSync(`pnpm --filter @saas-skeleton/database ${script}`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

async function main(): Promise<void> {
  const dbName = targetDbName();
  console.log(`=== db:reset: "${dbName}" ===`);

  await dropAndCreate(dbName);
  run('db:roles');
  run('db:migrate:deploy');
  run('db:seed');

  console.log(`\n=== "${dbName}" готова: свіжа схема + дефолтні сід-дані ===`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
