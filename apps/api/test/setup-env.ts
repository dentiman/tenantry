import { buildTestDatabaseUrl, buildTestPlatformUrl } from './test-database';

// setupFiles виконується в worker-і ДО імпорту модулів застосунку —
// PrismaService і все інше побачать уже тестовий DATABASE_URL
process.env.DATABASE_URL = buildTestDatabaseUrl();
// MT-2: SystemPrismaService (BYPASSRLS) теж мусить дивитись на ТЕСТОВУ БД —
// його дефолт вказує на dev, і без цього прямі доступи тестів чистили б dev-дані
process.env.PLATFORM_DATABASE_URL = buildTestPlatformUrl();

// RT-0: presence живе у Valkey, а не в БД, тому окремої «тестової БД» для неї немає —
// ізоляцію дає префікс ключів. Свій префікс на КОЖЕН jest-worker: інакше паралельні
// сьюти (і запущений поруч dev-api) ділили б один tenant-індекс і мели чужі leases.
process.env.REALTIME_KEY_PREFIX = `saas:rt:test:${String(process.pid)}`;
// Локально можна не задавати: дефолт збігається з docker-compose (див. .env.example)
process.env.REDIS_URL ??= 'redis://:saas-realtime@localhost:6379';
