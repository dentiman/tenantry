/**
 * Dev-приймач помилок фронтенду (docs/observability.md §5): плагін Vite dev-сервера, який
 * приймає звіти `reportError` і дописує їх JSON-рядками в `apps/<app>/logs/<service>.log` — у
 * тому самому форматі полів, що й бекенд, тож `pnpm logs:trace` показує браузер і сервер разом.
 *
 * Свідомо НЕ endpoint API: у збірці його не існує (`apply: 'serve'`), публічної поверхні в
 * проді не додає. На стендах звіти піде приймати окремий збирач (Sentry/Faro) — тоді міняється
 * лише `error-reporting.ts` застосунку.
 *
 * Як і `chunking.ts`, імпортується з `vite.config.ts` ВІДНОСНИМ шляхом і не входить в `exports`.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** Те саме значення — у `libs/ui/src/lib/dev-log-sink.ts` (клієнт цей файл імпортувати не може) */
const CLIENT_LOG_PATH = '/__client-log';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface ClientLogSinkOptions {
  /** `web` / `platform-web`: поле `service.name` і імʼя файлу */
  readonly service: string;
  /** Тека застосунку (`__dirname` його vite.config) */
  readonly appDir: string;
}

interface DevServerLike {
  middlewares: {
    use(
      path: string,
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
    ): void;
  };
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : undefined;
}

/** Лише відомі поля: тіло приходить із браузера, у лог воно не переноситься як є */
export function toLogRecord(service: string, body: unknown, now: number): Record<string, unknown> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const error = (
    typeof input.error === 'object' && input.error !== null ? input.error : {}
  ) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    level: 50,
    time: now,
    'service.name': service,
    'deployment.environment.name': 'development',
    'host.name': hostname(),
    context: text(input.source, 40) ?? 'app',
    msg: text(error.message, 2000) ?? 'Client error',
    err: {
      type: text(error.type, 200) ?? 'Error',
      message: text(error.message, 2000) ?? '',
      stack: text(error.stack, 8000) ?? '',
    },
  };
  const optional: Record<string, unknown> = {
    trace_id: /^[0-9a-f]{32}$/.test(String(input.traceId)) ? input.traceId : undefined,
    'user.id': text(input.userId, 64),
    'service.version': text(input.version, 64),
    'url.path': text(input.route, 500),
    detail: text(input.detail, 4000),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

export function clientLogSink(options: ClientLogSinkOptions): {
  name: string;
  apply: 'serve';
  configureServer(server: DevServerLike): void;
} {
  const logsDir = join(options.appDir, 'logs');
  const file = join(logsDir, `${options.service}.log`);

  const append = (record: Record<string, unknown>): void => {
    mkdirSync(logsDir, { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) {
      renameSync(file, join(logsDir, `previous-${options.service}.log`));
    }
    appendFileSync(file, `${JSON.stringify(record)}\n`);
  };

  return {
    name: 'client-log-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(CLIENT_LOG_PATH, (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        req.on('end', () => {
          try {
            if (size <= MAX_BODY_BYTES) {
              const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              append(toLogRecord(options.service, body, Date.now()));
            }
          } catch {
            // зіпсований звіт не має ламати dev-сервер
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
