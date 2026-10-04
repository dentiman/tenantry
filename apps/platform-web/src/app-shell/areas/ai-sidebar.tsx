import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «AI» — керування асистентом платформи (AI-5,
 * docs/ai-platform-controls.md). Зараз — налаштування й вмикач (AI-5a); витрати й тарифи
 * (AI-5b) стануть сусідніми пунктами.
 */
export function AiSidebar() {
  const { t } = useTranslation('layout');

  return (
    <AreaNav items={[{ to: '/ai/settings', label: t('nav.aiSettings'), icon: <Settings2 /> }]} />
  );
}
