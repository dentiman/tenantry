import { join } from 'node:path';
import type { Level } from 'pino';
import type { LoggerModuleAsyncParams } from 'nestjs-pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;

// cwd = apps/worker (pnpm --filter це гарантує)
const jsonLogPath = join(process.cwd(), 'logs', 'worker.log');

export const loggerConfig: LoggerModuleAsyncParams = {
  useFactory: () => ({
    pinoHttp: {
      level: logLevel,
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
