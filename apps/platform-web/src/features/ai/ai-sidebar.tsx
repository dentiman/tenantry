import { Coins, Settings2, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../../app-shell/area-nav';

/**
 * Друга колонка area «AI» — керування асистентом платформи (AI-5,
 * docs/ai-platform-controls.md): налаштування й вмикач (AI-5a), витрати й тарифи (AI-5b).
 */
export function AiSidebar() {
  const { t } = useTranslation('layout');

  return (
    <AreaNav
      items={[
        { to: '/ai/settings', label: t('nav.aiSettings'), icon: <Settings2 /> },
        { to: '/ai/costs', label: t('nav.aiCosts'), icon: <Coins /> },
        { to: '/ai/prices', label: t('nav.aiPrices'), icon: <Tags /> },
      ]}
    />
  );
}
