// MT-0: runtime-роль (RLS діятиме на неї з MT-2 — тести мусять бігти під нею, інакше брешуть)
const DEFAULT_DATABASE_URL = 'postgresql://saas_app:saas_app@localhost:5432/saas_skeleton';
// Власник схеми — тільки для migrate у globalSetup
const DEFAULT_MIGRATE_URL = 'postgresql://saas_migrator:saas_migrator@localhost:5432/saas_skeleton';
// Суперюзер — створення тестової БД і ролей (globalSetup)
const DEFAULT_ADMIN_URL = 'postgresql://saas:saas@localhost:5432/postgres';

export const TEST_DB_NAME = 'saas_skeleton_test';

function withTestDb(base: string): string {
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/**
 * URL тестової БД: той самий Postgres-інстанс, що й dev, але окрема база —
 * e2e-тести чистять таблиці і НЕ повинні чіпати dev-дані (seed-адміна тощо).
 */
export function buildTestDatabaseUrl(): string {
  return withTestDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}

/** Той самий інстанс/база, але під saas_migrator — для migrate deploy у globalSetup */
export function buildTestMigrateUrl(): string {
  return withTestDb(process.env.MIGRATE_DATABASE_URL ?? DEFAULT_MIGRATE_URL);
}

// MT-2: saas_platform (BYPASSRLS) — для SystemPrismaService у тестах (setup-env.ts
// ПЕРЕЗАПИСУЄ PLATFORM_DATABASE_URL на тестову БД: дефолт вказує на dev — інакше
// прямі доступи тестів чистили б dev-дані)
const DEFAULT_PLATFORM_URL =
  'postgresql://saas_platform:saas_platform@localhost:5432/saas_skeleton';

export function buildTestPlatformUrl(): string {
  return withTestDb(process.env.PLATFORM_DATABASE_URL ?? DEFAULT_PLATFORM_URL);
}

/** Суперюзер для CREATE DATABASE / db:roles (адмін-база postgres) */
export function buildAdminUrl(): string {
  return process.env.POSTGRES_ADMIN_URL ?? DEFAULT_ADMIN_URL;
}
