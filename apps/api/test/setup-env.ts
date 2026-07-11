import { buildTestDatabaseUrl } from './test-database';

// setupFiles виконується в worker-і ДО імпорту модулів застосунку —
// PrismaService і все інше побачать уже тестовий DATABASE_URL
process.env.DATABASE_URL = buildTestDatabaseUrl();
