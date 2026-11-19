import { create } from 'zustand';
import type { StepProgressItem } from '@saas-skeleton/ui/components/step-progress';

/**
 * Реєстр активності — «що зараз виконується для користувача» (docs/user-operations.md §6.3).
 *
 * Нейтральний шар між ДЖЕРЕЛАМИ роботи й доком активності в шелі: джерело (черга завантажень; згодом
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
  /** Що це за робота — для заголовка дока («Uploading 3 items») */
  kind?: 'upload' | 'operation' | undefined;
  /** Головна дія над результатом («Download») */
  action?: { label: string; run: () => void } | undefined;
  onCancel?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /**
   * Прибрати елемент. Власник елемента — джерело: воно забирає його у себе й викликає
   * `remove`. Реєстр сам елементів не видаляє, лише просить про це (кнопка рядка, хрестик дока).
   */
  onDismiss: () => void;
}

const COLLAPSED_KEY = 'saas_activity_dock_collapsed';

function readCollapsed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Приватне вікно чи заблоковане сховище: стан просто не переживе перезавантаження
  }
}

interface ActivityState {
  items: readonly ActivityItem[];
  /** Док згорнуто до заголовка; памʼятається між перезавантаженнями сторінки */
  collapsed: boolean;
  upsert: (item: ActivityItem) => void;
  remove: (id: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  /**
   * Розгорнути док. Кличе той, хто щойно ЗАПУСТИВ роботу за дією людини (нове завантаження,
   * кнопка «Export»), — щоб вона побачила, що робота пішла. Відновлення операцій після
   * перезавантаження сторінки його не кличе: там діє збережений стан.
   */
  reveal: () => void;
  /** Закрити док: активне скасувати, усе прибрати (хрестик у заголовку) */
  closeAll: () => void;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  items: [],
  collapsed: readCollapsed(),
  upsert: (item) => {
    set((state) => {
      const exists = state.items.some((current) => current.id === item.id);
      const items = exists
        ? state.items.map((current) => (current.id === item.id ? item : current))
        : [...state.items, item];
      return { items: [...items].sort((a, b) => b.startedAt - a.startedAt) };
    });
  },
  remove: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
  setCollapsed: (collapsed) => {
    writeCollapsed(collapsed);
    set({ collapsed });
  },
  reveal: () => {
    if (get().collapsed) {
      get().setCollapsed(false);
    }
  },
  closeAll: () => {
    // Копія: onDismiss джерела змінює `items` просто під час обходу
    for (const item of [...get().items]) {
      if (item.status === 'queued' || item.status === 'running') {
        item.onCancel?.();
      }
      item.onDismiss();
    }
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

/** Що написати в заголовку дока — одним рядком про все, що в ньому лежить */
export type ActivityHeadline =
  | { tone: 'active'; uploadsOnly: boolean; count: number; percent: number | null }
  | { tone: 'failed'; count: number }
  | { tone: 'done'; uploadsOnly: boolean; count: number }
  | { tone: 'idle' };

/**
 * Пріоритет: щось виконується → помилки → завершене → (лишилися тільки скасовані) нейтрально.
 * `uploadsOnly` дає точніші слова («Uploading 3 items», «2 uploads complete»), коли в групі
 * самі завантаження; змішаний склад підписується загально.
 */
export function activityHeadline(items: readonly ActivityItem[]): ActivityHeadline {
  const summary = summarizeActivity(items);
  const uploadsOnly = (status: (item: ActivityItem) => boolean): boolean =>
    items.filter(status).every((item) => item.kind === 'upload');
  if (summary.active > 0) {
    return {
      tone: 'active',
      uploadsOnly: uploadsOnly((item) => item.status === 'queued' || item.status === 'running'),
      count: summary.active,
      percent: summary.percent,
    };
  }
  if (summary.failed > 0) {
    return { tone: 'failed', count: summary.failed };
  }
  if (summary.succeeded > 0) {
    return {
      tone: 'done',
      uploadsOnly: uploadsOnly((item) => item.status === 'succeeded'),
      count: summary.succeeded,
    };
  }
  return { tone: 'idle' };
}
