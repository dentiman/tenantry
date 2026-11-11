import { linkOptions } from '@tanstack/react-router';
import { BookOpenText } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { lazyComponent } from '@saas-skeleton/ui/lib/lazy';

/** Друга колонка — окремий чанк: в головний чанк area лишає лише метадані (docs/frontend/lazy-loading.md) */
const GuideSidebar = lazyComponent(() => import('./guide-sidebar'), 'GuideSidebar');

/** Путівник — одна довга сторінка; друга колонка — її зміст зі scroll-spy, а не меню роутів */
export const guideArea = defineArea({
  id: 'guide',
  prefix: linkOptions({ to: '/guide' }).to,
  label: 'layout:areas.guide',
  icon: BookOpenText,
  order: 50,
  panel: GuideSidebar,
});

export default defineNavigation({ areas: [guideArea] });
