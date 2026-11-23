/**
 * Коли варто записати прогрес. Запис — це UPDATE, сокет-подія й перечитування в кожній вкладці
 * власника, тому не на кожен рядок: щонайменше раз на `minIntervalMs` або коли пройдено
 * `minStep` одиниць. Останнє значення (current === total) пишеться завжди — інакше смужка
 * зупинилася б на 99 %.
 */
export interface ProgressMark {
  at: number;
  current: number;
}

export interface ThrottleOptions {
  minIntervalMs: number;
  minStep: number;
}

export const DEFAULT_PROGRESS_THROTTLE: ThrottleOptions = { minIntervalMs: 1000, minStep: 500 };

export function shouldWriteProgress(
  last: ProgressMark | null,
  now: number,
  current: number,
  total: number,
  options: ThrottleOptions = DEFAULT_PROGRESS_THROTTLE,
): boolean {
  if (last === null || current >= total) {
    return true;
  }
  return now - last.at >= options.minIntervalMs || current - last.current >= options.minStep;
}
