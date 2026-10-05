import type { LoggerModuleAsyncParams } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { multistream } from 'pino';
import pretty from 'pino-pretty';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createStream } from 'rotating-file-stream';
import {
  isDevelopment,
  logLevel,
  jsonLogPath,
  logsDir,
  prettyLogPath,
  redactPaths,
} from './logger.constants';
import { customSerializers } from './logger.serializers';

// Create rotating file stream for production (only if not in development)
const createRotatingStream = (): ReturnType<typeof createStream> | null => {
  if (isDevelopment) {
    return null;
  }
  return createStream(jsonLogPath, {
    size: '10M', // Rotate when file reaches 10MB
    interval: '1d', // Rotate daily
    maxFiles: 30, // Keep 30 files (30 days of logs)
    compress: 'gzip', // Compress rotated files to .gz
  });
};

const rotatingStream = createRotatingStream();

/**
 * Dev: консоль (pretty) + `api.log` (JSON) + `api-pretty.log` (для людини й IDE), обидва
 * файли з ротацією за розміром. Без неї `pino/file` писав безкінечно — сотні мегабайтів за
 * кілька днів dev-стеку. 10 МБ на файл, два попередні поруч — `pnpm logs:tail` і далі
 * дивиться в той самий `api-pretty.log`.
 */
const devStream = (): ReturnType<typeof multistream> => {
  const devFile = (name: string): ReturnType<typeof createStream> =>
    createStream(name, { path: logsDir, size: '10M', maxFiles: 2 });
  const prettyOptions = { translateTime: 'yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' };
  return multistream([
    { level: logLevel, stream: pretty({ ...prettyOptions, colorize: true }) },
    { level: logLevel, stream: devFile(basename(jsonLogPath)) },
    {
      level: logLevel,
      stream: pretty({
        ...prettyOptions,
        colorize: false,
        destination: devFile(basename(prettyLogPath)),
      }),
    },
  ]);
};

/**
 * Дефолт pino-http — лічильник, що починається з 1 на КОЖНОМУ процесі: після рестарту
 * і на другій репліці id повторюються. Для ApiError.requestId це було терпимо, але цей
 * же id тепер їде як correlationId у конверті повідомлення (EDA-1) і осідає в
 * довговічних job-рядках — там колізії роблять кореляцію ланцюга безглуздою.
 *
 * Вхідний X-Request-Id поважаємо: якщо перед API стоїть проксі/шлюз зі своїм
 * трейс-id, ланцюг лишається наскрізним.
 */
const genReqId = (req: IncomingMessage): string => {
  const incoming = req.headers['x-request-id'];
  const header = Array.isArray(incoming) ? incoming[0] : incoming;
  return header && header.length > 0 ? header : randomUUID();
};

export const loggerConfig: LoggerModuleAsyncParams = {
  inject: [ClsService],
  useFactory: (cls: ClsService) => {
    // MT-1: tenantId у КОЖЕН лог-запис (mixin, не customProps — покриває і this.logger.*)
    const tenantMixin = (): Record<string, string> => {
      const tenantId = cls.isActive() ? cls.get<string | undefined>('tenantId') : undefined;
      return tenantId ? { tenantId } : {};
    };
    return {
      pinoHttp: isDevelopment
        ? // Development: pretty console + rotating files (devStream)
          {
            level: logLevel,
            genReqId,
            mixin: tenantMixin,
            serializers: customSerializers,
            redact: redactPaths,
            stream: devStream(),
            autoLogging: {
              ignore: (req): boolean => req.url === '/health' || req.url === '/api/health',
            },
            customSuccessMessage: (req, res): string => {
              return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)}`;
            },
            customErrorMessage: (req, res, err): string => {
              return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)} - ${err.message}`;
            },
          }
        : // Production: use multistream with rotating file
          {
            level: logLevel,
            genReqId,
            mixin: tenantMixin,
            serializers: customSerializers,
            redact: redactPaths,
            stream: multistream([
              { stream: process.stdout }, // stdout
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              { stream: rotatingStream! }, // rotating file with compression (safe: only used in production)
            ]),
            autoLogging: {
              ignore: (req): boolean => req.url === '/health' || req.url === '/api/health',
            },
            customSuccessMessage: (req, res): string => {
              return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)}`;
            },
            customErrorMessage: (req, res, err): string => {
              return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)} - ${err.message}`;
            },
          },
    };
  },
};
