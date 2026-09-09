import { Building2, ChevronsUpDown, ListChecks, ShieldCheck } from 'lucide-react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@saas-skeleton/ui/components/ui/sidebar';
import {
  PageHeaderSlot,
  PageHeaderSlotProvider,
} from '@saas-skeleton/ui/components/page-header-slot';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { useAuthStore } from '../stores/auth.store';

/**
 * Каркас control plane. Розкладка та сама, що в `apps/web` (патерн `sidebar-07`
 * реєстру shadcn): бренд угорі, навігація посередині, профіль оператора у футері,
 * у хедері — лише перемикач теми (дзвінка тут немає: сповіщення це tenant-фіча).
 */
export function AppLayout() {
  const { t } = useTranslation('layout');
  const operator = useAuthStore((s) => s.operator);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const logout = () => {
    clearSession();
    void navigate({ to: '/login' });
  };

  return (
    // Хедер тримає слот, який наповнюють сторінки (крихти) — див. page-header-slot.tsx
    <PageHeaderSlotProvider>
      <SidebarProvider>
        {/* collapsible="icon" — як у прикладу, з якого взято розкладку: згорнутий
          сайдбар стає смугою іконок, а не зникає (дефолт реєстру — offcanvas) */}
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<Link to="/" />}>
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">{t('brand')}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t('brandSubtitle')}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={pathname === '/'} render={<Link to="/" />}>
                      <Building2 />
                      <span>{t('nav.tenants')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={pathname.startsWith('/jobs')}
                      render={<Link to="/jobs" />}
                    >
                      <ListChecks />
                      <span>{t('nav.jobs')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<SidebarMenuButton size="lg" aria-label={t('accountMenu')} />}
                  >
                    <UserIdentity
                      id={operator?.id ?? ''}
                      email={operator?.email ?? ''}
                      name={operator?.name}
                      className="min-w-0 flex-1"
                    />
                    <ChevronsUpDown className="ml-auto shrink-0 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuItem variant="destructive" onClick={logout}>
                        {t('logout')}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-6 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-xl">
            <SidebarTrigger className="-ml-2" />
            <PageHeaderSlot className="min-w-0 flex-1" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeSwitcher />
            </div>
          </header>

          {/* div, а не main: SidebarInset реєстру САМ рендериться як <main>,
              і вкладений <main> був би невалідним */}
          {/* На всю ширину з бічними відступами: у списках таблиці широкі, і
              центрована колонка max-w-5xl зʼїдала б половину екрана.
              (shadcn-admin тут має опційний cap max-w-7xl на дуже широких
              екранах — свідомо не беремо, бо просили саме повну ширину) */}
          <div className="flex-1 px-6 pt-4 pb-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderSlotProvider>
  );
}
