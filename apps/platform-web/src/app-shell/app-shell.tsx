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
import { AppFooterBar } from './account-footer';
import { AppRail } from './app-rail';
import { AreaSidebar } from './area-sidebar';

/**
 * Каркас control plane: ДВІ навігаційні колонки і контент — дзеркало
 * `apps/web/src/app-shell/app-shell.tsx` (там повне обґрунтування метрик,
 * ширин і компенсації меж; тут лишено лише те, що дійсно різне).
 *
 * Різниця від web: у хедері немає `NotificationBell` — сповіщення tenant-фіча,
 * у контрол-плейні їх немає взагалі.
 */
export function AppShell() {
  const matches = useMatches();
  const isBleed = matches.at(-1)?.staticData.layout === 'bleed';

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <PageHeaderSlotProvider>
      <ContextPanelProvider>
        <SidebarProvider
          style={
            {
              '--sidebar-width': 'calc(14rem + var(--sidebar-width-icon) + 2px)',
              '--context-panel-width': '18rem',
            } as CSSProperties
          }
        >
          <Sidebar collapsible="icon" className="overflow-hidden">
            <div className="flex min-h-0 flex-1">
              <AppRail />
              <AreaSidebar />
            </div>
            <AppFooterBar />
          </Sidebar>

          <SidebarInset className="h-svh min-w-0 overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6">
              <SidebarTrigger className="-ml-2" />
              <PageHeaderSlot className="min-w-0 flex-1" />
              <div className="ml-auto flex items-center gap-1">
                <ThemeSwitcher />
                <ContextPanelTrigger />
              </div>
            </header>

            <ScrollArea className="min-h-0 flex-1" size="lg" viewportRef={viewportRef}>
              <div className={cn('min-h-full', isBleed ? 'p-0' : 'px-6 pt-4 pb-6')}>
                <Outlet />
              </div>
            </ScrollArea>
          </SidebarInset>

          <ContextPanelSlot />
        </SidebarProvider>
      </ContextPanelProvider>
    </PageHeaderSlotProvider>
  );
}
