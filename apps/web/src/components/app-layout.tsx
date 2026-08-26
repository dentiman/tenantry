import { ChevronsUpDown, LayoutDashboard, Layers, Users } from 'lucide-react';
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
import { NotificationBell } from './notifications/notification-bell';

/**
 * Каркас застосунку на реєстровому `Sidebar` (замінений рукописний `<aside>` —
 * docs/frontend/ui-migration-history.md §4):
 * рукописного `<aside class="w-60">` більше немає, а разом із компонентом приїхали
 * згортання, мобільний режим (сайдбар стає `Sheet`) і збереження стану.
 *
 * Розкладка сайдбара — патерн `sidebar-07` з реєстру shadcn (той самий, який продають
 * блоками ReUI, див. розбір у docs/frontend/ui-registry.md): БРЕНД угорі (плитка + назва +
 * підзаголовок), навігація посередині, ПРОФІЛЬ юзера в футері. У хедері лишаються
 * тільки дзвінок і перемикач теми — те, що стосується поточного екрана, а не сесії.
 *
 * Активний пункт визначаємо самі з `location.pathname`: `SidebarMenuButton` приймає
 * `isActive` пропом, а елемент підміняє `render` (Base UI), а не `asChild`.
 */
export function AppLayout() {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
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
                    <Layers className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">{t('brand')}</span>
                    {/* Підзаголовок — місце для назви тенанта, коли вона зʼявиться на
                      фронті (MT-4); поки що роль інсталяції */}
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
                      <LayoutDashboard />
                      <span>{t('nav.dashboard')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={pathname.startsWith('/users')}
                      render={<Link to="/users" />}
                    >
                      <Users />
                      <span>{t('nav.users')}</span>
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
                      email={user?.email ?? ''}
                      name={user?.name}
                      avatarUrl={user?.avatarUrl}
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
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6">
            <SidebarTrigger className="-ml-2" />
            <PageHeaderSlot className="min-w-0 flex-1" />
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <ThemeSwitcher />
            </div>
          </header>

          {/* div, а не main: SidebarInset реєстру САМ рендериться як <main>,
              і вкладений <main> був би невалідним */}
          {/* На всю ширину з бічними відступами: у списках таблиці широкі, і
              центрована колонка max-w-5xl зʼїдала б половину екрана.
              (shadcn-admin тут має опційний cap max-w-7xl на дуже широких
              екранах — свідомо не беремо, бо просили саме повну ширину) */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderSlotProvider>
  );
}
