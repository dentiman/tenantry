import { linkOptions } from '@tanstack/react-router';
import { SparklesIcon } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { settingsArea } from '../settings/settings.nav';
import { AssistantSidebar } from './assistant-sidebar';

/**
 * Сторінка асистента. Друга колонка — історія розмов, тобто компонент, а не меню
 * (`Area.panel`): динамічні дані в реєстр навігації не кладуться — та сама причина, що
 * в чату (`chat-sidebar.tsx`).
 */
export const assistantArea = defineArea({
  id: 'assistant',
  prefix: linkOptions({ to: '/assistant' }).to,
  label: 'layout:areas.assistant',
  icon: SparklesIcon,
  order: 35,
  panel: AssistantSidebar,
});

export default defineNavigation({
  areas: [assistantArea],
  items: [
    {
      id: 'settings.ai',
      area: settingsArea,
      order: 40,
      link: linkOptions({ to: '/settings/ai' }),
      label: 'settings:nav.ai',
      icon: SparklesIcon,
    },
  ],
});
