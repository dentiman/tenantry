import { Building2, Hash, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «Settings» — налаштування ОРГАНІЗАЦІЇ.
 *
 * Ці пункти раніше жили в контенті (`SectionNav` у знятому `SettingsLayout`):
 * розділ малював собі власну бічну навігацію ВСЕРЕДИНІ сторінки. Тепер вони на
 * своєму місці — у навігаційній колонці шела, а контенту лишився сам вміст.
 */
export function SettingsSidebar() {
  const { t } = useTranslation('settings');

  return (
    <AreaNav
      items={[
        { to: '/settings', label: t('nav.general'), icon: <Building2 />, match: 'exact' },
        { to: '/settings/numbering', label: t('nav.numbering'), icon: <Hash /> },
        { to: '/settings/activity', label: t('nav.activity'), icon: <History /> },
      ]}
    />
  );
}
