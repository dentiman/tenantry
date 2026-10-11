import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, LogInIcon } from 'lucide-react';
import { BrandBackdrop } from '@saas-skeleton/ui/components/brand-backdrop';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useAuthStore } from '../../auth/stores/auth.store';
import { GuideSidebar } from '../guide-sidebar';
import { PublicGuideRail } from './public-guide-rail';

/**
 * Рама публічного путівника (`/about`) — СПРОЩЕНА СТАТИЧНА КОПІЯ шела застосунку
 * (`app-shell/app-shell.tsx`): рейл розділів, друга колонка зі змістом путівника,
 * контентна шапка й нижня смуга. Мета — щоб гість бачив той самий продукт, який
 * побачить після входу, а не окремий сайт.
 *
 * ЧОГО тут немає свідомо — усього, що живе від сесії: дзвінка сповіщень, кнопки
 * асистента, меню юзера, контекстної панелі, назви тенанта (вона приходить із
 * авторизованого bootstrap). Тому справжні `AppRail` / `AreaSidebar` /
 * `AppFooterBar` тут не беруться — вони читають реєстр навігації, налаштування й
 * сесію; їхні копії без цього — `PublicGuideRail`, колонка нижче й `EntryBar`.
 *
 * Фон і скло — ті самі, що в `/guide`: `data-backdrop="brand"` на `SidebarProvider`
 * (`--background` прозорий, `--sidebar` / `--card` — скло) і `BrandBackdrop` ПЕРШОЮ
 * дитиною без `z-index`, див. `brand-backdrop.tsx`. Шапка контенту має
 * `data-slot="app-header"` — її скло задає той самий CSS-запис, що в шела.
 *
 * Прокручує `ScrollArea`, не вікно: так працює `useGuideScrollSpy` і так вимагає
 * правило репозиторію про прокрутку. На телефоні тригер у шапці відкриває рейл і
 * колонку разом поверх контенту (`Sheet` самого `Sidebar`) — так само, як у шелі.
 *
 * Ширина колонки фіксована, 14rem, без `ResizeHandle`: читальній сторінці тягнути її
 * нічого. `--sidebar-width` збирається так само, як у шелі, — рейл + колонка + 2px
 * на дві межі.
 */
export function PublicGuideShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('layout');

  return (
    <SidebarProvider
      data-backdrop="brand"
      style={
        { '--sidebar-width': 'calc(14rem + var(--sidebar-width-icon) + 2px)' } as CSSProperties
      }
    >
      <BrandBackdrop />

      <Sidebar collapsible="icon" className="overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <PublicGuideRail />
          {/* Друга колонка: назва продукту й «Guide» двома рядками — та сама форма, що
              в `AreaSidebar`, де зверху назва тенанта (тут її немає — це публічна
              сторінка) */}
          <Sidebar
            collapsible="none"
            className="relative min-w-0 shrink-0"
            style={{ width: '14rem' }}
          >
            <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border px-4">
              <div className="grid leading-tight">
                <span className="truncate font-semibold">{t('brand')}</span>
                <span className="truncate text-xs text-muted-foreground">{t('areas.guide')}</span>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <GuideSidebar />
            </SidebarContent>
          </Sidebar>
        </div>
        <EntryBar />
      </Sidebar>

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header
          data-slot="app-header"
          className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6"
        >
          <SidebarTrigger className="-ml-2" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('areas.guide')}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeSwitcher />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1" size="lg">
          <div className="min-h-full px-6 pt-4 pb-6">{children}</div>
        </ScrollArea>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Нижня смуга колонки — на місці меню акаунта справжнього шела (`AppFooterBar`, ті самі
 * `h-12` / `p-2` / межа зверху), але з ОДНІЄЮ кнопкою входу, що залежить від сесії:
 * гостю «Sign in» → `/login`, залогіненому «Open the app» → `/workspace`. У згорнутому
 * стані (лишився тільки рейл) кнопка стискається до іконки 32px, як пункти рейлу.
 */
function EntryBar() {
  const { t } = useTranslation('guide');
  const user = useAuthStore((state) => state.user);
  const label = user ? t('about.openApp') : t('about.signIn');
  const Icon = user ? ArrowRightIcon : LogInIcon;
  const className = cn(
    buttonVariants({ size: 'sm' }),
    'min-w-0 flex-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:p-0',
  );
  const content = (
    <>
      <Icon data-icon="inline-start" />
      <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
    </>
  );

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-sidebar-border p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1">
      {user ? (
        <Link to="/workspace" aria-label={label} className={className}>
          {content}
        </Link>
      ) : (
        <Link to="/login" aria-label={label} className={className}>
          {content}
        </Link>
      )}
    </div>
  );
}
