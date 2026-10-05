import { join } from 'node:path';
import { multistream, type Level } from 'pino';
import pretty from 'pino-pretty';
import { createStream } from 'rotating-file-stream';
import type { LoggerModuleAsyncParams } from 'nestjs-pino';

// Control plane: без tenant-CLS mixin — тут немає tenant-контексту принципово
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;

// cwd = apps/platform-api (pnpm --filter це гарантує)
const logsDir = join(process.cwd(), 'logs');

/**
 * Dev: консоль (pretty) + JSON-файл із ротацією за розміром. Без ротації `pino/file` писав
 * безкінечно — лог воркера (cron щохвилини) доростав до сотень мегабайтів. 10 МБ на файл,
 * два попередні поруч (`<дата>-NN-platform-api.log`) — максимум ~30 МБ на застосунок.
 * Прод пише в stdout, файли там не потрібні (збирає Docker).
 */
const devStream = (): ReturnType<typeof multistream> =>
  multistream([
    {
      level: logLevel,
      stream: pretty({
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      }),
    },
    {
      level: logLevel,
      stream: createStream('platform-api.log', { path: logsDir, size: '10M', maxFiles: 2 }),
    },
  ]);

export const loggerConfig: LoggerModuleAsyncParams = {
  useFactory: () => ({
    pinoHttp: {
      level: logLevel,
      // AUTH-0: `req.ip` Express-а (після trust proxy — з X-Forwarded-For) замість
      // адреси сокета, яка за nginx/swarm дорівнює балансувальнику
      serializers: {
        req: (req: Record<string, unknown>): Record<string, unknown> => ({
          ...req,
          ip: (req as { raw?: { ip?: unknown } }).raw?.ip ?? req.remoteAddress,
        }),
      },
      autoLogging: {
        ignore: (req): boolean => req.url === '/health' || req.url === '/api/health',
      },
      ...(isDevelopment ? { stream: devStream() } : {}),
    },
  }),
};
