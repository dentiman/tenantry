import { create } from 'zustand';

const OPEN_STORAGE_KEY = 'saas_ai_panel_open';

/**
 * Стан панелі асистента. У сторі, а не в `useState` компонента, з двох причин:
 *
 * 1. Панель НЕ залежить від роутингу — вона переживає перехід між area. Стан,
 *    що живе поза React-деревом і поза роутером, робить це властивістю
 *    РОЗМІЩЕННЯ, а не ефектом, який хтось мусить не забути написати.
 * 2. Його читає і пише код з різних місць: кнопка в хедері, сама панель,
 *    композер. Той самий підхід, що в `notification-ui.store.ts`.
 *
 * `localStorage` тут — саме той випадок, для якого він придатний: дрібна
 * зручність одного глядача, яку не шкода втратити. Читання й запис обгорнуті,
 * бо в приватному вікні або з заблокованими даними сайту доступ кидає.
 */
function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeOpen(value: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, String(value));
  } catch {
    // Панель має працювати і без збереження — просто не переживе перезавантаження
  }
}

interface AiPanelState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useAiPanelStore = create<AiPanelState>()((set, get) => ({
  isOpen: readOpen(),
  open: () => {
    writeOpen(true);
    set({ isOpen: true });
  },
  close: () => {
    writeOpen(false);
    set({ isOpen: false });
  },
  toggle: () => {
    const next = !get().isOpen;
    writeOpen(next);
    set({ isOpen: next });
  },
}));
