const DEFAULT_DATABASE_URL = 'postgresql://saas:saas@localhost:5432/saas_skeleton';

export const TEST_DB_NAME = 'saas_skeleton_test';

/**
 * URL тестової БД: той самий Postgres-інстанс, що й dev, але окрема база —
 * e2e-тести чистять таблиці і НЕ повинні чіпати dev-дані (seed-адміна тощо).
 */
export function buildTestDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}
