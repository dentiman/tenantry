import { join } from 'node:path';
import type { Level } from 'pino';
import type { LoggerModuleAsyncParams } from 'nestjs-pino';

// Control plane: без tenant-CLS mixin — тут немає tenant-контексту принципово
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;

// cwd = apps/platform-api (pnpm --filter це гарантує)
const jsonLogPath = join(process.cwd(), 'logs', 'platform-api.log');

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
      transport: isDevelopment
        ? {
            targets: [
              {
                target: 'pino-pretty',
                level: logLevel,
                options: {
                  colorize: true,
                  translateTime: 'yyyy-mm-dd HH:MM:ss',
                  ignore: 'pid,hostname',
                },
              },
              {
                target: 'pino/file',
                level: logLevel,
                options: { destination: jsonLogPath, mkdir: true },
              },
            ],
          }
        : undefined,
    },
  }),
};
