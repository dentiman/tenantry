import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { appRoute, rootRoute } from '../../app-shell/app.routes';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const AboutPage = lazyPage(() => import('./pages/about'), 'AboutPage');
const GuidePage = lazyPage(() => import('./pages/guide'), 'GuidePage');

/**
 * Area «Guide» — путівник по продукту. Одна сторінка без дочірніх роутів:
 * параграфи — секції з якорями, навігацію по них веде друга колонка
 * (`areas/guide-sidebar.tsx`) прокруткою, а не переходами. Звичайна розкладка,
 * не `bleed`: сторінку скролить шел.
 */
export const guideRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/guide',
  component: GuidePage,
  // Експеримент: свій спокійний фон зі світлом ліворуч (`brand-backdrop.css` §4)
  staticData: { backdrop: 'brand', backdropVariant: 'guide' },
});

/**
 * Публічний путівник — той самий вміст, що в `/guide`, але поза шелом і поза гейтом
 * `requireAuth`: батько — `rootRoute`, як у `/login` і `/reset-password`. Без
 * `beforeLoad` свідомо: сторінка однаково відкривається і гостю, і залогіненому
 * (кнопка входу в рамі залежить від сесії). Решту — див. `pages/about.tsx`.
 */
export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});
