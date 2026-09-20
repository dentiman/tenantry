/**
 * Мок pg-boss для e2e-тестів: пакет ESM-only, а require(esm) у Jest 30
 * потребує Node ≥24.9 + --experimental-vm-modules. Черга — не предмет
 * HTTP-тестів; живий флоу перевіряється запуском apps/worker.
 * Зникне при міграції на Vitest (фаза 5).
 *
 * Аргументи `send` ЗАПИСУЮТЬСЯ (AI-0): публікація — це частина контракту
 * HTTP-операції, і сьют мусить бачити конверт із `tenantId`/`actor` та
 * `group` для справедливості між тенантами. До цього мок їх просто ковтав.
 */
export interface RecordedSend {
  queue: string;
  envelope: unknown;
  options: Record<string, unknown>;
}

const sent: RecordedSend[] = [];

/** Останні публікації в порядку виклику; `reset()` — між тестами */
export const sentJobs = {
  all: (): RecordedSend[] => [...sent],
  forQueue: (queue: string): RecordedSend[] => sent.filter((job) => job.queue === queue),
  last: (): RecordedSend | undefined => sent.at(-1),
  reset: (): void => {
    sent.length = 0;
  },
};

export class PgBoss {
  on(): this {
    return this;
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  /** Порожній масив = черги ще немає → PgBossService піде шляхом createQueue */
  getQueues(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  getQueue(): Promise<null> {
    return Promise.resolve(null);
  }
  createQueue(): Promise<void> {
    return Promise.resolve();
  }
  updateQueue(): Promise<void> {
    return Promise.resolve();
  }
  send(queue: string, envelope: unknown, options: Record<string, unknown> = {}): Promise<string> {
    sent.push({ queue, envelope, options });
    return Promise.resolve('mock-job-id');
  }
  work(): Promise<string> {
    return Promise.resolve('mock-worker-id');
  }
  schedule(): Promise<void> {
    return Promise.resolve();
  }
}

export function fromPrisma(): Record<string, never> {
  return {};
}
