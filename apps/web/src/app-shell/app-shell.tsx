import type { CSSProperties } from 'react';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { Outlet, useMatches } from '@tanstack/react-router';
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@saas-skeleton/ui/components/ui/sidebar';
import {
  PageHeaderSlot,
  PageHeaderSlotProvider,
} from '@saas-skeleton/ui/components/page-header-slot';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { NotificationBell } from '../components/notifications/notification-bell';
import { AppRail } from './app-rail';
import { AreaSidebar } from './area-sidebar';

/**
 * Каркас застосунку: ДВІ навігаційні колонки і контент.
 *
 * Перший рівень (`AppRail`) — вузька смуга іконок area з брендом угорі і
 * профілем у футері; другий (`AreaSidebar`) — колонка активної area. Модель і
 * термінологія — `docs/frontend/app-shell.md`; реєстровий предок — блок
 * `@shadcn/sidebar-09` («вкладені рейли»).
 *
 * Єдине відхилення від блоку: рядок із двох колонок ми обгортаємо самі, а не
 * трюком `*:data-[sidebar=sidebar]:flex-row`. Виграш великий — той трюк
 * покладається на `className` зовнішнього сайдбара, який на мобільному до
 * `SheetContent` не доїжджає (там свій хардкоджений), тому в блоці друга колонка
 * на телефоні просто ховається (`hidden md:flex`), лишаючи смугу іконок без
 * навігації. Наша обгортка працює в обох гілках, і мобільний отримує ті самі дві
 * колонки в `Sheet` завширшки 18rem = 3rem рейлу + 15rem панелі.
 *
 * Ширини. `--sidebar-width-icon` — стокові 3rem (48px): це ширина рейлу, вона ж
 * ширина згорнутого стану, і рейл «більшає» не смугою, а вмістом (див.
 * `RAIL_NAV_BUTTON` / `RAIL_ANCHOR_BUTTON` у `app-rail.tsx`).
 *
 * `--sidebar-width` — це ширина ВСЬОГО блоку, тож задаємо її ЧЕРЕЗ ширину панелі:
 * стандартна тут панель, а рейл — фіксована обшивка, яку до неї додають. Панель
 * = 14rem (224px, крок `w-56` шкали Tailwind) — нижня межа класичного діапазону
 * навігаційної панелі 224…256px (`15rem`/240px — Linear, Notion; `16rem`/256px —
 * Material 2 і сток самого shadcn). Наступний крок угору, якщо колись стане
 * тісно, — `15rem`.
 *
 * `+ 2px` — не магія, а компенсація двох меж по 1px: правої в контейнера сайдбара
 * і правої в рейла. Без них панель вийшла б 222px замість 224px.
 */
export function AppShell() {
  // Останній збіг перемагає: режим оголошує САМА сторінка, а не її area —
  // `/workspace/users` полотно, а сусідня `/workspace/users/$userId` ні
  const matches = useMatches();
  const isBleed = matches.at(-1)?.staticData.layout === 'bleed';

  return (
    // Хедер тримає слот, який наповнюють сторінки (крихти) — див. page-header-slot.tsx
    <PageHeaderSlotProvider>
      <SidebarProvider
        style={
          { '--sidebar-width': 'calc(14rem + var(--sidebar-width-icon) + 2px)' } as CSSProperties
        }
      >
        {/* collapsible="icon": згортання стискає контейнер до ширини рейлу, а
            overflow-hidden відрізає панель. Тобто SidebarTrigger і Cmd+B тепер
            ховають ДРУГУ колонку, а рейл із брендом лишаються — поведінка VS Code */}
        <Sidebar collapsible="icon" className="overflow-hidden">
          <div className="flex min-h-0 flex-1">
            <AppRail />
            <AreaSidebar />
          </div>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-6 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-xl">
            <SidebarTrigger className="-ml-2" />
            <PageHeaderSlot className="min-w-0 flex-1" />
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <ThemeSwitcher />
            </div>
          </header>

          {/* div, а не main: SidebarInset реєстру САМ рендериться як <main>,
              і вкладений <main> був би невалідним */}
          {/* На всю ширину: у списках таблиці широкі, і центрована колонка
              max-w-5xl зʼїдала б половину екрана. Відступи — від роуту:
              сторінка-полотно (грід, календар) бере `bleed` і впирається в краї,
              решта лишається з полями шела (див. StaticDataRouteOption) */}
          <div className={cn('flex-1', isBleed ? 'p-0' : 'px-6 pt-4 pb-6')}>
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderSlotProvider>
  );
}
