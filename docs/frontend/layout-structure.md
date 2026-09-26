# Layout: структура шела (мапа)

> Швидка візуальна мапа + словник назв усіх елементів розкладки (обидва фронти).
> Обґрунтування рішень, метрики й граблі — `docs/frontend/app-shell.md`; тут лише
> «що як називається і де лежить», без «чому».

## 1. Схема (`apps/web`, та сама модель у `apps/platform-web` з 2026-09-12)

Чотири колонки вікна зліва направо. Верхній рядок кожної — `h-14` з `border-b`; усі
чотири стоять на одній горизонталі й складаються в одну неперервну лінію через усе
вікно (§5.4 `app-shell.md`) — саме тому на схемі вони на одному рівні:

```
┌───────────────┬────────────────────────┬──────────────────────────────────────────┬──────────────────────┐
│ AppRail       │ AreaSidebar            │ SidebarInset                             │ ContextPanel         │
│ 48px          │ 224px, resizable*      │ flex-1 (гнучка)                          │ 288px*, за потреби   │
├───────────────┼────────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ * бренд       │ Назва інсталяції       │ Trigger  PageHeaderSlot  дзвінок  тема   │ X  Заголовок         │
│ h-14          │ h-14                   │ h-14                                     │ h-14                 │
├───────────────┼────────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ - Workspace   │                        │                                          │                      │
│ - Calendar    │ area.Sidebar:          │                                          │ ScrollArea           │
│ - Chat        │   AreaNav (меню)       │                                          │   + p-2              │
│ - Settings    │   міні-місяць          │ Outlet                                   │                      │
│ - Playground  │   список розмов        │ (padded px-6 pt-4 pb-6                   │ вміст, який          │
│               │   порожній стан        │  або bleed p-0)                          │ приносить            │
│               │                        │                                          │ ContextPanelPortal   │
│               │                        │                                          │ зі сторінки          │
│               │                        │                                          │                      │
│ - аватар      │                        │                                          │                      │
└───────────────┴────────────────────────┴──────────────────────────────────────────┴──────────────────────┘
```

- **AppRail + AreaSidebar** разом — один `Sidebar collapsible="icon"` (перший і
  другий рівень навігації); **`ContextPanel`** — окремий сусід усередині того ж
  `SidebarProvider`, не вкладений ні в `Sidebar`, ні в `SidebarInset`.
- Заголовок `AppRail` — бренд-плитка; `AreaSidebar` — назва інсталяції + активна
  area сірим під нею; `SidebarInset` — `SidebarTrigger` (згорнути/розгорнути
  `AreaSidebar`) · `PageHeaderSlot` (контент сторінки) · дзвінок сповіщень · тема ·
  `ContextPanelTrigger` (є, лише коли панель має що показати); `ContextPanel` — сам
  заголовок вибраного обʼєкта + хрестик, що знімає вибір (не ховає панель).
- `ContextPanel` видно, лише коли є змонтований `ContextPanelPortal` **і** людина її
  не сховала — інакше четверта колонка на схемі відсутня, а `SidebarInset` займає
  все, що лишилось.
- \* **`AreaSidebar` і `ContextPanel` — resizable**: 224px/288px тут дефолт і
  мінімум, не константа. `ResizeHandle` (`libs/ui`) тягне до 40% ширини viewport,
  памʼятає вибір у `localStorage` окремо для web і platform-web. Деталі — `app-shell.md`
  §5.4, §5.6.

Поза цим деревом, тобто НЕ колонки шела, а тимчасові оверлеї поверх сторінки:
`Sheet` (`ActivityDrawer`, панель сповіщень із дзвінка) — накриває, не стискає;
беремо, коли після рішення сторінка під ним більше не потрібна (§5.6
`app-shell.md`, межа «панель vs Sheet»).

## 2. Мапа назв

| Наше ім'я                                                                           | Що це                                        | Файл (шаблон для обох фронтів)                      | Примітка                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`AppShell`**                                                                        | контейнер усього шела                         | `apps/{web,platform-web}/src/app-shell/app-shell.tsx`  | замінив колишній `AppLayout`                                                 |
| **`AppRail`**                                                                         | 1-й рівень — смуга іконок area                | `.../app-shell/app-rail.tsx`                           | не згортається — сам є згорнутим станом (Cmd+B ховає лише `AreaSidebar`)     |
| **area** / **`AppArea`**                                                              | одиниця 1-го рівня (Workspace, Calendar, …)   | `.../app-shell/areas.tsx`                              | реєстр `APP_AREAS`, `resolveArea(pathname)` — чиста функція, без стану       |
| **`AreaSidebar`**                                                                     | 2-й рівень — колонка активної area            | `.../app-shell/area-sidebar.tsx`                       | вміст — `area.Sidebar`, **компонент**, а не `items: NavItem[]`               |
| **`AreaNav`**                                                                         | спільний список-меню для area, що є меню      | `.../app-shell/area-nav.tsx`                           | Workspace/Settings/User settings; Calendar/Chat мають власний вміст колонки  |
| **`AppFooterBar`**                                                                    | нижня смуга `AppRail`                         | `.../app-shell/account-footer.tsx`                     | аватар + дропдаун (профіль/logout)                                          |
| **`PageHeaderSlot`** / **`PageHeaderPortal`**                                         | хедер контенту (`h-14`)                       | `libs/ui/src/components/page-header-slot.tsx`          | generic портал — та сама механіка, що в `ContextPanel`                       |
| **`ContextPanel`** (`ContextPanelSlot`/`Portal`/`Trigger`/`Header`)                   | 3-тя колонка праворуч від контенту            | `libs/ui/src/components/context-panel-slot.tsx`        | generic слот: сторінка кладе туди ЩО ЗАВГОДНО, типів між шелом і вмістом нема |
| **`Sheet`** (`ActivityDrawer`, панель сповіщень)                                      | НЕ колонка шела — тимчасовий модальний оверлей | `apps/web/src/components/activity/activity-drawer.tsx` | накриває сторінку, а не стискає; для самодостатніх рішень                    |
| **`ScrollArea`**                                                                      | скрол сторінки й панелей                       | `libs/ui/src/components/ui/scroll-area.tsx`             | завжди замість нативного `overflow-y-auto`                                   |

## 3. `apps/platform-web` — що інакше

Та сама структура (реалізовано 2026-09-12), файли `src/app-shell/…` **скопійовані**
з `apps/web`, не спільні (`docs/frontend/app-shell.md` §9.3). Відмінності:

| Що                    | web                                   | platform-web                                       |
| ---------------------- | -------------------------------------- | ---------------------------------------------------- |
| Area в рейлі            | Workspace · Calendar · Chat · Settings · Playground | Tenants · Operations                                 |
| Settings (org-level)    | є (ADMIN-only area)                    | **немає** — суб'єкт контрол-плейну сама платформа    |
| ContextPanel — вміст    | `EventPanel` (календар, 3 точки входу) | `JobDetailsPanel` (`/operations/jobs`) — один споживач |
| `AppFooterBar`          | `useAuthStore` → `user`, logout з API-викликом | `operator`, logout без виклику API (ендпоінта нема)  |
| Бренд у шапці рейлу      | `Layers`                               | `ShieldCheck`                                        |

## 4. Як це працює (коротко)

| Питання                                  | Відповідь                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Яка area активна?                         | Чиста функція від `location.pathname` — `resolveArea()`; дубльованого стану немає                          |
| Коли `AppRail` «згортається»?              | Ніколи сам — `Sidebar` стискається до `--sidebar-width-icon`, ховаючи `AreaSidebar` (Cmd+B / `SidebarTrigger`) |
| Коли видно `ContextPanel`?                | `hasContent` (є змонтований `ContextPanelPortal`) **І** `isOpen` (людина не сховала кнопкою)                |
| Хрестик у панелі vs кнопка в хедері?      | Хрестик знімає ВИБІР (`onClose` сторінки); кнопка лише ХОВАЄ панель, вибір лишається                        |
| Звідки брендовий фон і скляний шел?       | Теж від роуту: `staticData.backdrop: 'brand'` → `data-backdrop` на обгортці шела + `BrandBackdrop` під ним; лише `/guide` (`brand-backdrop.md`) |
| `padded` чи `bleed`?                      | Оголошує **сторінка** через `staticData.layout` на роуті; `bleed` — коли сторінка сама полотно (грід, календар) |
| Коли `ContextPanel`, коли `Sheet`?        | Якщо сторінка позаду ще потрібна людині — панель; якщо рішення самодостатнє — `Sheet`                        |
| Де ще ContextPanel запланована, але не заведена? | Рядок гріда `/users`/`/customers`, `ActivityDrawer` (кандидат №1), area `Chat` — черга в §5.6 `app-shell.md` |
