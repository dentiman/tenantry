import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { lazyRouteComponent } from '@tanstack/react-router';

/**
 * Єдине соглашение про ліниве завантаження обох фронтендів (docs/frontend/lazy-loading.md).
 *
 * Два інструменти — за різним призначенням, обидва беруть ІМЕНОВАНИЙ експорт модуля:
 *
 * - `lazyPage` — компонент МАРШРУТУ: `component: lazyPage(() => import('./pages/x'), 'XPage')`.
 *   Роутер сам викликає `.preload()` (hover/focus на `Link` при `defaultPreload: 'intent'`) і
 *   тягне чанк паралельно з `beforeLoad`/`loader`, а до готовності лишає стару сторінку на місці.
 *   Свіжий деплой, що прибрав старий чанк, обробляє сам роутер: один перезавантажуваний `reload`.
 * - `lazyComponent` — важкий компонент УСЕРЕДИНІ сторінки, внесок у слот, панель area (markdown,
 *   редактор, графік). Це `React.lazy`, тож потребує `<Suspense>` (див. `LazyBoundary`) і сам
 *   повторює той самий «один reload» для застарілого чанка.
 *
 * Чому не `autoCodeSplitting` з `@tanstack/router-plugin`: плагін розбиває лише file-based
 * маршрути (`createFileRoute` у `routes/`), а наші маршрути — code-based, власник кожного —
 * його модуль (docs/modules.md §7.4).
 */
export const lazyPage = lazyRouteComponent;

const RELOAD_KEY_PREFIX = 'lazy_reload:';

/** Браузерні формулювання провалу динамічного `import()` (Chromium / Firefox / Safari) */
export function isChunkLoadError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return (
    typeof message === 'string' &&
    (message.startsWith('Failed to fetch dynamically imported module') ||
      message.startsWith('error loading dynamically imported module') ||
      message.startsWith('Importing a module script failed'))
  );
}

/**
 * Після нового деплою старий чанк зникає з сервера, і відкрита вкладка отримує 404 на `import()`.
 * Перезавантаження підтягує новий `index.html`. Один раз на повідомлення (воно містить хеш
 * чанка): без захисту справжній обрив мережі зациклив би reload.
 */
function reloadOnceFor(error: unknown): boolean {
  if (!isChunkLoadError(error) || !(error instanceof Error)) return false;
  try {
    const key = `${RELOAD_KEY_PREFIX}${error.message}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // sessionStorage недоступний (приватний режим тощо) — не ризикуємо циклом
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * `React.lazy` для іменованого експорту, з тим самим захистом від застарілого чанка, що й
 * `lazyPage`. Рендерити лише під `<Suspense>` — зручно через `LazyBoundary`.
 */
export function lazyComponent<
  K extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- як у React.lazy: пропси довільні
  T extends Record<K, ComponentType<any>>,
>(importer: () => Promise<T>, exportName: K): LazyExoticComponent<T[K]> {
  return lazy(async () => {
    try {
      const module = await importer();
      return { default: module[exportName] };
    } catch (error) {
      if (reloadOnceFor(error)) {
        // Сторінка вже перезавантажується — вішаємо Suspense, а не показуємо помилку
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}
