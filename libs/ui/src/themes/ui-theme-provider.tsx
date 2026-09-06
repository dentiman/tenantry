import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_UI_THEME, isUiThemeId, type UiThemeId } from './registry';

/**
 * Провайдер ПАЛІТРИ. Друга вісь теми поруч із режимом:
 *
 *   режим  (light/dark/system) — клас `.dark` на <html>, ним володіє `next-themes`;
 *   палітра (slate/gray/…)     — атрибут `data-theme` на <html>, ним володіє цей файл.
 *
 * Осі свідомо роздільні. Злити їх у список `next-themes` (`slate-light`,
 * `gray-dark`, …) не можна з двох причин: зник би `system` (next-themes розрізняє
 * рівно light/dark), і зламався б `dark:` Tailwind — варіант оголошений як
 * `&:is(.dark *)`, тобто зав'язаний на клас, а не на рядок теми. Обґрунтування —
 * `docs/frontend/theming.md` §2.
 *
 * `storageKey` приходить від застосунку — рівно як у `ThemeProvider` next-themes,
 * щоб два фронти на одному localhost не перетирали вибір один одному.
 */
interface UiThemeContextValue {
  theme: UiThemeId;
  setTheme: (theme: UiThemeId) => void;
}

const UiThemeContext = createContext<UiThemeContextValue | null>(null);

function readStoredTheme(storageKey: string): UiThemeId {
  try {
    const stored = localStorage.getItem(storageKey);
    return isUiThemeId(stored) ? stored : DEFAULT_UI_THEME;
  } catch {
    // Приватний режим / заблоковані site data: тема просто не переживе перезавантаження
    return DEFAULT_UI_THEME;
  }
}

export function UiThemeProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  // Читаємо синхронно в ініціалізаторі: те саме значення вже виставив
  // блокувальний скрипт в index.html, тож перший рендер збігається з DOM
  const [theme, setThemeState] = useState<UiThemeId>(() => readStoredTheme(storageKey));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Синхронізація між вкладками: вибір теми — рішення про застосунок, а не про
  // вкладку, тож друга вкладка не має лишатись на старій палітрі
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === storageKey) {
        setThemeState(isUiThemeId(event.newValue) ? event.newValue : DEFAULT_UI_THEME);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [storageKey]);

  const setTheme = useCallback(
    (next: UiThemeId): void => {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Не критично: атрибут усе одно виставиться, просто не переживе перезавантаження
      }
      setThemeState(next);
    },
    [storageKey],
  );

  const value = useMemo<UiThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <UiThemeContext value={value}>{children}</UiThemeContext>;
}

export function useUiTheme(): UiThemeContextValue {
  const context = use(UiThemeContext);
  if (!context) {
    throw new Error('useUiTheme must be used within <UiThemeProvider>');
  }
  return context;
}
