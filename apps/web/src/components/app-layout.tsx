import { Avatar, Dropdown } from '@heroui/react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.store';
import { ThemeSwitcher } from './theme-switcher';

const navLinkClass =
  'block rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-background-secondary hover:text-foreground';
const activeProps = {
  className: 'block rounded-lg px-3 py-2 text-sm font-medium bg-accent-soft text-accent-soft-foreground',
};

export function AppLayout() {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  const logout = () => {
    clearSession();
    void navigate({ to: '/login' });
  };

  const initial = (user?.name ?? user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-5 py-5 text-lg font-semibold text-accent">{t('brand')}</div>
        <nav className="flex flex-col gap-1 px-3">
          <Link
            to="/"
            className={navLinkClass}
            activeProps={activeProps}
            activeOptions={{ exact: true }}
          >
            {t('nav.dashboard')}
          </Link>
          <Link to="/users" className={navLinkClass} activeProps={activeProps}>
            {t('nav.users')}
          </Link>
          <Link to="/jobs" className={navLinkClass} activeProps={activeProps}>
            {t('nav.jobs')}
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-surface px-6">
          <ThemeSwitcher />
          <Dropdown>
            <Dropdown.Trigger
              aria-label={t('accountMenu')}
              className="flex cursor-pointer items-center gap-2 rounded-full"
            >
              <Avatar size="sm">
                <Avatar.Fallback>{initial}</Avatar.Fallback>
              </Avatar>
              <span className="text-sm text-muted">{user?.email}</span>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === 'logout') {
                    logout();
                  }
                }}
              >
                <Dropdown.Item id="logout" textValue={t('logout')} className="text-danger">
                  {t('logout')}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
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
