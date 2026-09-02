import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Шляхи розділу перелічені літералами, а не `string`: `Link to` у TanStack Router
 * типізований юніоном реальних роутів — довільний рядок туди не передати, і це
 * саме та перевірка, яка ловить друкарську помилку в навігації
 */
export type SectionPath =
  // Організація — те, що лишиться компанії (docs/settings.md)
  | '/settings'
  | '/settings/numbering'
  | '/settings/activity'
  // Особисті — те, що піде з людиною, коли вона звільниться
  | '/user-settings'
  | '/user-settings/account'
  | '/user-settings/security'
  | '/user-settings/notifications'
  | '/user-settings/appearance';

export interface SectionNavItem {
  href: SectionPath;
  title: string;
  icon: React.ReactNode;
}

/**
 * Навігація розділу з бічним меню — спільна для обох розділів налаштувань
 * (організації та особистих): це одна ментальна модель, і робити її двічі
 * по-різному не було б за що. Розкладка взята з `features/settings/components/sidebar-nav.tsx`
 * шаблону satnaing/shadcn-admin (MIT): на вузькому екрані — `Select`, на широкому —
 * вертикальний список ghost-кнопок з активним станом на `bg-muted`.
 *
 * Відмінності від оригіналу: посилання — `Link` роутера (а не `<a>`), локальний
 * стан вибраного пункту не дублюється — джерело правди одне, `location.pathname`.
 */
export function SectionNav({ items }: { items: SectionNavItem[] }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <>
      <div className="p-1 md:hidden">
        <Select
          items={items.map((item) => ({ value: item.href, label: item.title }))}
          value={pathname}
          onValueChange={(href) => {
            void navigate({ to: href as SectionPath });
          }}
        >
          <SelectTrigger className="w-full" aria-label={t('sectionNav')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.href} value={item.href}>
                <div className="flex items-center gap-3">
                  {item.icon}
                  <span>{item.title}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav className="hidden gap-2 overflow-x-auto md:flex lg:flex-col">
        {items.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              pathname === item.href
                ? 'bg-muted hover:bg-muted'
                : 'hover:bg-accent hover:text-accent-foreground',
              'justify-start gap-3',
            )}
          >
            {item.icon}
            <span>{item.title}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
