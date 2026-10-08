import { Layers } from 'lucide-react';
import { Link } from '@tanstack/react-router';
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
import { useActiveArea, useRailAreas, type Area } from '@saas-skeleton/ui/navigation';

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
 * Кнопка-ЯКІР рейлу — зараз лише бренд угорі (аватар унизу переїхав у спільну
 * `AppFooterBar` — 2026-09-10): 40px без падінгу, вміст на всі 32px, знак 20px.
 * Це не пункт меню, а межа смуги — тому метрика своя, більша за пункти рейлу.
 *
 * `p-0!` + дубль під `group-data-[collapsible=icon]:` ОБОВʼЯЗКОВІ: варіант має
 * `group-data-[collapsible=icon]:p-2!`, і без дубля згорнутий стан давав 8px
 * падінгу на 40px коробку — 32px вміст стискався і з'їжджав вправо, обрізаючись
 * `overflow-hidden` самої кнопки. Іконка цього не показувала (вона у звужений
 * бокс якраз влазить), тому симптом було видно лише на плитці.
 *
 * `[&_svg]` — ЄДИНЕ джерело розміру знака: селектор нащадка специфічніший за клас
 * на елементі, тож «на місці» його не перебити без `!`.
 */
const RAIL_ANCHOR_BUTTON =
  'size-10! justify-center p-0! [&_svg]:size-5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! ' +
  // Якір смуги — БЕЗ підкладки на наведенні. Це не пункт меню, а кольорова
  // плитка `rounded-lg`; прямокутна сіра підкладка `rounded-md` під нею
  // світилась би кутиками навколо. Гасимо рівно ті стани, які дає
  // `sidebarMenuButtonVariants` (`hover`, `active` і `data-open:hover` —
  // останній тримає фон, поки дропдаун відкритий); focus-ring лишається — він
  // потрібен клавіатурі.
  'hover:bg-transparent active:bg-transparent data-open:hover:bg-transparent';

/**
 * Перший рівень навігації — вузька смуга іконок area (Activity Bar у VS Code,
 * navigation rail у Material/Slack, Tool Window Stripe у JetBrains).
 *
 * Склад — бренд угорі й пункти посередині (профіль переїхав у спільну нижню
 * смугу шела `AppFooterBar` — 2026-09-10: там для нього є місце на всю ширину
 * ОБОХ колонок, а не тільки 48px рейлу, як у реєстровому `sidebar-09`). Бренд
 * належить СЕСІЇ, а не area, тому стоїть у смузі, яка від area не залежить.
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
  const activeAreaId = useActiveArea()?.id;
  const areas = useRailAreas();

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
    </Sidebar>
  );
}

/**
 * Бренд у шапці рейлу. У смузі 48px влазить лише плитка, тому назва продукту
 * живе в підказці — так само, як у VS Code і Slack, де верх смуги теж займає
 * самий знак. Коли назва тенанта доїде на фронт (MT-4), плитка стане тригером
 * дропдауна-перемикача.
 *
 * Плитка — 32px, той самий розмір, що аватар у нижній смузі шела: верх і низ
 * читаються як одна система. Знак у ній 20px від правила `[&_svg]` кнопки — свого класу
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
function AppRailItem({ area, isActive }: { area: Area; isActive: boolean }) {
  const { t } = useTranslation('layout');
  const { isMobile, setOpen, setOpenMobile, toggleSidebar } = useSidebar();
  const Icon = area.icon;
  const label = t(area.label);

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
