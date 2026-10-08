import { linkOptions } from '@tanstack/react-router';
import { Bot, Coins, Settings2, Tags } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/** Area «AI» — керування асистентом платформи (AI-5, docs/ai-platform-controls.md) */
export const aiArea = defineArea({
  id: 'ai',
  prefix: linkOptions({ to: '/ai' }).to,
  label: 'layout:areas.ai',
  icon: Bot,
  order: 30,
  panel: 'menu',
});

export default defineNavigation({
  areas: [aiArea],
  items: [
    {
      id: 'ai.settings',
      area: aiArea,
      order: 10,
      link: linkOptions({ to: '/ai/settings' }),
      label: 'layout:nav.aiSettings',
      icon: Settings2,
    },
    {
      id: 'ai.costs',
      area: aiArea,
      order: 20,
      link: linkOptions({ to: '/ai/costs' }),
      label: 'layout:nav.aiCosts',
      icon: Coins,
    },
    {
      id: 'ai.prices',
      area: aiArea,
      order: 30,
      link: linkOptions({ to: '/ai/prices' }),
      label: 'layout:nav.aiPrices',
      icon: Tags,
    },
  ],
});
