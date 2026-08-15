/**
 * Мок pg-boss для e2e-тестів: пакет ESM-only, а require(esm) у Jest 30
 * потребує Node ≥24.9 + --experimental-vm-modules. Черга — не предмет
 * HTTP-тестів; живий флоу перевіряється запуском apps/worker.
 * Зникне при міграції на Vitest (фаза 5).
 */
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
  send(): Promise<string> {
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
