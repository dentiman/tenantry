import { createRoute } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { GuidePage } from './pages/guide';

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
  staticData: { backdrop: 'brand' },
});
