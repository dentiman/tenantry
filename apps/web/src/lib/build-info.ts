/**
 * Версія збірки й історія проєкту. Значення підставляє Vite (`define` у `vite.config.ts`)
 * зі `scripts/build-info.ts`; форма — та сама, що в `BuildInfo` цього скрипта.
 * Поза Vite (vitest має окремий конфіг без `define`) `__APP_BUILD__` не визначений —
 * тоді віддається нейтральний фолбек, щоб імпорт не падав.
 */
export interface HistoryEntry {
  label: string;
  value: string;
  children: { label: string; value: string }[];
}

export interface BuildInfo {
  version: string;
  buildNumber: number;
  commit: string | null;
  builtAt: string;
  history: { title: string; entries: HistoryEntry[] } | null;
}

declare const __APP_BUILD__: BuildInfo | undefined;

export const buildInfo: BuildInfo =
  typeof __APP_BUILD__ === 'undefined'
    ? { version: '0.0.0', buildNumber: 0, commit: null, builtAt: '', history: null }
    : __APP_BUILD__;
