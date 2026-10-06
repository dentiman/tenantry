import './load-root-env';
import { defineConfig } from 'prisma/config';

// MT-0: CLI (migrate/studio/push) ходить під ВЛАСНИКОМ схеми saas_migrator, НЕ під runtime-роллю.
// Свідомо НЕ фолбечимо на DATABASE_URL: міграція під saas_app має впасти помилкою прав,
// а не пройти тихо під неправильною роллю.
const DEFAULT_MIGRATE_URL = 'postgresql://saas_migrator:saas_migrator@localhost:5432/saas_skeleton';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['MIGRATE_DATABASE_URL'] ?? DEFAULT_MIGRATE_URL,
  },
});
