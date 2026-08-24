import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.store';
import { ThemeSwitcher } from './theme-switcher';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navLinkClass =
  'block rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
const activeProps = {
  className: 'block rounded-lg px-3 py-2 text-sm font-medium bg-accent text-accent-foreground',
};

export function AppLayout() {
  const { t } = useTranslation('layout');
  const operator = useAuthStore((s) => s.operator);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  const logout = () => {
    clearSession();
    void navigate({ to: '/login' });
  };

  const initial = (operator?.name ?? operator?.email ?? '?').charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-5 py-5 text-lg font-semibold text-primary">{t('brand')}</div>
        <nav className="flex flex-col gap-1 px-3">
          <Link
            to="/"
            className={navLinkClass}
            activeProps={activeProps}
            activeOptions={{ exact: true }}
          >
            {t('nav.tenants')}
          </Link>
          <Link to="/jobs" className={navLinkClass} activeProps={activeProps}>
            {t('nav.jobs')}
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-background px-6">
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
              <Avatar size="sm">
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground">{operator?.email}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={logout}>
                  {t('logout')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
