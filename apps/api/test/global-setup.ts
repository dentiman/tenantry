import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildTestDatabaseUrl, TEST_DB_NAME } from './test-database';

/** Разово перед усіма сьютами: створює тестову БД (якщо немає) і застосовує міграції */
export default async function globalSetup(): Promise<void> {
  const testUrl = buildTestDatabaseUrl();

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
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

  execSync('pnpm --filter @saas-skeleton/database db:migrate:deploy', {
    cwd: join(__dirname, '..', '..', '..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
