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
import { BrandBackdrop } from '@saas-skeleton/ui/components/brand-backdrop';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { NotificationBell } from '../components/notifications/notification-bell';
import { AiPanel } from '../components/ai/ai-panel';
import { AiPanelTrigger } from '../components/ai/ai-panel-trigger';
import { useAiEnabled } from '../components/ai/use-ai-enabled';
import { useAiPanelStore } from '../stores/ai-panel.store';
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
 * = `--area-sidebar-width`, дефолт і мінімум 14rem (224px, крок `w-56` шкали
 * Tailwind) — нижня межа класичного діапазону навігаційної панелі 224…256px
 * (`15rem`/240px — Linear, Notion; `16rem`/256px — Material 2 і сток самого
 * shadcn). Тягуча: `ResizeHandle` у `AreaSidebar` мутує саме цю змінну напряму
 * на `document.documentElement` (`useResizablePanelWidth`), тому вона й винесена
 * в CSS-змінну з фолбеком (`var(--area-sidebar-width, 14rem)`), а не захардкожена
 * в `calc()`, — до першого пейнта хука фолбек дає той самий дефолт.
 *
 * `+ 2px` — не магія, а компенсація двох меж по 1px: правої в контейнера сайдбара
 * і правої в рейла. Без них панель вийшла б 222px замість 224px.
 */
export function AppShell() {
  // Останній збіг перемагає: режим оголошує САМА сторінка, а не її area —
  // `/workspace/users` полотно, а сусідня `/workspace/users/$userId` ні
  const matches = useMatches();
  const isBleed = matches.at(-1)?.staticData.layout === 'bleed';
  // Так само від сторінки — брендовий фон і скляний шел над ним
  // (`libs/ui/src/brand-backdrop.css`). Робочі екрани його не оголошують
  const backdrop = matches.at(-1)?.staticData.backdrop;

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
  // Асистент: прапорець інсталяції і стан панелі. Обидва — поза роутером, тому
  // панель переживає перехід між area без жодного ефекту «не забути зберегти»
  const isAiEnabled = useAiEnabled();
  const isAiOpen = useAiPanelStore((state) => state.isOpen);

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
          data-backdrop={backdrop}
          style={
            {
              '--sidebar-width': 'calc(var(--area-sidebar-width, 14rem) + var(--sidebar-width-icon) + 2px)',
              // `--context-panel-width` не оголошується тут: її дефолт і фолбек
              // живуть у самому `context-panel-slot.tsx` (`var(--context-panel-width,18rem)`),
              // а поточне значення виставляє `useResizablePanelWidth` на
              // `document.documentElement` — та сама схема, що й для area
            } as CSSProperties
          }
        >
          {/* Фон — ПЕРША дитина і без z-index: так він під фіксованим
            сайдбаром і під `SidebarInset`, але над непрозорим `body` */}
          {backdrop === 'brand' && <BrandBackdrop />}

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
            <header
              data-slot="app-header"
              className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6"
            >
              <SidebarTrigger className="-ml-2" />
              <PageHeaderSlot className="min-w-0 flex-1" />
              <div className="ml-auto flex items-center gap-1">
                <NotificationBell />
                <ThemeSwitcher />
                {isAiEnabled && <AiPanelTrigger />}
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

          {/* Асистент — НАЙПРАВІША колонка, сусід `ContextPanelSlot`, а не його
              дитина: так само йде від верху вікна до низу і підрізає хедер
              справа. Може бути відкритий одночасно з контекстною панеллю —
              вони незалежні. Не рендериться зовсім, поки фіча вимкнена в
              інсталяції (`features.ai` з bootstrap) */}
          {isAiEnabled && isAiOpen && <AiPanel />}
        </SidebarProvider>
      </ContextPanelProvider>
    </PageHeaderSlotProvider>
  );
}
