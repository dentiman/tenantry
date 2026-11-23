import type { ErrorReport } from './report-error';

/** Те саме значення — у `libs/ui/src/build/client-log-sink.ts` (плагін Vite dev-сервера) */
const CLIENT_LOG_PATH = '/__client-log';

interface DevLogExtras {
  readonly route?: string;
  readonly version?: string;
  readonly userId?: string;
}

function describeError(error: unknown): { type: string; message: string; stack: string } {
  if (error instanceof Error) {
    return { type: error.name, message: error.message, stack: error.stack ?? '' };
  }
  return { type: 'NonError', message: typeof error === 'string' ? error : JSON.stringify(error), stack: '' };
}

/**
 * Надсилає звіт dev-серверу Vite, який дописує його в `apps/<app>/logs/` поруч із логами
 * бекенда (docs/observability.md §5). Викликати лише під `import.meta.env.DEV`: у збірці
 * приймача немає. Збій надсилання мовчки ігнорується — звіт уже є в консолі.
 */
export function sendToDevLogSink(report: ErrorReport, extras: DevLogExtras): void {
  const { requestId, ...rest } = report.context ?? {};
  const body = JSON.stringify({
    source: report.source,
    error: describeError(report.error),
    traceId: typeof requestId === 'string' ? requestId : undefined,
    detail: Object.keys(rest).length > 0 ? JSON.stringify(rest) : undefined,
    ...extras,
  });
  void fetch(CLIENT_LOG_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
