/**
 * Єдина точка звітування про помилки фронтендів (docs/frontend/lazy-loading.md §6).
 *
 * Усе, що UI-шар перехоплює «тихо» — межа роута (`defaultOnCatch`), `LazyBoundary` у слотах і
 * панелях, провал ледачого чанка, — йде сюди, а не в `console.error` напряму. Дефолт — консоль.
 * Коли зʼявиться центральний збирач (Sentry чи аналог), підміняється ОДНЕ місце на фронтенд:
 * `apps/<апка>/src/lib/error-reporting.ts` викликає `setErrorReporter(...)` до першого рендера.
 * Жоден компонент чи роут при цьому не змінюється.
 */

/** Звідки помилка — для тегів/групування в збирачі */
export type ErrorSource =
  /** межа роута: помилка рендера сторінки чи loader-а (`defaultOnCatch` роутера) */
  | 'route'
  /** `LazyBoundary`: внесок у слот, панель area, ледачий компонент усередині сторінки */
  | 'lazy-boundary'
  /** глобальні `error` / `unhandledrejection` вікна: те, що не перехопила жодна межа */
  | 'window'
  /** запит до API не вдався: мережа або 5xx (`context.requestId` — trace-id для пошуку в логах) */
  | 'api'
  /** будь-що інше, що викликає `reportError` вручну */
  | 'app';

export interface ErrorReport {
  readonly error: unknown;
  readonly source: ErrorSource;
  /** Додаткові поля для збирача (id роута, імʼя слота…): без персональних даних */
  readonly context?: Readonly<Record<string, unknown>>;
}

export type ErrorReporter = (report: ErrorReport) => void;

const consoleReporter: ErrorReporter = ({ error, source, context }) => {
  console.error(`[${source}]`, error, context ?? '');
};

let activeReporter: ErrorReporter = consoleReporter;

/**
 * Підмінює збирач. Повертає функцію скидання до попереднього — для тестів і для HMR.
 * Викликається один раз при старті застосунку (`error-reporting.ts` апки).
 */
export function setErrorReporter(reporter: ErrorReporter): () => void {
  const previous = activeReporter;
  activeReporter = reporter;
  return () => {
    activeReporter = previous;
  };
}

/**
 * Повідомляє про помилку активному збирачу. Сам збирач не має права кинути виняток у UI:
 * збій звітування не повинен ламати екран, який уже показує помилку.
 */
export function reportError(report: ErrorReport): void {
  try {
    activeReporter(report);
  } catch (reporterError) {
    console.error('[report-error] the reporter itself failed', reporterError);
  }
}

/**
 * Помилки поза React-деревом (обробник події, таймер, проміс без `catch`) не доходять до меж
 * роутів — без цього вони лишаються тільки в консолі браузера. Викликається один раз із
 * `error-reporting.ts` апки; SDK збирача (Sentry тощо) ставить такі самі обробники сам, тож
 * при переході на нього цей виклик прибирається.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    reportError({
      error: (event.error as unknown) ?? event.message,
      source: 'window',
      context: { filename: event.filename, line: event.lineno, column: event.colno },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError({ error: event.reason as unknown, source: 'window', context: { unhandledRejection: true } });
  });
}
