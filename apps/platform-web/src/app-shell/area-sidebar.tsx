import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarHeader } from '@saas-skeleton/ui/components/ui/sidebar';
import { ResizeHandle } from '@saas-skeleton/ui/components/resize-handle';
import { AreaNav, useDisplayedArea } from '@saas-skeleton/ui/navigation';

/**
 * Другий рівень навігації — колонка активної area (Side Bar у VS Code,
 * Tool Window у JetBrains). Дзеркало `apps/web/src/app-shell/area-sidebar.tsx`
 * (там повне обґрунтування ширини й `ResizeHandle`).
 *
 * Перший рядок шапки — назва консолі (`t('brand')`), а не назва тенанта: суб'єкт
 * контрол-плейну — сама платформа, і ендпоінта на кшталт `GET /settings/bootstrap`
 * тут немає. Другий рядок — активна area, як у tenant-web.
 */
export function AreaSidebar() {
  const { t } = useTranslation('layout');
  // Шлях поза всіма area (404) — показуємо `defaultArea`, щоб був вихід
  const area = useDisplayedArea();

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
        {/* Два рядки тієї самої форми, що в apps/web: бренд зверху, під ним
            сірим — активний розділ. Знак живе в рейлі, тут лишився самий текст */}
        <div className="grid leading-tight">
          <span className="truncate font-semibold">{t('brand')}</span>
          <span className="truncate text-xs text-muted-foreground">{t(area.label)}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {area.panel === 'menu' ? <AreaNav areaId={area.id} /> : <area.panel />}
      </SidebarContent>
    </Sidebar>
  );
}
