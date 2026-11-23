/**
 * Читання dev-логів усіх застосунків одразу (docs/observability.md §4). Офлайн: лише файли
 * `apps/<app>/logs/*.log` поточного checkout-а — у worktree зі своїм слотом це його ж логи.
 *
 *   pnpm logs:trace <trace-id>            усі записи однієї операції, за часом, з усіх процесів
 *   pnpm logs:errors [--since 15m]        помилки (error/fatal) за останній проміжок
 *                    [--warn]             … разом із warn
 *   --json                                сирі JSON-рядки замість компактного вигляду
 *
 * trace-id — це `requestId` з відповіді API / тоста помилки, `correlationId` конверта джоби або
 * trace-id із заголовка `traceparent`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const APPS = ['api', 'platform-api', 'worker', 'web', 'platform-web'];

type LogRecord = Record<string, unknown> & { time?: number; level?: number; msg?: string };

const LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

/** JSON-файли логів: поточний і ротовані (`<дата>-NN-<service>.log`); pretty й gzip — ні */
function logFiles(): string[] {
  const files: string[] = [];
  for (const app of APPS) {
    const dir = join(ROOT, 'apps', app, 'logs');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.log') && !name.endsWith('-pretty.log')) {
        files.push(join(dir, name));
      }
    }
  }
  return files;
}

function readRecords(keep: (line: string) => boolean): LogRecord[] {
  const records: LogRecord[] = [];
  for (const file of logFiles()) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      // Дешевий фільтр по рядку до JSON.parse: файли — десятки мегабайтів
      if (line === '' || !keep(line)) continue;
      try {
        records.push(JSON.parse(line) as LogRecord);
      } catch {
        // обірваний рядок на межі ротації
      }
    }
  }
  return records.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function formatRecord(record: LogRecord): string {
  const time = new Date(record.time ?? 0).toISOString().slice(11, 23);
  const level = (LEVELS[record.level ?? 30] ?? String(record.level)).padEnd(5);
  const service = (text(record['service.name']) ?? '?').padEnd(12);
  const context = text(record.context);
  const parts = [`${time} ${level} ${service}`, context ? `[${context}]` : '', record.msg ?? ''];

  const details: string[] = [];
  for (const key of ['trace_id', 'user.id', 'tenant.id', 'messaging.destination.name']) {
    const value = text(record[key]);
    if (value) details.push(`${key}=${value}`);
  }
  const lines = [parts.filter((part) => part !== '').join(' ')];
  if (details.length > 0) lines.push(`    ${details.join(' ')}`);

  const err = record.err as { type?: string; message?: string; stack?: string } | undefined;
  if (err && typeof err === 'object') {
    lines.push(`    ${err.type ?? 'Error'}: ${err.message ?? ''}`);
    // Перші кадри стека — щоб побачити місце, не заливаючи вивід
    for (const frame of (err.stack ?? '').split('\n').slice(1, 5)) {
      lines.push(`    ${frame.trim()}`);
    }
  }
  return lines.join('\n');
}

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Некоректний проміжок "${value}": очікується, наприклад, 30s, 15m, 2h, 1d`);
  }
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

function print(records: LogRecord[], json: boolean): void {
  for (const record of records) {
    console.log(json ? JSON.stringify(record) : formatRecord(record));
  }
  console.error(`— ${String(records.length)} запис(ів) із ${String(logFiles().length)} файл(ів)`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string', default: '15m' },
    warn: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const [command, argument] = positionals;

if (command === 'trace' && argument) {
  const id = argument.toLowerCase();
  // Підрядок, а не лише поле `trace_id`: id є також у `req.id` і в конверті джоби
  print(
    readRecords((line) => line.includes(id)),
    values.json,
  );
} else if (command === 'errors') {
  const from = Date.now() - parseDuration(values.since);
  const minLevel = values.warn ? 40 : 50;
  print(
    readRecords((line) => !line.includes('"level":30') && !line.includes('"level":20')).filter(
      (record) => (record.level ?? 0) >= minLevel && (record.time ?? 0) >= from,
    ),
    values.json,
  );
} else {
  console.error('Використання: pnpm logs:trace <trace-id> | pnpm logs:errors [--since 15m] [--warn] [--json]');
  process.exit(1);
}
