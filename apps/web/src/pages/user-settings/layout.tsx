import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Bell, Palette, ShieldCheck, UserCog, Wrench } from 'lucide-react';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { SectionNav, type SectionNavItem } from '../../components/section/section-nav';

/**
 * Каркас розділу налаштувань. Розкладка — `features/settings/index.tsx` шаблону
 * satnaing/shadcn-admin (MIT): заголовок, лінійка, ліворуч липка навігація на 1/5
 * ширини, праворуч вміст. Хедер із оригіналу не переносимо — він у нас глобальний
 * (AppLayout). Крихти рендерить КОЖНА сторінка розділу своїм повним ланцюжком:
 * портал дописує вміст у слот, тож два PageBreadcrumbs (тут і на сторінці)
 * промалювались би поруч.
 */
export function UserSettingsLayout() {
  const { t } = useTranslation('user-settings');

  const items: SectionNavItem[] = [
    { href: '/user-settings', title: t('nav.profile'), icon: <UserCog size={18} /> },
    { href: '/user-settings/account', title: t('nav.account'), icon: <Wrench size={18} /> },
    { href: '/user-settings/security', title: t('nav.security'), icon: <ShieldCheck size={18} /> },
    {
      href: '/user-settings/notifications',
      title: t('nav.notifications'),
      icon: <Bell size={18} />,
    },
    { href: '/user-settings/appearance', title: t('nav.appearance'), icon: <Palette size={18} /> },
  ];

  return (
    <div className="flex flex-1 flex-col">
      {/* Шапка — та сама метрика, що на сторінках списків (`/users`): 2xl-заголовок
          і підзаголовок на `text-sm`. Розділ налаштувань не має виглядати
          «більшим», ніж решта застосунку */}
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
