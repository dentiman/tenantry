import { Bell, Palette, ShieldCheck, UserCog, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../../app-shell/area-nav';

/**
 * Друга колонка area «User settings» — ОСОБИСТЕ, що піде з людиною, коли вона
 * звільниться (docs/settings.md). Area без пункту в рейлі: вхід — дропдаун
 * аватара, бо в головній навігації словом «Settings» володіє організація.
 */
export function UserSettingsSidebar() {
  const { t } = useTranslation('user-settings');

  return (
    <AreaNav
      items={[
        { to: '/user-settings', label: t('nav.profile'), icon: <UserCog />, match: 'exact' },
        { to: '/user-settings/account', label: t('nav.account'), icon: <Wrench /> },
        { to: '/user-settings/security', label: t('nav.security'), icon: <ShieldCheck /> },
        { to: '/user-settings/notifications', label: t('nav.notifications'), icon: <Bell /> },
        { to: '/user-settings/appearance', label: t('nav.appearance'), icon: <Palette /> },
      ]}
    />
  );
}
