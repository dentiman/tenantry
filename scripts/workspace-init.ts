/**
 * Workspace slots (docs/workspace-slots.md): піднімає повністю ізольований dev-стек
 * для слота N — окремий docker-compose project, окремі порти (зсув +100·N), окрема БД,
 * власні секрети. Слот 0 — базовий checkout БЕЗ .env.local, цей скрипт для нього не
 * використовується.
 *
 * Запуск: pnpm ws:init [N]
 * - N не задано і .env.local вже є → повторно використовує той самий слот (ідемпотентно).
 * - N не задано і .env.local нема → перший слот 1..50, у якого всі порти вільні.
 * - N задано → саме цей слот (перезаписує .env.local, якщо існував).
 *
 * ЗАВЖДИ виконує db:reset (рішення користувача: чистий стан і на новому, і на вже
 * ініціалізованому слоті) — тому це теж ДЕСТРУКТИВНА команда відносно БД цього слота.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..');
const ENV_LOCAL_PATH = join(REPO_ROOT, '.env.local');
const MAX_SLOT_SEARCH = 50;
const PORT_WAIT_TIMEOUT_MS = 15_000;
const PORT_WAIT_RETRY_MS = 300;

const BASE_PORTS = {
  postgres: 5432,
  redis: 6379,
  s3: 8333,
  mailpitSmtp: 1025,
  mailpitUi: 8025,
  api: 3001,
  platform: 3002,
  web: 5173,
  platformWeb: 5174,
} as const;

type PortMap = Record<keyof typeof BASE_PORTS, number>;

function portsForSlot(n: number): PortMap {
  const shift = 100 * n;
  const entries = Object.entries(BASE_PORTS).map(([key, value]) => [key, value + shift]);
  return Object.fromEntries(entries) as PortMap;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port);
  });
}

async function slotPortsFree(n: number): Promise<boolean> {
  const ports = portsForSlot(n);
  const checks = await Promise.all(Object.values(ports).map((port) => isPortFree(port)));
  return checks.every(Boolean);
}

function readExistingSlot(): number | null {
  if (!existsSync(ENV_LOCAL_PATH)) return null;
  const content = readFileSync(ENV_LOCAL_PATH, 'utf8');
  const match = /^WORKSPACE_SLOT=(\d+)$/m.exec(content);
  return match ? Number(match[1]) : null;
}

async function resolveSlot(argSlot: number | undefined): Promise<number> {
  if (argSlot !== undefined) {
    if (!Number.isInteger(argSlot) || argSlot < 1) {
      throw new Error(
        'Слот 0 — базовий checkout без .env.local, ws:init для нього не потрібен. ' +
          'Вкажи ціле число ≥ 1.',
      );
    }
    return argSlot;
  }

  const existing = readExistingSlot();
  if (existing !== null) {
    console.log(`.env.local уже задає WORKSPACE_SLOT=${String(existing)} — перевикористовую слот.`);
    return existing;
  }

  for (let n = 1; n <= MAX_SLOT_SEARCH; n++) {
    if (await slotPortsFree(n)) return n;
  }
  throw new Error(
    `Не знайшлося вільного слота серед 1..${String(MAX_SLOT_SEARCH)} — звільни порти або вкажи номер вручну (pnpm ws:init <N>).`,
  );
}

function genSecret(): string {
  return randomBytes(32).toString('hex');
}

function buildEnv(n: number, ports: PortMap): Record<string, string> {
  const projectName = `saas-skeleton-${String(n)}`;
  const webOrigin = `http://localhost:${String(ports.web)}`;
  const platformWebOrigin = `http://localhost:${String(ports.platformWeb)}`;

  return {
    WORKSPACE_SLOT: String(n),
    COMPOSE_PROJECT_NAME: projectName,
    POSTGRES_PORT: String(ports.postgres),
    REDIS_PORT: String(ports.redis),
    S3_PORT: String(ports.s3),
    MAILPIT_SMTP_PORT: String(ports.mailpitSmtp),
    MAILPIT_UI_PORT: String(ports.mailpitUi),
    // apps/worker/src/mail/mailer.service.ts читає SMTP_PORT (дефолт 1025 — порт слота 0),
    // а не MAILPIT_SMTP_PORT (та лише для host-порту в docker-compose) — без цього воркер
    // слота N мовчки слав би листи через Mailpit слота 0
    SMTP_PORT: String(ports.mailpitSmtp),
    PORT: String(ports.api),
    PLATFORM_PORT: String(ports.platform),
    WEB_PORT: String(ports.web),
    PLATFORM_WEB_PORT: String(ports.platformWeb),
    DATABASE_URL: `postgresql://saas_app:saas_app@localhost:${String(ports.postgres)}/saas_skeleton`,
    MIGRATE_DATABASE_URL: `postgresql://saas_migrator:saas_migrator@localhost:${String(ports.postgres)}/saas_skeleton`,
    PLATFORM_DATABASE_URL: `postgresql://saas_platform:saas_platform@localhost:${String(ports.postgres)}/saas_skeleton`,
    POSTGRES_ADMIN_URL: `postgresql://saas:saas@localhost:${String(ports.postgres)}/postgres`,
    REDIS_URL: `redis://:saas-realtime@localhost:${String(ports.redis)}`,
    S3_ENDPOINT: `http://localhost:${String(ports.s3)}`,
    CORS_ALLOWED_ORIGINS: webOrigin,
    PLATFORM_CORS_ALLOWED_ORIGINS: platformWebOrigin,
    S3_CORS_ALLOWED_ORIGINS: webOrigin,
    JWT_SECRET: genSecret(),
    PLATFORM_JWT_SECRET: genSecret(),
  };
}

function writeEnvLocal(env: Record<string, string>): void {
  const header =
    `# Згенеровано pnpm ws:init (docs/workspace-slots.md) — ${new Date().toISOString()}\n` +
    `# Не редагувати руками: перезаписується щоразу при повторному ws:init.\n`;
  const body = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(ENV_LOCAL_PATH, header + body + '\n');
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Postgres не відповів на :${String(port)} за ${String(timeoutMs)}мс`));
          return;
        }
        setTimeout(attempt, PORT_WAIT_RETRY_MS);
      });
    };
    attempt();
  });
}

function run(command: string): void {
  console.log(`\n--- ${command} ---`);
  execSync(command, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Postgres-образ на першому старті з `docker-entrypoint-initdb.d` піднімає ТИМЧАСОВИЙ
 * сервер, ганяє init-скрипти, гасить його й рестартує вже фінальний — у це вікно порт
 * коротко приймає TCP і одразу рве конекшн (`waitForPort` цього не бачить, він перевіряє
 * лише сам факт TCP-accept). Тому `db:reset` ретраїмо, а не просто чекаємо довше:
 * команда повністю ідемпотентна (DROP IF EXISTS → CREATE → roles → migrate → seed).
 */
async function runDbResetWithRetry(maxAttempts: number, retryDelayMs: number): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run('pnpm db:reset');
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      console.log(
        `db:reset не пройшов (спроба ${String(attempt)}/${String(maxAttempts)}) — Postgres, ймовірно, ще рестартує після init-скриптів. Повторюю через ${String(retryDelayMs)}мс...`,
      );
      await sleep(retryDelayMs);
    }
  }
}

async function main(): Promise<void> {
  const argSlot = process.argv[2] ? Number(process.argv[2]) : undefined;
  const n = await resolveSlot(argSlot);
  const ports = portsForSlot(n);
  const env = buildEnv(n, ports);

  writeEnvLocal(env);
  Object.assign(process.env, env);

  console.log(`=== Слот ${String(n)}: піднімаю інфраструктуру (saas-skeleton-${String(n)}) ===`);
  run('docker compose --env-file .env.local -f docker/docker-compose.yml up -d');

  console.log(`Чекаю Postgres на :${String(ports.postgres)}...`);
  await waitForPort(ports.postgres, PORT_WAIT_TIMEOUT_MS);

  await runDbResetWithRetry(5, 2_000);

  console.log(`\n=== Слот ${String(n)} готовий ===`);
  console.log(`  web            http://localhost:${String(ports.web)}`);
  console.log(`  platform-web   http://localhost:${String(ports.platformWeb)}`);
  console.log(`  api Swagger    http://localhost:${String(ports.api)}/api/docs`);
  console.log(`  platform Swagger http://localhost:${String(ports.platform)}/api/docs`);
  console.log(`  Mailpit UI     http://localhost:${String(ports.mailpitUi)}`);
  console.log(
    '\nДалі в цьому checkout: pnpm api:dev / platform:dev / worker:dev / web:dev / platform:web:dev ' +
      '— усі підхоплять .env.local автоматично.',
  );
  console.log('Опустити слот: pnpm ws:down');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
