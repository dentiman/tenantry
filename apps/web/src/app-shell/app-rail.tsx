import { Layers, UserCog } from 'lucide-react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { authLogout } from '../api/generated/api';
import { getStoredRefreshToken, useAuthStore } from '../stores/auth.store';
import { APP_AREAS, type AppArea, resolveArea } from './areas';

/**
 * Кнопка ПУНКТУ рейлу: 32px зі стоковим `p-2` (8px) і піктограмою 16px — тобто
 * рівно та сама метрика, що в пунктів другої колонки (`AreaNav`). Два рівні
 * навігації мусять читатись як одна система, а не як два різні набори іконок,
 * тому падінг і розмір іконки тут НЕ перевизначаються взагалі: і базовий `p-2`
 * варіанта, і його ж `group-data-[collapsible=icon]:p-2!` дають ті самі 8px, а
 * `[&_svg]:size-4` — ті самі 16px.
 *
 * Перевизначений лише бокс: `size-8!` робить кнопку квадратною (інакше вона була
 * б `w-full`, тобто 40×32 у розгорнутому стані й 32×32 у згорнутому — підкладка
 * наведення міняла б форму). Центрувати нічим не треба: група несе стокові `p-2`,
 * ті самі, що група другої колонки, тож 48 − 16 = 32px рядка займає рівно кнопка.
 *
 * Дубль `group-data-[collapsible=icon]:size-8!` ОБОВʼЯЗКОВИЙ: у варіанті під цим
 * модифікатором свій `size-8!`, і голий `size-8!` йому не конкурент (модифікатори
 * різні → tailwind-merge лишає обидва). Тут значення збігаються, але правило
 * тримаємо явним — інакше наступна зміна боксу тихо не подіє у згорнутому стані.
 */
const RAIL_NAV_BUTTON = 'size-8! justify-center group-data-[collapsible=icon]:size-8!';

/**
 * Кнопка-ЯКІР рейлу — бренд угорі й аватар унизу: 40px без падінгу, вміст на всі
 * 32px, знак 20px. Вони не пункти меню, а межі смуги: пункти можна перелічувати,
 * а цих завжди рівно два, і саме вони тримають смугу від верху до низу. Тому
 * метрика тут своя, більша за пункти, і зменшення пунктів її не торкається.
 *
 * `p-0!` + дубль під `group-data-[collapsible=icon]:` ОБОВʼЯЗКОВІ: варіант має
 * `group-data-[collapsible=icon]:p-2!`, і без дубля згорнутий стан давав 8px
 * падінгу на 40px коробку — 32px вміст стискався і з'їжджав вправо, обрізаючись
 * `overflow-hidden` самої кнопки. Іконки цього не показували (вони у звужений
 * бокс якраз влазять), тому симптом було видно лише на плитці й аватарі.
 *
 * `[&_svg]` — ЄДИНЕ джерело розміру знака: селектор нащадка специфічніший за клас
 * на елементі, тож «на місці» його не перебити без `!`.
 */
const RAIL_ANCHOR_BUTTON =
  'size-10! justify-center p-0! [&_svg]:size-5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! ' +
  // Обидва якорі смуги — БЕЗ підкладки на наведенні. Вони не пункти меню, а
  // вміст у них має власну форму: бренд — кольорова плитка `rounded-lg`,
  // аватар — коло; прямокутна сіра підкладка `rounded-md` під ними світилась би
  // кутиками навколо. Гасимо рівно ті стани, які дає `sidebarMenuButtonVariants`
  // (`hover`, `active` і `data-open:hover` — останній тримає фон, поки дропдаун
  // відкритий); focus-ring лишається — він потрібен клавіатурі.
  'hover:bg-transparent active:bg-transparent data-open:hover:bg-transparent';

/**
 * Перший рівень навігації — вузька смуга іконок area (Activity Bar у VS Code,
 * navigation rail у Material/Slack, Tool Window Stripe у JetBrains).
 *
 * Склад — той самий, що в реєстровому блоці `sidebar-09`: бренд угорі, пункти
 * посередині, профіль у футері. Бренд і профіль належать СЕСІЇ, а не area, тому
 * стоять у смузі, яка від area не залежить.
 *
 * Рейл НЕ згортається: він і є згорнутий стан. Кнопка в хедері (і Cmd+B) ховає
 * ДРУГУ колонку — рівно як у VS Code, і рівно тим самим механізмом, що раніше
 * згортав єдиний сайдбар, тож cookie `sidebar_state` лишився тим самим.
 *
 * Геометрія: група має стокові `p-2`, кнопка — рівно 32px без падінгу, разом
 * 48px = `--sidebar-width-icon`, тому іконка стоїть по центру смуги і в
 * розгорнутому, і в згорнутому стані.
 */
export function AppRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const user = useAuthStore((s) => s.user);
  const activeAreaId = resolveArea(pathname)?.id;

  const areas = APP_AREAS.filter(
    (area) => !area.hiddenFromRail && (!area.canSee || (user ? area.canSee(user) : false)),
  );

  return (
    <Sidebar
      collapsible="none"
      className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r border-sidebar-border group-data-[collapsible=icon]:border-r-0"
    >
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border p-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <AppBrand />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Стокові `p-2`, ТІ САМІ, що в групи другої колонки (`AreaNav`): від них
            залежить вертикальна координата першого рядка, тож будь-яка розбіжність
            тут — це видима сходинка між рівнями навігації. Заодно 8px жолоби дають
            рівно 32px під кнопку (48 − 16), тобто вона займає рядок точно */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {areas.map((area) => (
                <AppRailItem key={area.id} area={area} isActive={activeAreaId === area.id} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Бренд у шапці рейлу. У смузі 48px влазить лише плитка, тому назва продукту
 * живе в підказці — так само, як у VS Code і Slack, де верх смуги теж займає
 * самий знак. Коли назва тенанта доїде на фронт (MT-4), плитка стане тригером
 * дропдауна-перемикача.
 *
 * Плитка — 32px, той самий розмір, що аватар у футері: верх і низ смуги читаються
 * як одна система. Знак у ній 20px від правила `[&_svg]` кнопки — свого класу
 * розміру він не має свідомо (див. `RAIL_ANCHOR_BUTTON`). `h-14` шапки дорівнює
 * висоті хедера контенту і шапки другої колонки — три нижні межі складаються в
 * одну неперервну лінію через усе вікно.
 */
function AppBrand() {
  const { t } = useTranslation('layout');
  const { isMobile, setOpenMobile } = useSidebar();
  const label = t('brand');

  return (
    <SidebarMenuButton
      className={RAIL_ANCHOR_BUTTON}
      tooltip={{ children: label, hidden: isMobile }}
      aria-label={label}
      render={<Link to="/workspace" />}
      onClick={() => {
        if (isMobile) {
          setOpenMobile(false);
        }
      }}
    >
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <Layers />
      </div>
    </SidebarMenuButton>
  );
}

/**
 * Пункт рейлу. Активний — `button`, неактивний — `Link`, і це не примха:
 *
 * - неактивний мусить бути посиланням, щоб працювали Cmd+клік, «відкрити в новій
 *   вкладці» і prefetch роутера;
 * - активний навігувати НЕ має — ти вже в цій area, просто глибше (`/workspace/users`),
 *   і перехід на `homeTo` викинув би тебе на дашборд. Клік по активній іконці
 *   згортає/розгортає панель — поведінка VS Code.
 *
 * Робити це одним `Link` із `preventDefault` не варто: порядок склеювання
 * обробників між `useRender` і `Link` не гарантований, тож «не навігувати»
 * трималось би на випадковості.
 */
function AppRailItem({ area, isActive }: { area: AppArea; isActive: boolean }) {
  const { t } = useTranslation('layout');
  const { isMobile, setOpen, setOpenMobile, toggleSidebar } = useSidebar();
  const Icon = area.icon;
  const label = t(area.labelKey);

  // hidden: false — інакше tooltip-а не буде НІКОЛИ: реєстровий SidebarMenuButton
  // показує його лише при `state === 'collapsed'`, а `useSidebar()` віддає стан
  // ЗОВНІШНЬОГО сайдбара. Підписів у рейлі не видно в обох станах, тож підказка
  // потрібна завжди — крім мобільного, де вона лише шум (там смуга в Sheet поруч
  // із панеллю, і тапати по ній нічого не мішає)
  const tooltip = { children: label, hidden: isMobile };

  if (isActive) {
    return (
      <SidebarMenuButton
        isActive
        tooltip={tooltip}
        className={RAIL_NAV_BUTTON}
        aria-label={label}
        onClick={toggleSidebar}
      >
        <Icon />
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton
      tooltip={tooltip}
      className={RAIL_NAV_BUTTON}
      aria-label={label}
      render={<Link to={area.prefix} />}
      onClick={() => {
        // Перехід в іншу area завжди РОЗКРИВАЄ панель: інакше клік по іконці
        // виглядав би як «нічого не сталося»
        setOpen(true);
        if (isMobile) {
          setOpenMobile(false);
        }
      }}
    >
      <Icon />
    </SidebarMenuButton>
  );
}

/**
 * Профіль у футері рейлу — там, де він і має бути після переїзду бренду нагору
 * (той самий патерн, що в Slack і VS Code). У смузі 48px влазить лише аватар,
 * тому повна ідентичність переїхала в шапку дропдауна: інформації стало більше,
 * ніж було в колонці.
 */
function AccountMenu() {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const logout = () => {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      // Здаємо токен серверу, але НЕ чекаємо на відповідь: вихід не має залежати
      // від мережі. Викликаємо згенеровану функцію напряму, а не через хук —
      // помилка тут не подія для юзера, а глобальний MutationCache показав би тост
      void authLogout({ refreshToken }).catch(() => undefined);
    }
    clearSession();
    void navigate({ to: '/login' });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton className={RAIL_ANCHOR_BUTTON} aria-label={t('accountMenu')} />}
      >
        <UserIdentity
          email={user?.email ?? ''}
          name={user?.name}
          avatarUrl={user?.avatarUrl}
          textClassName="hidden"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-56">
        {/* Ідентичність — ЛЕЙБЛ групи особистих дій, а не окремий блок над меню.
            `DropdownMenuLabel` у нас = `MenuPrimitive.GroupLabel`, і Base UI
            вимагає для нього батьківський `Group` (інакше — рантайм-помилка
            «MenuGroupContext is missing»). У блоці `nav-user` реєстру він лежить
            прямо в `DropdownMenuContent` — так можна в Radix, не в Base UI */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="px-2 py-1.5">
              <UserIdentity
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
