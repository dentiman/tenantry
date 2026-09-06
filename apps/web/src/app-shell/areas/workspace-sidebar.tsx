import { Building2, LayoutDashboard, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «Workspace» — робоча навігація застосунку.
 *
 * Це те, що до появи рейлу було ЄДИНИМ меню шела. Налаштування і Playground
 * звідси пішли: у них тепер власні area (`areas.tsx`), бо їхні під-розділи —
 * повноцінне меню, а не один пункт.
 */
export function WorkspaceSidebar() {
  const { t } = useTranslation('layout');

  return (
    <AreaNav
      items={[
        {
          to: '/workspace',
          label: t('nav.dashboard'),
          icon: <LayoutDashboard />,
          match: 'exact',
        },
        { to: '/workspace/users', label: t('nav.users'), icon: <Users /> },
        { to: '/workspace/customers', label: t('nav.customers'), icon: <Building2 /> },
      ]}
    />
  );
}
