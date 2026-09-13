import http from 'node:http';
import { loadRepoEnv } from './load-env';
import { buildTestDatabaseUrl, buildTestPlatformUrl } from './test-database';

// Першим рядком: усе нижче (тестові URL, дефолти) має бачити адреси з кореневого .env
loadRepoEnv();

// Node ≥19 тримає keep-alive у globalAgent увімкненим. У e2e це шкодить: кожен
// сьют піднімає СВІЙ Nest-застосунок і закриває його в afterAll, а supertest
// бере сокети зі спільного пулу — сокет до вже закритого сервера повертається
// наступному сьюту й дає транспортну помилку (`ECONNRESET`, `Parse Error:
// Expected HTTP/`) у випадковому тесті, що не має до неї стосунку.
http.globalAgent = new http.Agent({ keepAlive: false });

// setupFiles виконується в worker-і ДО імпорту модулів застосунку —
// PrismaService і все інше побачать уже тестовий DATABASE_URL
process.env.DATABASE_URL = buildTestDatabaseUrl();
// MT-2: SystemPrismaService (BYPASSRLS) теж мусить дивитись на ТЕСТОВУ БД —
// його дефолт вказує на dev, і без цього прямі доступи тестів чистили б dev-дані
process.env.PLATFORM_DATABASE_URL = buildTestPlatformUrl();

// Малий пул на застосунок: e2e піднімає десяток Nest-апок в ОДНОМУ процесі, і з
// дефолтними 10 конекшенами на кожен пул (× 2 — звичайний і системний клієнт)
// вони впираються в max_connections Postgres-а. Проявлялось як випадкові 503 у
// сусідніх сьютах, а не як помилка підключення
process.env.DATABASE_POOL_MAX ??= '3';

// RT-0: presence живе у Valkey, а не в БД, тому окремої «тестової БД» для неї немає —
// ізоляцію дає префікс ключів. Свій префікс на КОЖЕН jest-worker: інакше паралельні
// сьюти (і запущений поруч dev-api) ділили б один tenant-індекс і мели чужі leases.
process.env.REALTIME_KEY_PREFIX = `saas:rt:test:${String(process.pid)}`;
// REDIS_URL тут НЕ задаємо: адреса — з .env (loadRepoEnv), інакше дефолт застосунку
// (`redis.config.ts`, = docker-compose). Власний дефолт у тестах уже раз перебив .env

// AUTH-0: e2e ходять з ОДНОГО IP і в одному процесі (--runInBand) — лічильники
// throttler-а спільні для всіх сьютів у межах вікна. З бойовими порогами (5 логінів
// на хвилину) сотні тестів ловили б 429 у випадковому місці. Бойові значення явно
// задає лише rate-limit.e2e-spec.ts.
const RELAXED_LIMIT = '100000';
process.env.THROTTLE_DEFAULT_LIMIT_PER_MINUTE = RELAXED_LIMIT;
process.env.AUTH_LOGIN_LIMIT_PER_MINUTE = RELAXED_LIMIT;
process.env.AUTH_LOGIN_IP_LIMIT_PER_MINUTE = RELAXED_LIMIT;
process.env.AUTH_REFRESH_LIMIT_PER_MINUTE = RELAXED_LIMIT;
process.env.ACCOUNT_SENSITIVE_LIMIT_PER_HOUR = RELAXED_LIMIT;
