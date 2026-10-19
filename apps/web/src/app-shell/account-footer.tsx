import { Link } from '@tanstack/react-router';
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
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@saas-skeleton/ui/components/ui/popover';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { SidebarMenuButton, useSidebar } from '@saas-skeleton/ui/components/ui/sidebar';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { endSession } from '../features/auth/lib/end-session';
import { useAuthStore } from '../features/auth/stores/auth.store';
import { buildInfo } from '../lib/build-info';

/**
 * Нижня смуга шела — на всю ширину ОБОХ колонок (рейл + панель), під ними й
 * відділена лінією зверху: той самий патерн, що воркспейс-рядок унизу
 * сайдбара в Notion. Живе СИБЛІНГОМ до `<AppRail/><AreaSidebar/>` у
 * `app-shell.tsx`, а не всередині рейлу — інакше вона обмежилась би 48px
 * рейлу й не змогла б рознести тригер акаунта та праву групу кнопок.
 *
 * Права частина — кнопка версії застосунку, що відкриває попап «Про збірку»
 * (`BuildInfoPopover`); поруч є місце під майбутні кнопки (запрошення,
 * довідка), як у Notion поруч із воркспейс-перемикачем. Ховається в згорнутому стані разом з усім, крім
 * самого аватара — так само, як другий рядок `AreaSidebar`.
 *
 * `h-12`/`p-2` — тісніше за решту рядків шела (`h-14`) навмисно: це
 * службовий рядок унизу, а не рівень навігації, і в Notion він теж
 * помітно нижчий за пункти над ним. (Перша спроба, `h-10`/`p-1.5`,
 * була тісніша за це — рядок читався тоншим за все, що над ним, а не
 * просто компактнішим.)
 */
export function AppFooterBar() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-sidebar-border p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1">
      <AccountMenu />
      <BuildInfoPopover />
    </div>
  );
}

/**
 * Версія збірки (`scripts/build-info.ts`, змінюється з кожним деплоєм) як кнопка;
 * у попапі — коли зібрано і з якого коміту, та історія проєкту з
 * `docs/history-summary.md`. Історія — ДЕМО-ДАНІ (`docs/build-info.md`), про що
 * попап каже прямо. Без обводки, `ghost`: кнопка не мусить важити оком більше за
 * сам тригер акаунта поруч.
 */
function BuildInfoPopover() {
  const { t, i18n } = useTranslation('layout');
  const { version, commit, builtAt, history } = buildInfo;
  const builtAtLabel =
    builtAt === ''
      ? null
      : new Date(builtAt).toLocaleString(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
            aria-label={t('build.open', { version })}
          />
        }
      >
        v{version}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-80">
        <PopoverHeader>
          <PopoverTitle>{t('build.title')}</PopoverTitle>
          <PopoverDescription>
            {t('build.version', { version })}
            {commit !== null && ` · ${commit}`}
            {builtAtLabel !== null && <> · {builtAtLabel}</>}
          </PopoverDescription>
        </PopoverHeader>
        {history !== null && (
          <>
            <div className="border-t pt-2.5">
              <p className="text-xs font-medium">{history.title || t('build.history')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('build.demoNote')}</p>
            </div>
            <ScrollArea className="max-h-80">
              <dl className="flex flex-col gap-1.5 pr-2 text-xs">
                {history.entries.map((entry) => (
                  <div key={entry.label}>
                    <dt className="flex gap-1.5">
                      <span className="shrink-0 font-medium">{entry.label}</span>
                      <span className="text-muted-foreground">{entry.value}</span>
                    </dt>
                    {entry.children.length > 0 && (
                      <dd className="mt-0.5 flex flex-col gap-0.5 pl-3 text-muted-foreground">
                        {entry.children.map((child) => (
                          <div key={child.label} className="flex justify-between gap-2">
                            <span>{child.label}</span>
                            <span className="tabular-nums">{child.value}</span>
                          </div>
                        ))}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Тригер акаунта — зліва в нижній смузі, на всю ширину, що лишилась після
 * правої групи (`flex-1`). У згорнутому стані (`collapsible=icon`) стискається
 * до тих самих 32px, що й пункти рейлу (`sidebarMenuButtonVariants` дає це
 * сам через `group-data-[collapsible=icon]:size-8!`), а ім'я/пошта ховаються.
 *
 * `side="top"`: кнопка стоїть унизу шела, тому меню відкривається ВГОРУ, а не
 * вбік, як було раніше, коли тригер жив у вузькій 48px колонці рейлу і вбік
 * було єдиним місцем, куди влазив попап.
 */
function AccountMenu() {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
  const { isMobile, setOpenMobile } = useSidebar();

  // Здати refresh-cookie і перезавантажити документ: кеш і стори попереднього
  // користувача не повинні дожити до наступного входу (`end-session.ts`)
  const logout = () => {
    void endSession();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton className="min-w-0 flex-1" aria-label={t('accountMenu')} />}
      >
        <UserIdentity
          id={user?.id ?? ''}
          email={user?.email ?? ''}
          name={user?.name}
          avatarUrl={user?.avatarUrl}
          size="sm"
          showEmail={false}
          textClassName="group-data-[collapsible=icon]:hidden"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-56">
        {/* Ідентичність — ЛЕЙБЛ групи особистих дій, а не окремий блок над меню.
            `DropdownMenuLabel` у нас = `MenuPrimitive.GroupLabel`, і Base UI
            вимагає для нього батьківський `Group` (інакше — рантайм-помилка
            «MenuGroupContext is missing»). У блоці `nav-user` реєстру він лежить
            прямо в `DropdownMenuContent` — так можна в Radix, не в Base UI */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="px-2 py-1.5">
              <UserIdentity
                id={user?.id ?? ''}
                email={user?.email ?? ''}
                name={user?.name}
                avatarUrl={user?.avatarUrl}
                className="w-full"
              />
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Під аватаром — ТІЛЬКИ особисте. Налаштування організації живуть
              окремою area в рейлі: так два «Settings» ніде не стикаються
              (патерн GitLab/Notion, docs/settings.md) */}
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
