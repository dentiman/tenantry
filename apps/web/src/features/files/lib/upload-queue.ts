/**
 * Черга завантажень (docs/file-storage.md, фронтенд). Чистий модуль без React і без мережі:
 * транспорт передають ззовні, тому логіку черги перевіряють юніт-тести, а Playground ганяє її
 * на фейковому транспорті.
 *
 * Завантаження належить сесії застосунку, а не екрану, що його почав: воно триває після
 * переходу на іншу сторінку. Не більше `concurrency` передач одночасно, решта чекають у порядку
 * запуску.
 */
export type UploadPhase =
  | 'queued'
  | 'preparing'
  | 'transferring'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'canceled';

/** Двофазний флоу файлової підсистеми: рядок PENDING + presigned URL → байти → перевірка */
export interface UploadTransport<TSource, TResult> {
  create(source: TSource, signal: AbortSignal): Promise<{ id: string; uploadUrl: string }>;
  put(
    uploadUrl: string,
    source: TSource,
    options: { signal: AbortSignal; onProgress: (loaded: number, total: number) => void },
  ): Promise<void>;
  complete(id: string, signal: AbortSignal): Promise<TResult>;
  /** Текст помилки для людини */
  describeError(error: unknown): string;
}

export interface UploadEntry<TSource, TResult> {
  readonly id: string;
  readonly source: TSource;
  readonly phase: UploadPhase;
  readonly loaded: number;
  readonly total: number;
  /** Етап, на якому сталася помилка (для `phase === 'failed'`) */
  readonly failedPhase?: 'preparing' | 'transferring' | 'verifying' | undefined;
  readonly errorMessage?: string | undefined;
  readonly result?: TResult | undefined;
  /** Чи пропонувати повтор після помилки — вирішує той, хто додав (design D4) */
  readonly retryable: boolean;
  readonly startedAt: number;
}

export type UploadOutcome<TResult> =
  | { status: 'done'; result: TResult }
  | { status: 'failed'; message: string }
  | { status: 'canceled' };

export interface UploadHandle<TResult> {
  id: string;
  /** Завершується завжди, ніколи не відхиляється: скасування й помилка — теж результат */
  done: Promise<UploadOutcome<TResult>>;
}

export interface UploadQueue<TSource, TResult> {
  add(
    source: TSource,
    options?: { retryable?: boolean; transport?: UploadTransport<TSource, TResult> },
  ): UploadHandle<TResult>;
  /** Зупинити завантаження, що чекає або триває; це не помилка */
  cancel(id: string): void;
  /** Повторити невдале завантаження з початку — з новим presigned URL */
  retry(id: string): UploadHandle<TResult> | undefined;
  /** Забути завершене завантаження (успішне, невдале чи скасоване) */
  remove(id: string): void;
  entries(): readonly UploadEntry<TSource, TResult>[];
}

interface Options<TSource extends { size: number }, TResult> {
  transport: UploadTransport<TSource, TResult>;
  /** Скільки файлів передається одночасно */
  concurrency?: number;
  onChange?: (entries: readonly UploadEntry<TSource, TResult>[]) => void;
  newId?: () => string;
  now?: () => number;
}

interface Job<TSource, TResult> {
  entry: UploadEntry<TSource, TResult>;
  transport: UploadTransport<TSource, TResult>;
  controller: AbortController | null;
  resolve: (outcome: UploadOutcome<TResult>) => void;
}

const ACTIVE: ReadonlySet<UploadPhase> = new Set(['preparing', 'transferring', 'verifying']);

export function isActiveUpload(phase: UploadPhase): boolean {
  return phase === 'queued' || ACTIVE.has(phase);
}

export function createUploadQueue<TSource extends { size: number }, TResult>(
  options: Options<TSource, TResult>,
): UploadQueue<TSource, TResult> {
  const concurrency = options.concurrency ?? 3;
  const now = options.now ?? Date.now;
  let counter = 0;
  const newId =
    options.newId ??
    ((): string => {
      counter += 1;
      return `upload-${String(now())}-${String(counter)}`;
    });
  // Map тримає порядок вставки — це і є порядок черги
  const jobs = new Map<string, Job<TSource, TResult>>();

  const snapshot = (): readonly UploadEntry<TSource, TResult>[] =>
    Array.from(jobs.values(), (job) => job.entry);

  const emit = (): void => {
    options.onChange?.(snapshot());
  };

  const patch = (
    job: Job<TSource, TResult>,
    change: Partial<UploadEntry<TSource, TResult>>,
  ): void => {
    // Новий обʼєкт на кожну зміну: React-стор порівнює посилання
    job.entry = { ...job.entry, ...change };
    emit();
  };

  const run = async (job: Job<TSource, TResult>): Promise<void> => {
    const controller = new AbortController();
    job.controller = controller;
    const { signal } = controller;
    let stage: 'preparing' | 'transferring' | 'verifying' = 'preparing';
    try {
      patch(job, { phase: 'preparing' });
      const created = await job.transport.create(job.entry.source, signal);
      signal.throwIfAborted();

      stage = 'transferring';
      patch(job, { phase: 'transferring', loaded: 0 });
      await job.transport.put(created.uploadUrl, job.entry.source, {
        signal,
        onProgress: (loaded, total) => {
          // Подія прогресу може долетіти вже після скасування чи завершення передачі
          if (job.entry.phase === 'transferring') {
            patch(job, { loaded, total: total > 0 ? total : job.entry.total });
          }
        },
      });
      signal.throwIfAborted();

      stage = 'verifying';
      patch(job, { phase: 'verifying', loaded: job.entry.total });
      const result = await job.transport.complete(created.id, signal);
      signal.throwIfAborted();

      patch(job, { phase: 'done', result });
      job.resolve({ status: 'done', result });
    } catch (error) {
      if (signal.aborted) {
        // `cancel` уже виставив фазу й завершив проміс — це не помилка
        return;
      }
      const message = job.transport.describeError(error);
      patch(job, { phase: 'failed', failedPhase: stage, errorMessage: message });
      job.resolve({ status: 'failed', message });
    } finally {
      job.controller = null;
      pump();
    }
  };

  function pump(): void {
    let running = 0;
    for (const job of jobs.values()) {
      if (ACTIVE.has(job.entry.phase)) {
        running += 1;
      }
    }
    for (const job of jobs.values()) {
      if (running >= concurrency) {
        return;
      }
      if (job.entry.phase === 'queued' && job.controller === null) {
        running += 1;
        // Фаза міняється синхронно всередині run до першого await — подвійного старту не буде
        void run(job);
      }
    }
  }

  const enqueue = (job: Job<TSource, TResult>): UploadHandle<TResult> => {
    const done = new Promise<UploadOutcome<TResult>>((resolve) => {
      job.resolve = resolve;
    });
    emit();
    pump();
    return { id: job.entry.id, done };
  };

  return {
    add(source, addOptions = {}) {
      const job: Job<TSource, TResult> = {
        entry: {
          id: newId(),
          source,
          phase: 'queued',
          loaded: 0,
          total: source.size,
          retryable: addOptions.retryable ?? false,
          startedAt: now(),
        },
        transport: addOptions.transport ?? options.transport,
        controller: null,
        resolve: () => undefined,
      };
      jobs.set(job.entry.id, job);
      return enqueue(job);
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job || !isActiveUpload(job.entry.phase)) {
        return;
      }
      job.entry = { ...job.entry, phase: 'canceled' };
      job.controller?.abort();
      job.resolve({ status: 'canceled' });
      emit();
      pump();
    },
    retry(id) {
      const job = jobs.get(id);
      if (job?.entry.phase !== 'failed') {
        return undefined;
      }
      // З початку: presigned URL невдалої спроби міг спливти, а її рядок PENDING прибере cron
      job.entry = {
        ...job.entry,
        phase: 'queued',
        loaded: 0,
        failedPhase: undefined,
        errorMessage: undefined,
      };
      return enqueue(job);
    },
    remove(id) {
      const job = jobs.get(id);
      if (!job || isActiveUpload(job.entry.phase)) {
        return;
      }
      jobs.delete(id);
      emit();
    },
    entries: snapshot,
  };
}
