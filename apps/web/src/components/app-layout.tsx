import { LayoutDashboard, Users } from 'lucide-react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
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
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { useAuthStore } from '../stores/auth.store';
import { NotificationBell } from './notifications/notification-bell';
import { UserIdentity } from './user-identity';

/**
 * Каркас застосунку на реєстровому `Sidebar` (UI-1, костиль 11 у docs/migrate-web.md):
 * рукописного `<aside class="w-60">` з парою класів на hover/active більше немає, а
 * разом із компонентом приїхали згортання, мобільний режим (сайдбар стає `Sheet`) і
 * збереження стану — усе те, чого рукописна версія не мала.
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
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-4 text-lg font-semibold text-primary">
          {t('brand')}
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
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
          <SidebarTrigger className="-ml-2" />
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <ThemeSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t('accountMenu')}
                    variant="ghost"
                    className="h-9 rounded-full"
                  />
                }
              >
                <UserIdentity
                  email={user?.email ?? ''}
                  name={user?.name}
                  avatarUrl={user?.avatarUrl}
                  // На вузьких екранах лишається сам аватар — підписи ховаються,
                  // а не тиснуть хедер (той самий компонент, інший брейкпоінт)
                  textClassName="hidden text-start sm:flex"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onClick={logout}>
                    {t('logout')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
