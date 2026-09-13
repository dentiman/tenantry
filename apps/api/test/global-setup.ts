import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { resolveRedisUrl } from '../src/redis/redis.config';
import { loadRepoEnv } from './load-env';
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
  // globalSetup живе в окремому контексті від setupFiles — .env вантажимо і тут
  loadRepoEnv();
  await assertValkeyReachable();

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

/**
 * Valkey — обов'язкова залежність e2e (presence, throttler). Без цієї перевірки хибна
 * адреса проявлялась як `Stream isn't writeable` у десятках тестів поспіль, і причину
 * (порт у .env проти дефолту) доводилось вгадувати. Тут — одна помилка з адресою.
 */
async function assertValkeyReachable(): Promise<void> {
  const url = resolveRedisUrl();
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: (): null => null,
  });
  // Справжня причина (ECONNREFUSED, WRONGPASS) приходить подією; без слухача ioredis
  // ще й друкує її як «Unhandled error event»
  let lastError: Error | undefined;
  redis.on('error', (error: Error): void => {
    lastError = error;
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    const masked = url.replace(/\/\/[^@]*@/, '//***@');
    const cause = lastError ?? error;
    const reason =
      cause instanceof AggregateError
        ? cause.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')
        : cause instanceof Error
          ? cause.message
          : String(cause);
    throw new Error(
      `e2e: Valkey is not reachable at ${masked} (${reason}). ` +
        'Tests read REDIS_URL from the environment, then the root .env/.env.local, then the ' +
        'docker-compose default. Start it with `pnpm docker:up` or fix REDIS_URL (and REDIS_PORT) in .env.',
    );
  } finally {
    redis.disconnect();
  }
}
