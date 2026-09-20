import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const REPO_ROOT = resolve(__dirname, '..', '..');
const ENV_LOCAL_PATH = join(REPO_ROOT, '.env.local');
const inheritedKeys = new Set(Object.keys(process.env));

function loadEnv(path: string): void {
  if (!existsSync(path)) return;

  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    // Явне оточення команди (CI/e2e/ручний override) сильніше за файли. Між файлами
    // .env.local завантажується другим і тому перебиває базовий .env.
    if (!inheritedKeys.has(key)) process.env[key] = value;
  }
}

function assertInitializedWorktree(): void {
  const gitPath = join(REPO_ROOT, '.git');
  const isLinkedWorktree = existsSync(gitPath) && statSync(gitPath).isFile();
  const offlinePrismaCommands = new Set(['format', 'generate', 'validate']);
  const isOfflinePrismaCommand = process.argv.some((arg) => offlinePrismaCommands.has(arg));
  if (
    isLinkedWorktree &&
    !existsSync(ENV_LOCAL_PATH) &&
    !process.env.WORKSPACE_SLOT &&
    !isOfflinePrismaCommand
  ) {
    throw new Error(
      'Database command refused: this linked git worktree has no .env.local. ' +
        'Run `pnpm ws:init` first so Prisma cannot fall back to workspace slot 0.',
    );
  }
}

function assertSlotDatabasePorts(): void {
  const slot = Number(process.env.WORKSPACE_SLOT ?? '0');
  if (!Number.isInteger(slot) || slot <= 0) return;

  const expectedPort = String(5432 + 100 * slot);
  if (process.env.POSTGRES_PORT !== expectedPort) {
    throw new Error(
      `WORKSPACE_SLOT=${String(slot)} requires POSTGRES_PORT=${expectedPort}; ` +
        `received ${process.env.POSTGRES_PORT ?? '(unset)'}.`,
    );
  }

  for (const key of [
    'DATABASE_URL',
    'MIGRATE_DATABASE_URL',
    'PLATFORM_DATABASE_URL',
    'POSTGRES_ADMIN_URL',
  ] as const) {
    const value = process.env[key];
    if (!value) continue;
    const url = new URL(value);
    if (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      (url.port || '5432') !== expectedPort
    ) {
      throw new Error(
        `${key} points to localhost:${url.port || '5432'}, but workspace slot ${String(slot)} ` +
          `must use localhost:${expectedPort}.`,
      );
    }
  }
}

assertInitializedWorktree();
loadEnv(join(REPO_ROOT, '.env'));
loadEnv(ENV_LOCAL_PATH);
assertSlotDatabasePorts();
