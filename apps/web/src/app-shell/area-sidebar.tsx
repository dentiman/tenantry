import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarHeader } from '@saas-skeleton/ui/components/ui/sidebar';
import { DEFAULT_AREA, resolveArea } from './areas';

/**
 * Другий рівень навігації — колонка активної area (Side Bar у VS Code,
 * Tool Window у JetBrains).
 *
 * Це НЕ «підменю»: area віддає сюди довільний компонент, тож у чаті тут буде
 * список розмов із пошуком, а не пункти. Ті area, що справді є меню, беруть
 * спільний `AreaNav`.
 *
 * `w-auto flex-1` — свідоме перевизначення: `collapsible="none"` рендерить
 * `w-(--sidebar-width)`, а колонка мусить зайняти те, що лишилось після рейлу.
 * У `Sheet` на мобільному той самий клас дає повну ширину — окремого режиму не
 * потрібно.
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
 * вікно. Усередині — назва інсталяції великим і активна area сірим під нею: та
 * сама двоярусна форма, що була у брендовому блоці до появи рейлу, тільки знак
 * тепер живе у смузі, а другий рядок став динамічним.
 */
export function AreaSidebar() {
  const { t } = useTranslation('layout');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Шлях поза всіма area (404) — навігацію все одно показуємо, щоб був вихід
  const area = resolveArea(pathname) ?? DEFAULT_AREA;
  const AreaContent = area.Sidebar;

  return (
    <Sidebar collapsible="none" className="w-auto min-w-0 flex-1">
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border px-4">
        {/* Два рядки тієї самої форми, що мав бренд у сайдбарі до появи рейлу:
            назва інсталяції зверху, під нею сірим — активний розділ. Знак
            переїхав у смугу, тому тут лишився самий текст */}
        <div className="grid leading-tight">
          <span className="truncate font-semibold">{t('brand')}</span>
          <span className="truncate text-xs text-muted-foreground">{t(area.labelKey)}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <AreaContent />
      </SidebarContent>
    </Sidebar>
  );
}
