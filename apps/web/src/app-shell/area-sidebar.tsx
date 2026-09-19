import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarHeader } from '@saas-skeleton/ui/components/ui/sidebar';
import { ResizeHandle } from '@saas-skeleton/ui/components/resize-handle';
import { useSettingsBootstrap } from '../api/generated/api';
import { DEFAULT_AREA, resolveArea } from './areas';

/**
 * Другий рівень навігації — колонка активної area (Side Bar у VS Code,
 * Tool Window у JetBrains).
 *
 * Це НЕ «підменю»: area віддає сюди довільний компонент, тож у чаті тут буде
 * список розмов із пошуком, а не пункти. Ті area, що справді є меню, беруть
 * спільний `AreaNav`.
 *
 * Ширина — `style={{width: 'var(--area-sidebar-width, 14rem)'}}`, свідоме
 * перевизначення: `collapsible="none"` рендерить `w-(--sidebar-width)` (ширину
 * ВСЬОГО блоку, рейл+area), а колонці належить тільки те, що лишилось після
 * рейлу. Інлайн-стиль б'є клас за специфічністю, тож перевизначати сам клас не
 * треба. `ResizeHandle` на правій межі тягне саме цю змінну — `app-shell.tsx`
 * збирає з неї `--sidebar-width` (`calc(var(--area-sidebar-width, 14rem) + ...)`),
 * тож зовнішній контейнер сайдбара завжди рівно на ширину рейлу ширший за area, і
 * нового вільного/зайнятого простору між ними не з'являється. У `Sheet` на
 * мобільному колонка так само займає що лишилось.
 *
 * **`min-w-0` тут обовʼязковий.** Flex-елемент за замовчуванням має
 * `min-width: auto`, тобто відмовляється стискатися нижче min-content свого
 * вмісту — і колонка, у якій зʼявилося щось широке (міні-місяць календаря),
 * виїжджала за праву межу шела на її ж рівно 11px, а `overflow-hidden`
 * зовнішнього `Sidebar` цю смугу зрізав: вміст «зʼїжджав праворуч і ховався за
 * лінією». Спіймано в браузері 2026-09-07. Без `min-w-0` та сама пастка чекала б
 * і на списку розмов у чаті, і на будь-якому довгому лейблі.
 *
 * Шапка колонки — `h-14` з нижньою межею, тобто та сама висота, що в шапці рейлу
 * і в хедері контенту: три межі складаються в одну неперервну лінію через усе
 * вікно. Усередині — назва тенанта великим і активна area сірим під нею: та
 * сама двоярусна форма, що була у брендовому блоці до появи рейлу, тільки знак
 * тепер живе у смузі, а другий рядок став динамічним.
 *
 * Назва тенанта — `settings.general.name` із `GET /settings/bootstrap`
 * (`useSettingsBootstrap`, `staleTime: Infinity`, той самий кеш, що й
 * `useCalendarPreferences`): бекенд-дефолт `"Default Tenant"` рідко відповідає
 * реальній назві компанії, тож продукт-бренд тут показувати не можна. До першої
 * відповіді — фолбек на `t('brand')`, щоб шапка не була порожньою на
 * холодному старті. Оновлюється сама: сторінка `/settings` інвалідує
 * `getSettingsBootstrapQueryKey()` одразу після збереження General.
 */
export function AreaSidebar() {
  const { t } = useTranslation('layout');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Шлях поза всіма area (404) — навігацію все одно показуємо, щоб був вихід
  const area = resolveArea(pathname) ?? DEFAULT_AREA;
  const AreaContent = area.Sidebar;
  const { data: bootstrap } = useSettingsBootstrap({
    query: { staleTime: Number.POSITIVE_INFINITY },
  });
  const tenantName = bootstrap?.general.name ?? t('brand');

  return (
    <Sidebar
      collapsible="none"
      className="relative min-w-0 shrink-0"
      style={{ width: 'var(--area-sidebar-width, 14rem)' }}
    >
      <ResizeHandle
        edge="right"
        grow="right"
        cssVar="--area-sidebar-width"
        storageKey="app-shell:area-sidebar-width"
        defaultWidthPx={224}
        minWidthPx={224}
        maxRatio={0.4}
      />
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border px-4">
        {/* Два рядки тієї самої форми, що мав бренд у сайдбарі до появи рейлу:
            назва тенанта зверху, під нею сірим — активний розділ. Знак
            переїхав у смугу, тому тут лишився самий текст */}
        <div className="grid leading-tight">
          <span className="truncate font-semibold">{tenantName}</span>
          <span className="truncate text-xs text-muted-foreground">{t(area.labelKey)}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <AreaContent />
      </SidebarContent>
    </Sidebar>
  );
}
