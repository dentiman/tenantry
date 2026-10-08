import { linkOptions } from '@tanstack/react-router';
import { BookOpenText } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { GuideSidebar } from './guide-sidebar';

/** Путівник — одна довга сторінка; друга колонка — її зміст зі scroll-spy, а не меню роутів */
export const guideArea = defineArea({
  id: 'guide',
  prefix: linkOptions({ to: '/guide' }).to,
  label: 'layout:areas.guide',
  icon: BookOpenText,
  order: 60,
  panel: GuideSidebar,
});

export default defineNavigation({ areas: [guideArea] });
