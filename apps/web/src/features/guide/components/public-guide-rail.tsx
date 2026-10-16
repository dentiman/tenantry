import {
  BookOpenText,
  CalendarDays,
  Layers,
  LayoutGrid,
  MessagesSquare,
  Settings,
  SparklesIcon,
} from 'lucide-react';
import { Link, linkOptions } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { RAIL_ANCHOR_BUTTON, RAIL_NAV_BUTTON } from '../../../app-shell/app-rail';

/**
 * Розділи, які малює рейл публічного путівника, — СТАТИЧНИЙ знімок, а не вибірка з
 * реєстру навігації (`useRailAreas`). Причини: реєстр без юзера відфільтровує все, а
 * вчити спільну навігацію окремому «гостьовому» режиму заради демо-сторінки — це
 * зайвий режим доступу; і власник очікує, що меню CRM зростатиме, тоді як тут воно має
 * лишатись «приблизно таким, як зараз». Тож список рукописний: порядок і піктограми
 * збігаються з `order` / `icon` справжніх `*.nav.ts`, підписи — ті самі
 * `layout:areas.*`. Додали чи перейменували розділ у рейлі — освіжити тут (docs/demo.md).
 * Playground тут немає свідомо: він лише для локальної розробки (`VITE_PLAYGROUND`).
 *
 * `link` — справжні адреси застосунку. Гостя на них зустріне існуючий гейт `requireAuth`
 * і поверне на `/login` — власного коду для цього немає; залогінений потрапить у розділ.
 * `linkOptions` типізує адресу (так само, як у `*.nav.ts`): якщо форк прибере розділ, тут
 * буде помилка компіляції, а не мертве посилання.
 */
const RAIL_AREAS = [
  { id: 'workspace', link: linkOptions({ to: '/workspace' }), icon: LayoutGrid },
  { id: 'chat', link: linkOptions({ to: '/chat' }), icon: MessagesSquare },
  { id: 'calendar', link: linkOptions({ to: '/calendar' }), icon: CalendarDays },
  { id: 'assistant', link: linkOptions({ to: '/assistant' }), icon: SparklesIcon },
  // Поточний розділ: без посилання, клік згортає/розгортає другу колонку
  { id: 'guide', link: null, icon: BookOpenText },
  { id: 'settings', link: linkOptions({ to: '/settings' }), icon: Settings },
] as const;

/**
 * Рейл публічного путівника — копія `AppRail` без реєстру (див. `RAIL_AREAS`): ті самі
 * `Sidebar`/`SidebarMenuButton` і ті самі метрики кнопок (`RAIL_NAV_BUTTON`,
 * `RAIL_ANCHOR_BUTTON` експортує справжній рейл), тож смуга однакова за розміром і
 * формою. Бренд угорі, розділи посередині; «Guide» — поточний (запис без `link`) і, як у справжньому
 * рейлі, клік по ньому згортає/розгортає другу колонку.
 */
export function PublicGuideRail() {
  const { t } = useTranslation('layout');
  const { isMobile, setOpenMobile, setOpen, toggleSidebar } = useSidebar();
  const tooltip = (label: string) => ({ children: label, hidden: isMobile });
  // На мобільному смуга в `Sheet`: перехід у розділ мусить закрити панель
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar
      collapsible="none"
      className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r border-sidebar-border group-data-[collapsible=icon]:border-r-0"
    >
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border p-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className={RAIL_ANCHOR_BUTTON}
              tooltip={tooltip(t('brand'))}
              aria-label={t('brand')}
              render={<Link to="/workspace" />}
              onClick={closeOnMobile}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Layers />
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {RAIL_AREAS.map((area) => {
                const Icon = area.icon;
                const label = t(`areas.${area.id}`);
                return (
                  <SidebarMenuItem key={area.id}>
                    {area.link ? (
                      <SidebarMenuButton
                        className={RAIL_NAV_BUTTON}
                        tooltip={tooltip(label)}
                        aria-label={label}
                        render={<Link {...area.link} />}
                        onClick={() => {
                          // Перехід в іншу area завжди РОЗКРИВАЄ панель — як у справжньому рейлі
                          setOpen(true);
                          closeOnMobile();
                        }}
                      >
                        <Icon />
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        isActive
                        className={RAIL_NAV_BUTTON}
                        tooltip={tooltip(label)}
                        aria-label={label}
                        onClick={toggleSidebar}
                      >
                        <Icon />
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
