import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { UserCog } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import { SidebarMenuButton, useSidebar } from '@saas-skeleton/ui/components/ui/sidebar';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { platformAuthLogout } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

/** Плейсхолдер — версія самого застосунку, `package.json` кореня монорепо */
const APP_VERSION = '0.0.1';

/**
 * Нижня смуга шела — дзеркало `apps/web/src/app-shell/account-footer.tsx` (там
 * повне обґрунтування метрики й розташування).
 */
export function AppFooterBar() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-sidebar-border p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1">
      <AccountMenu />
      <span className="ml-auto shrink-0 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        v{APP_VERSION}
      </span>
    </div>
  );
}

/**
 * Тригер акаунта. На відміну від `apps/web`: `operator` замість `user`, без
 * `avatarUrl` (його немає в `PlatformUserResponse`). AUTH-2: `POST /auth/logout`
 * з'явився в platform-api (дзеркало tenant-api) — кличемо його так само, не
 * чекаючи на відповідь: вихід не має залежати від мережі.
 */
function AccountMenu() {
  const { t } = useTranslation('layout');
  const operator = useAuthStore((s) => s.operator);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const logout = () => {
    void platformAuthLogout().catch(() => undefined);
    clearSession();
    void navigate({ to: '/login' });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton className="min-w-0 flex-1" aria-label={t('accountMenu')} />
        }
      >
        <UserIdentity
          id={operator?.id ?? ''}
          email={operator?.email ?? ''}
          name={operator?.name}
          size="sm"
          showEmail={false}
          textClassName="group-data-[collapsible=icon]:hidden"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-56">
        {/* DropdownMenuLabel = MenuPrimitive.GroupLabel у Base UI: без DropdownMenuGroup
            навколо падає в рантаймі («MenuGroupContext is missing») — граблі §7 плану */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="px-2 py-1.5">
              <UserIdentity
                id={operator?.id ?? ''}
                email={operator?.email ?? ''}
                name={operator?.name}
                className="w-full"
              />
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={<Link to="/user-settings" />}
            onClick={() => {
              if (isMobile) {
                setOpenMobile(false);
              }
            }}
          >
            <UserCog />
            {t('nav.userSettings')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={logout}>
            {t('logout')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
