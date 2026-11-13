import { sendToDevLogSink } from '@saas-skeleton/ui/lib/dev-log-sink';
import { installGlobalErrorHandlers, setErrorReporter } from '@saas-skeleton/ui/lib/report-error';
import { buildInfo } from './build-info';

/**
 * ЄДИНЕ місце підключення збирача помилок цього фронтенду (docs/frontend/lazy-loading.md §6).
 *
 * Сьогодні збирач — консоль із позначкою апки. Коли зʼявиться Sentry (чи інший центральний
 * збирач), міняється ЛИШЕ цей файл:
 *
 * ```ts
 * import * as Sentry from '@sentry/react';
 * Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, release: '<версія збірки>' });
 * setErrorReporter(({ error, source, context }) => {
 *   Sentry.captureException(error, { tags: { app: 'web', source }, extra: context });
 * });
 * ```
 *
 * Що саме сюди приходить: помилки меж роутів (`defaultOnCatch` у `router.tsx`), усі
 * перехоплення `LazyBoundary` (внески слотів, панелі area; `context.isChunkLoadError` —
 * провал чанка, його варто фільтрувати від справжніх багів), глобальні `error` /
 * `unhandledrejection` вікна (`source: 'window'`; Sentry.init ставить їх сам — тоді виклик
 * `installGlobalErrorHandlers` прибрати) і невдалі запити до API: мережа та 5xx
 * (`source: 'api'`, `context.requestId` — trace-id, за яким ланцюг шукається в логах бекенда).
 * До кожного звіту додаються маршрут, версія збірки й id користувача (без email).
 *
 * Викликається в `main.tsx` ДО першого рендера, щоб перша ж помилка потрапила до збирача.
 */
/** `getUserId` передає composition root (`main.tsx`): цей файл про сесію не знає (docs/modules.md) */
export function initErrorReporting(getUserId: () => string | undefined): void {
  setErrorReporter((report) => {
    const extras = {
      route: window.location.pathname,
      version: buildInfo.version,
      userId: getUserId(),
    };
    console.error(`[web:${report.source}]`, report.error, { ...report.context, ...extras });
    // Dev: той самий звіт — у `apps/web/logs/web.log`, поруч із логами бекенда
    // (`pnpm logs:trace`). У збірці приймача немає — туди піде зовнішній збирач
    if (import.meta.env.DEV) {
      sendToDevLogSink(report, extras);
    }
  });
  installGlobalErrorHandlers();
}
