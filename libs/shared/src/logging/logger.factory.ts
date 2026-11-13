import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ClsService } from 'nestjs-cls';
import type { LoggerModuleAsyncParams } from 'nestjs-pino';
import { multistream, type DestinationStream, type Level, type StreamEntry } from 'pino';
import pretty from 'pino-pretty';
import { createStream } from 'rotating-file-stream';
import { TENANT_ID_KEY } from '@saas-skeleton/database';
import { LOG_CONTEXT, LOG_FIELDS } from './log-fields';
import { REDACT_PATHS, logSerializers } from './log-redaction';
import { TRACEPARENT_HEADER, newTraceId, traceIdFromTraceparent } from './trace-context';

export interface LoggerFactoryOptions {
  /** Імʼя процесу: поле `service.name` кожного запису й імʼя лог-файлу */
  readonly service: string;
}

/**
 * id запиту = trace-id із вхідного `traceparent` (його ставить фронтенд або проксі) чи новий.
 * Формат перевіряється: значення їде в `ApiError.requestId`, у конверт повідомлення і в
 * довговічні job-рядки, тож довільний рядок від клієнта сюди потрапити не повинен.
 */
export function genReqId(req: IncomingMessage): string {
  return traceIdFromTraceparent(req.headers[TRACEPARENT_HEADER]) ?? newTraceId();
}

function serviceVersion(): string | undefined {
  const build = process.env.APP_BUILD_NUMBER;
  const commit = process.env.APP_GIT_SHA;
  if (build && commit) {
    return `${build}+${commit}`;
  }
  return build ?? commit ?? undefined;
}

/** Поля процесу, однакові в кожному записі (замість дефолтних `pid`/`hostname` pino) */
export function baseFields(service: string, isDevelopment: boolean): Record<string, unknown> {
  const version = serviceVersion();
  return {
    [LOG_FIELDS.serviceName]: service,
    ...(version ? { [LOG_FIELDS.serviceVersion]: version } : {}),
    [LOG_FIELDS.environment]:
      process.env.APP_ENV ?? (isDevelopment ? 'development' : 'production'),
    [LOG_FIELDS.hostName]: hostname(),
    [LOG_FIELDS.processPid]: process.pid,
  };
}

/**
 * Контекст операції в КОЖЕН запис (mixin, а не customProps pino-http: він покриває і
 * `this.logger.*` сервісів, і воркер без HTTP, і значення, відомі лише після guard-а).
 */
export function contextMixin(cls: ClsService): () => Record<string, string> {
  return () => {
    if (!cls.isActive()) {
      return {};
    }
    const fields: Record<string, string> = {};
    const traceId = cls.get<string | undefined>(LOG_CONTEXT.traceId);
    const tenantId = cls.get<string | undefined>(TENANT_ID_KEY);
    const userId = cls.get<string | undefined>(LOG_CONTEXT.userId);
    if (traceId) {
      fields[LOG_FIELDS.traceId] = traceId;
    }
    if (tenantId) {
      fields[LOG_FIELDS.tenantId] = tenantId;
    }
    if (userId) {
      fields[LOG_FIELDS.userId] = userId;
    }
    return fields;
  };
}

/**
 * Dev: консоль (pretty) + `<service>.log` (JSON — для `jq`, агентів і скриптів) +
 * `<service>-pretty.log` (для людини й IDE). Усі файли з ротацією за розміром: без неї лог
 * (cron воркера щохвилини) доростав до сотень мегабайтів.
 */
function devStream(service: string, level: Level, logsDir: string): DestinationStream {
  const file = (name: string): ReturnType<typeof createStream> =>
    createStream(name, { path: logsDir, size: '10M', maxFiles: 2 });
  const prettyOptions = {
    translateTime: 'yyyy-mm-dd HH:MM:ss',
    ignore: [LOG_FIELDS.hostName, LOG_FIELDS.processPid, LOG_FIELDS.environment].join(','),
  };
  const streams: StreamEntry[] = [
    { level, stream: pretty({ ...prettyOptions, colorize: true }) },
    { level, stream: file(`${service}.log`) },
    {
      level,
      stream: pretty({
        ...prettyOptions,
        colorize: false,
        destination: file(`${service}-pretty.log`),
      }),
    },
  ];
  return multistream(streams);
}

/**
 * Prod: лише stdout (збирає оркестратор). Файл — opt-in через `LOG_FILE=1` для сценарію
 * «гола VM без оркестрації»: 10 МБ або доба на файл, 30 файлів, gzip.
 */
function prodStream(service: string, logsDir: string): DestinationStream | undefined {
  if (process.env.LOG_FILE !== '1') {
    return undefined;
  }
  const streams: StreamEntry[] = [
    { stream: process.stdout },
    {
      stream: createStream(`${service}.log`, {
        path: logsDir,
        size: '10M',
        interval: '1d',
        maxFiles: 30,
        compress: 'gzip',
      }),
    },
  ];
  return multistream(streams);
}

const isHealthCheck = (req: IncomingMessage): boolean =>
  req.url === '/health' || req.url === '/api/health';

/**
 * ЄДИНИЙ конфіг логера для api, platform-api і worker: однакові поля, редагування секретів,
 * id запиту й потоки. Потребує глобального `ClsModule` у застосунку (у tenant-процесах його
 * дає `TenancyModule`, у platform-api — підключається напряму).
 */
export function createLoggerConfig(options: LoggerFactoryOptions): LoggerModuleAsyncParams {
  const { service } = options;
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const level = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;
  // cwd = пакет застосунку (`pnpm --filter` це гарантує)
  const logsDir = join(process.cwd(), 'logs');
  const stream = isDevelopment ? devStream(service, level, logsDir) : prodStream(service, logsDir);

  return {
    inject: [ClsService],
    useFactory: (cls: ClsService) => ({
      pinoHttp: {
        level,
        genReqId,
        base: baseFields(service, isDevelopment),
        mixin: contextMixin(cls),
        serializers: logSerializers,
        redact: [...REDACT_PATHS],
        autoLogging: { ignore: isHealthCheck },
        customSuccessMessage: (req, res): string =>
          `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)}`,
        customErrorMessage: (req, res, err): string =>
          `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)} - ${err.message}`,
        ...(stream ? { stream } : {}),
      },
    }),
  };
}
