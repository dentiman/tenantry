import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildAdminUrl, buildTestMigrateUrl, TEST_DB_NAME } from './test-database';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * Разово перед усіма сьютами:
 * 1) створює тестову БД (якщо немає) під суперюзером;
 * 2) MT-0: ролі saas_* + гранти в тестовій БД (`db:roles`, ідемпотентно) —
 *    покриває і CI, де docker-init не виконується;
 * 3) міграції під saas_migrator; самі тести ходять під saas_app (setup-env.ts) —
 *    інакше RLS (MT-2) на них не діятиме і тести брехатимуть.
 */
export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: buildAdminUrl() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DB_NAME,
    ]);
    if ((exists.rowCount ?? 0) === 0) {
      await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await client.end();
  }

  execSync(`pnpm --filter @saas-skeleton/database db:roles -- --db ${TEST_DB_NAME}`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  execSync('pnpm --filter @saas-skeleton/database db:migrate:deploy', {
    cwd: REPO_ROOT,
    env: { ...process.env, MIGRATE_DATABASE_URL: buildTestMigrateUrl() },
    stdio: 'inherit',
  });
}
