import { create } from 'zustand';
import type { StepProgressItem } from '@saas-skeleton/ui/components/step-progress';

/**
 * Реєстр активності — «що зараз виконується для користувача» (docs/user-operations.md §6.3).
 *
 * Нейтральний шар між ДЖЕРЕЛАМИ роботи й лотком у шелі: джерело (черга завантажень; згодом
 * `UserOperation` із сервера) публікує сюди свої елементи, лоток читає лише цей стор. Тому шел
 * не імпортує жодної фічі, а фіча — шел: обидва залежать униз, від цього файлу.
 *
 * Елемент — ДАНІ, не компонент: усі джерела малюються одним рядком, і лише так чип у хедері
 * може порахувати спільний відсоток.
 */
export type ActivityStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface ActivityItem {
  id: string;
  /** Уже людський текст: імʼя файлу, назва операції */
  title: string;
  status: ActivityStatus;
  /** Вимірюваний прогрес; без нього елемент «виконується» без відсотка */
  progress?: { current: number; total: number } | undefined;
  /** Етапи, якщо робота з них складається, — рядок розгортається у `StepProgress` */
  steps?: readonly StepProgressItem[] | undefined;
  errorMessage?: string | undefined;
  /** Для порядку в лотку: новіші вище */
  startedAt: number;
  /**
   * Головна дія над результатом («Download»). Елемент із дією не зникає сам після успіху:
   * людина мусить устигнути нею скористатися — прибирає його вона або джерело.
   */
  action?: { label: string; run: () => void } | undefined;
  onCancel?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /**
   * Прибрати елемент. Власник елемента — джерело: воно забирає його у себе й викликає
   * `remove`. Реєстр сам елементів не видаляє, лише просить про це (кнопка, авто-прибирання).
   */
  onDismiss: () => void;
}

/** Скільки успішний елемент лишається в лотку «виконаним», перш ніж зникнути сам */
export const SUCCEEDED_LINGER_MS = 4000;

interface ActivityState {
  items: readonly ActivityItem[];
  upsert: (item: ActivityItem) => void;
  remove: (id: string) => void;
}

const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearLinger(id: string): void {
  const timer = lingerTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    lingerTimers.delete(id);
  }
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  items: [],
  upsert: (item) => {
    set((state) => {
      const exists = state.items.some((current) => current.id === item.id);
      const items = exists
        ? state.items.map((current) => (current.id === item.id ? item : current))
        : [...state.items, item];
      return { items: [...items].sort((a, b) => b.startedAt - a.startedAt) };
    });
    // Таймер живе тут, а не в лотку: успішний елемент зникає й тоді, коли попап закритий
    if (item.status === 'succeeded' && !item.action) {
      if (!lingerTimers.has(item.id)) {
        lingerTimers.set(
          item.id,
          setTimeout(() => {
            lingerTimers.delete(item.id);
            const current = get().items.find((candidate) => candidate.id === item.id);
            if (current?.status === 'succeeded') {
              current.onDismiss();
            }
          }, SUCCEEDED_LINGER_MS),
        );
      }
    } else {
      clearLinger(item.id);
    }
  },
  remove: (id) => {
    clearLinger(id);
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
}));

export interface ActivitySummary {
  /** queued + running */
  active: number;
  failed: number;
  succeeded: number;
  /** Спільний відсоток активних елементів із вимірюваним прогресом; null — міряти нічим */
  percent: number | null;
}

export function summarizeActivity(items: readonly ActivityItem[]): ActivitySummary {
  let active = 0;
  let failed = 0;
  let succeeded = 0;
  let current = 0;
  let total = 0;
  for (const item of items) {
    if (item.status === 'failed') {
      failed += 1;
    }
    if (item.status === 'succeeded') {
      succeeded += 1;
    }
    if (item.status !== 'queued' && item.status !== 'running') {
      continue;
    }
    active += 1;
    if (item.progress && item.progress.total > 0) {
      current += Math.min(item.progress.current, item.progress.total);
      total += item.progress.total;
    }
  }
  return {
    active,
    failed,
    succeeded,
    percent: total > 0 ? Math.floor((current / total) * 100) : null,
  };
}
