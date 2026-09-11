import { useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { Outlet, useMatches, useRouterState } from '@tanstack/react-router';
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
import {
  ContextPanelProvider,
  ContextPanelSlot,
  ContextPanelTrigger,
} from '@saas-skeleton/ui/components/context-panel-slot';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { NotificationBell } from '../components/notifications/notification-bell';
import { AppFooterBar } from './account-footer';
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

  /**
   * Прокрутка скидається на початок при переході на іншу сторінку.
   *
   * Доки скролило ВІКНО, це робив браузер. Тепер скролить `ScrollArea`, і без
   * цього ефекту нова сторінка відкривалась там, де людина покинула попередню, —
   * тобто десь посередині.
   *
   * Другим ділом ефект страхує саму смугу. Base UI перераховує переповнення на
   * `scroll` і на resize; зміну ВИСОТИ ВМІСТУ ловить `ScrollAreaContent` своїм
   * `ResizeObserver` (він у примітиві є), але RO — єдиний канал, і в замороженому
   * стані (фонова вкладка) він мовчить. `scrollTo` дає другий, незалежний:
   * перехід з довгої сторінки на коротку завжди має ненульовий `scrollTop`, тож
   * подія `scroll` гарантовано доїжджає і змушує перерахунок.
   *
   * Ключ — `pathname`, а не вся локація: зміна `?page=2` у гріді це та сама
   * сторінка, і скидати прокрутку там не треба.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    // Хедер тримає слот, який наповнюють сторінки (крихти) — див. page-header-slot.tsx,
    // а права колонка — той самий портальний слот для контекстної панелі
    // (див. context-panel-slot.tsx)
    <PageHeaderSlotProvider>
      <ContextPanelProvider>
        <SidebarProvider
          style={
            {
              '--sidebar-width': 'calc(14rem + var(--sidebar-width-icon) + 2px)',
              // Права колонка — 18rem/288px. Симетрія з лівою парою (рейл +
              // колонка area = 274px) була першим значенням і виявилась тіснуватою
              // для форми: 18rem дає ті ~14px, яких бракувало, і при цьому це не
              // підібране число, а крок шкали (`w-72`) і константа реєстру
              // (`SIDEBAR_WIDTH_MOBILE`). Змінна, а не клас, — бо ширина панелі
              // стане тягучою (resizable), і тягнути треба буде саме її
              '--context-panel-width': '18rem',
            } as CSSProperties
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
            {/* Нижня смуга — СИБЛІНГ рядка колонок, тому займає всю ширину
                ОБОХ (рейл + панель), а не одну з них; border-t відділяє її
                від навігації над нею. Деталі — account-footer.tsx */}
            <AppFooterBar />
          </Sidebar>

          {/* `min-w-0`: без нього широка таблиця гріда не дає стиснути себе, і
              відкрита контекстна панель виштовхнула б розкладку за край вікна.

              `h-svh overflow-hidden`: вікно більше НЕ скролиться — скролить
              `ScrollArea` під хедером. Це прибирає нативну смугу вікна, яка
              єдина в застосунку лишалась постійною і забирала 15px у КОЖНОЇ
              сторінки. Побічний виграш: хедер тепер поза скролером, а не
              `sticky` над ним */}
          <SidebarInset className="h-svh min-w-0 overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6">
              <SidebarTrigger className="-ml-2" />
              <PageHeaderSlot className="min-w-0 flex-1" />
              <div className="ml-auto flex items-center gap-1">
                <NotificationBell />
                <ThemeSwitcher />
                {/* Найправіший кут хедера — впритул до межі панелі, якою керує */}
                <ContextPanelTrigger />
              </div>
            </header>

            {/* Головний скрол застосунку. `size="lg"` — 12px проти 8px у панелей
                і сіток: ця смуга одна на екран, нею користуються найчастіше, і в
                неї немає сусіда, з яким треба збігтися (та сама логіка, чому в
                будь-якій ОС смуга вікна товща за смугу випадайки) */}
            <ScrollArea className="min-h-0 flex-1" size="lg" viewportRef={viewportRef}>
              {/* div, а не main: SidebarInset реєстру САМ рендериться як <main>,
                і вкладений <main> був би невалідним */}
              {/* На всю ширину: у списках таблиці широкі, і центрована колонка
                max-w-5xl зʼїдала б половину екрана. Відступи — від роуту:
                сторінка-полотно (грід, календар) бере `bleed` і впирається в краї,
                решта лишається з полями шела (див. StaticDataRouteOption) */}
              <div className={cn('min-h-full', isBleed ? 'p-0' : 'px-6 pt-4 pb-6')}>
                <Outlet />
              </div>
            </ScrollArea>
          </SidebarInset>

          {/* Контекстна панель — СУСІД `SidebarInset`, а не його дитина: вона
              йде від верху вікна до низу і підрізає хедер справа так само, як
              лівий сайдбар підрізає його зліва. Порожня (сторінка нічого в неї
              не поклала) вона не займає нічого. Деталі — context-panel-slot.tsx */}
          <ContextPanelSlot />
        </SidebarProvider>
      </ContextPanelProvider>
    </PageHeaderSlotProvider>
  );
}
