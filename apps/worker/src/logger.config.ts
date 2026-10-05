import { join } from 'node:path';
import { multistream, type Level } from 'pino';
import pretty from 'pino-pretty';
import { createStream } from 'rotating-file-stream';
import type { LoggerModuleAsyncParams } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;

// cwd = apps/worker (pnpm --filter це гарантує)
const logsDir = join(process.cwd(), 'logs');

/**
 * Dev: консоль (pretty) + JSON-файл із ротацією за розміром. Без ротації `pino/file` писав
 * безкінечно — лог воркера (cron щохвилини) доростав до сотень мегабайтів. 10 МБ на файл,
 * два попередні поруч (`<дата>-NN-worker.log`) — максимум ~30 МБ на застосунок.
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
      stream: createStream('worker.log', { path: logsDir, size: '10M', maxFiles: 2 }),
    },
  ]);

export const loggerConfig: LoggerModuleAsyncParams = {
  inject: [ClsService],
  useFactory: (cls: ClsService) => ({
    pinoHttp: {
      level: logLevel,
      // MT-1: tenantId (з CLS, піднятого реєстратором із payload джоби) у кожен лог-запис
      mixin: (): Record<string, string> => {
        const tenantId = cls.isActive() ? cls.get<string | undefined>('tenantId') : undefined;
        return tenantId ? { tenantId } : {};
      },
      ...(isDevelopment ? { stream: devStream() } : {}),
    },
  }),
};
