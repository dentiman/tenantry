import { Palette, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «User settings» — особисте оператора. Area без пункту в
 * рейлі: вхід — дропдаун аватара (`docs/settings.md`, ті самі підстави, що в web).
 */
export function UserSettingsSidebar() {
  const { t } = useTranslation('user-settings');

  return (
    <AreaNav
      items={[
        { to: '/user-settings', label: t('nav.profile'), icon: <UserCog />, match: 'exact' },
        { to: '/user-settings/appearance', label: t('nav.appearance'), icon: <Palette /> },
      ]}
    />
  );
}
