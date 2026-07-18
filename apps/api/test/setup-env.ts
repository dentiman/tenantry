import { buildTestDatabaseUrl, buildTestPlatformUrl } from './test-database';

// setupFiles виконується в worker-і ДО імпорту модулів застосунку —
// PrismaService і все інше побачать уже тестовий DATABASE_URL
process.env.DATABASE_URL = buildTestDatabaseUrl();
// MT-2: SystemPrismaService (BYPASSRLS) теж мусить дивитись на ТЕСТОВУ БД —
// його дефолт вказує на dev, і без цього прямі доступи тестів чистили б dev-дані
process.env.PLATFORM_DATABASE_URL = buildTestPlatformUrl();
