import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Building2, Hash, History } from 'lucide-react';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { SectionNav, type SectionNavItem } from '../../components/section/section-nav';

/**
 * Каркас налаштувань ОРГАНІЗАЦІЇ. Той самий візуальний шаблон, що в особистих
 * `/user-settings`, — це одна ментальна модель «розділ із бічною навігацією».
 *
 * А от розділи різні, і саме в цьому суть: `/settings` — те, що лишиться
 * компанії; `/user-settings` — те, що піде з людиною, коли вона звільниться
 * (docs/settings.md).
 */
export function SettingsLayout() {
  const { t } = useTranslation('settings');

  const items: SectionNavItem[] = [
    { href: '/settings', title: t('nav.general'), icon: <Building2 size={18} /> },
    { href: '/settings/numbering', title: t('nav.numbering'), icon: <Hash size={18} /> },
    { href: '/settings/activity', title: t('nav.activity'), icon: <History size={18} /> },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Separator className="my-4" />

      <div className="flex flex-1 flex-col space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12">
        <aside className="top-0 lg:sticky lg:w-1/5">
          <SectionNav items={items} />
        </aside>
        <div className="flex w-full p-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
