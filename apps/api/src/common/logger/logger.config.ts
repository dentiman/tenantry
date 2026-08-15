import type { LoggerModuleAsyncParams } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { multistream } from 'pino';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createStream } from 'rotating-file-stream';
import {
  isDevelopment,
  logLevel,
  jsonLogPath,
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
        ? // Development: use transport targets (pretty console + files)
          {
            level: logLevel,
            genReqId,
            mixin: tenantMixin,
            serializers: customSerializers,
            redact: redactPaths,
            transport: {
              targets: [
                // Console: pretty format with colors
                {
                  target: 'pino-pretty',
                  level: logLevel,
                  options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss',
                    ignore: 'pid,hostname',
                  },
                },
                // File 1: JSON format (for parsing, AI, monitoring)
                {
                  target: 'pino/file',
                  level: logLevel,
                  options: {
                    destination: jsonLogPath,
                    mkdir: true,
                  },
                },
                // File 2: Pretty format (for humans, IDE)
                {
                  target: 'pino-pretty',
                  level: logLevel,
                  options: {
                    destination: prettyLogPath,
                    colorize: false,
                    translateTime: 'yyyy-mm-dd HH:MM:ss',
                    ignore: 'pid,hostname',
                    mkdir: true,
                  },
                },
              ],
            },
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
