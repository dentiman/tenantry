import { setErrorReporter } from '@saas-skeleton/ui/lib/report-error';

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
 *   Sentry.captureException(error, { tags: { app: 'platform-web', source }, extra: context });
 * });
 * ```
 *
 * Що саме сюди вже приходить: помилки меж роутів (`defaultOnCatch` у `router.tsx`) і всі
 * перехоплення `LazyBoundary` (внески слотів, панелі area; `context.isChunkLoadError` —
 * провал чанка, його варто фільтрувати від справжніх багів). Що сюди НЕ приходить і підʼєднується
 * окремо при впровадженні: глобальні `window.onerror`/`unhandledrejection` (їх ставить сам
 * Sentry.init) і помилки API — `handleGlobalError` у `main.tsx` (5xx вже логує бекенд за
 * `requestId`; чи дублювати їх у Sentry — рішення на момент впровадження).
 *
 * Викликається в `main.tsx` ДО першого рендера, щоб перша ж помилка потрапила до збирача.
 */
export function initErrorReporting(): void {
  setErrorReporter(({ error, source, context }) => {
    console.error(`[platform-web:${source}]`, error, context ?? '');
  });
}
