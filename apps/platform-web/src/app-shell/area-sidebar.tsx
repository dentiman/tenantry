import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarHeader } from '@saas-skeleton/ui/components/ui/sidebar';
import { DEFAULT_AREA, resolveArea } from './areas';

/**
 * Другий рівень навігації — колонка активної area (Side Bar у VS Code,
 * Tool Window у JetBrains). Дзеркало `apps/web/src/app-shell/area-sidebar.tsx`.
 *
 * Перший рядок шапки — назва консолі (`t('brand')`), а не назва тенанта: суб'єкт
 * контрол-плейну — сама платформа, і ендпоінта на кшталт `GET /settings/bootstrap`
 * тут немає. Другий рядок — активна area, як у tenant-web.
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
        {/* Два рядки тієї самої форми, що в apps/web: бренд зверху, під ним
            сірим — активний розділ. Знак живе в рейлі, тут лишився самий текст */}
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
