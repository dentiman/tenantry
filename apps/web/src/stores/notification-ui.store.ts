import { create } from 'zustand';

interface NotificationUiState {
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
}

/**
 * Стан панелі інбокса — у сторі, а не в `useState` дзвінка, бо його читає і пише
 * код ПОЗА React-деревом: socket-підписка (`notification-toast`) вирішує, чи
 * показувати тост, за тим, чи панель уже відкрита, і сама відкриває її по кліку.
 *
 * Це UI-стан, а не server state: у TanStack Query йому робити нічого.
 */
export const useNotificationUiStore = create<NotificationUiState>()((set) => ({
  isPanelOpen: false,
  openPanel: () => {
    set({ isPanelOpen: true });
  },
  closePanel: () => {
    set({ isPanelOpen: false });
  },
}));
