import { create } from 'zustand';

const DISMISSED_STORAGE_KEY = 'saas_guide_tour_dismissed';

/**
 * Чи сховав глядач плитку-вхід у путівник на дашборді. У сторі, а не в `useState`
 * плитки: дашборд перемонтовується при кожному поверненні на `/workspace`, а
 * вибір «більше не показувати» мусить пережити і це, і перезавантаження.
 *
 * `localStorage` — той самий випадок, що в `ai-panel.store.ts`: дрібна зручність
 * одного глядача, яку не шкода втратити. Читання й запис обгорнуті, бо в
 * приватному вікні або з заблокованими даними сайту доступ кидає — тоді плитка
 * просто показується знову після перезавантаження.
 */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(value));
  } catch {
    // Плитка має працювати і без збереження — просто не переживе перезавантаження
  }
}

interface GuideTourState {
  dismissed: boolean;
  dismiss: () => void;
}

export const useGuideTourStore = create<GuideTourState>()((set) => ({
  dismissed: readDismissed(),
  dismiss: () => {
    writeDismissed(true);
    set({ dismissed: true });
  },
}));
