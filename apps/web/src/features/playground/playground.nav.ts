import { linkOptions } from '@tanstack/react-router';
import { AlignLeftIcon, Blocks, PanelTopIcon, RectangleHorizontalIcon } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { PlaygroundSidebar } from './playground-sidebar';

export const playgroundArea = defineArea({
  id: 'playground',
  prefix: linkOptions({ to: '/playground' }).to,
  label: 'layout:areas.playground',
  icon: Blocks,
  order: 50,
  panel: PlaygroundSidebar,
});

/**
 * Плоскі стенди під акордеоном «Components»: пункти area, але малює їх сама панель
 * (`PlaygroundSidebar` → `<AreaNav areaId="playground"/>`), бо вона ще й тримає акордеон.
 */
export default defineNavigation({
  areas: [playgroundArea],
  items: [
    {
      id: 'playground.vertical-form',
      area: playgroundArea,
      order: 10,
      link: linkOptions({ to: '/playground/vertical-form' }),
      label: 'playground:nav.verticalForm',
      icon: AlignLeftIcon,
      match: 'exact',
    },
    {
      id: 'playground.inline-form',
      area: playgroundArea,
      order: 20,
      link: linkOptions({ to: '/playground/inline-form' }),
      label: 'playground:nav.inlineForm',
      icon: RectangleHorizontalIcon,
      match: 'exact',
    },
    {
      id: 'playground.dialog',
      area: playgroundArea,
      order: 30,
      link: linkOptions({ to: '/playground/dialog' }),
      label: 'playground:nav.dialog',
      icon: PanelTopIcon,
      match: 'exact',
    },
  ],
});
