# Playground → Components: план завершення каталогу

**Статус: ПЛАН, не реалізовано.** Цей документ — самодостатній бриф для агента (людини чи
іншої моделі), який продовжить каталог `/playground/components/*` після того, як 2026-09-11
було закладено каркас: колапс «Components» у сайдбарі area «Playground», дві не-колапсовні
підгрупи (**General Components** / **Platform Components**) і два еталонні стенди —
**Buttons** і **Tabs**. Мета документа — дати досить контексту й конкретики, щоб виконавець
не повертався з уточнювальними питаннями: критерій групування, рецепт однієї сторінки,
повний інвентар компонентів із реальними посиланнями на код (не вигаданими), і порядок фаз.

Якщо ви агент, який виконує цей план: читайте розділи 1–4 повністю перед тим, як торкатись
коду. Розділи 5–7 — інвентар, з якого фаза за фазою беруться пункти (розділ 8). Розділ 9 —
свідомо поза скоупом. Розділ 10 — рішення, які лишені на ваш розсуд, із поясненням чому.

## 1. Що вже зроблено (читайте як референс)

Живі файли — джерело істини для патерну, точніше за будь-який опис нижче:

- `apps/web/src/pages/playground-tabs.tsx` — **еталонна сторінка**, писана саме як шаблон для
  решти каталогу (варіанти/розміри через пропси, секція «Real usage» з посиланням на реальні
  місця застосування, API-таблиця, origin-бейдж).
- `apps/web/src/pages/playground.tsx` — сторінка Buttons (перенесена в
  `/playground/components/buttons`, була раніше індексом усього Playground).
- `apps/web/src/pages/playground-user-select.tsx` — сторінка User select
  (`/playground/components/user-select`), Platform Component.
- `apps/web/src/components/playground/showcase.tsx` — спільні `ShowcaseCard`, `ExampleTile`,
  `ValueReadout`. Використовуйте їх, не пишіть свій каркас картки.
- `apps/web/src/app-shell/areas/playground-sidebar.tsx` — навігація: `Collapsible` (Base UI,
  **не Radix** — дивіться коментарі в файлі й нижче) + дві `SidebarMenuSub` із підписами
  `ComponentsSubgroupLabel` між ними.
- `apps/web/src/router.tsx` — роути `playgroundRoute` і нижче: `playgroundIndexRoute`
  (редірект на `/playground/components/buttons`), `playgroundComponentsRoute` (контейнер
  шляху `components`, без власної сторінки), і три листові роути під ним.
- `apps/web/src/app-shell/paths.ts` — `NavPath` містить усі адресовані шляхи літералами.
- `apps/web/src/locales/en/playground.json` — `nav.*`, `origin.*` (native/changed/custom) і
  контент-блоки `button.*`, `tabs.*`, `userSelect.*`.

## 2. Критерій групування — General vs Platform

Це НЕ довільний вибір на сторінку — ось перевірка, яка дала однозначну відповідь для всіх
трьох уже зроблених стендів:

- **General Components**: файл самого компонента лежить у `libs/ui/src/components/**`
  (включно з `components/ui/*` — вендорені shadcn-примітиви) **або** є непорушеним
  Base UI/shadcn примітивом. Компонент не знає про tenant, не робить власних HTTP-викликів,
  придатний і для `apps/web`, і для `apps/platform-web` — навіть якщо сьогодні
  `platform-web` його ще не споживає (важлива ПРИДАТНІСТЬ, а не факт поточного вжитку;
  `Tabs` це доводить — досі не використаний у `platform-web`, але це General).
- **Platform Components**: файл компонента лежить у `apps/web/src/components/**` (НЕ в
  `libs/ui`), і сам компонент зашитий у конкретну бізнес-сутність або ендпоінт тенант-плану
  (users/customers/calendar/notifications/activities/files). Живе лише в tenant-порталі.
  Приклад — `UserMultiSelect`: значення тягне з `GET /users` тенанта, у платформі такого
  ендпоінта немає взагалі.
- **Origin-бейдж** (уже є в `origin.*` локалі): `native` — вендорено з реєстру БЕЗ правок;
  `changed` — є коментар `ЛОКАЛЬНА ПРАВКА реєстру` у файлі компонента (перевіряйте
  `grep -l "ЛОКАЛЬНА ПРАВКА" libs/ui/src/components/ui/<name>.tsx`, не вгадуйте); `custom` —
  не з реєстру shadcn взагалі (уся Platform-група і кілька General композитів на кшталт
  `DataGrid`).

## 3. Рецепт однієї сторінки — 6 торкань, завжди в цьому порядку

Точно відтворює те, що зроблено для Tabs. Не пропускайте кроки навіть для «дрібного»
компонента — саме ці шість місць тримають маршрутизацію й навігацію в консистентному стані.

1. **`apps/web/src/app-shell/paths.ts`** — додати рядок у `NavPath`
   (`'/playground/components/<slug>'`), у тому самому алфавітному/логічному місці, де вже
   стоять `buttons`/`tabs`/`user-select`.
2. **`apps/web/src/router.tsx`** — імпорт нового компонента сторінки вгорі файлу (група
   `Playground*` імпортів) + `createRoute({ getParentRoute: () => playgroundComponentsRoute,
path: '<slug>', component: <PageComponent> })` + додати змінну в масив
   `playgroundComponentsRoute.addChildren([...])`.
3. **`apps/web/src/app-shell/areas/playground-sidebar.tsx`** — `SidebarMenuSubItem` із
   `SidebarMenuSubButton render={<Link to="/playground/components/<slug>" />}` у потрібній
   підгрупі (`General`/`Platform`), `isActive={pathname === '/playground/components/<slug>'}`.
4. **Новий файл `apps/web/src/pages/playground-<slug>.tsx`** — див. розділ 4 нижче за
   структуру вмісту. Заголовок сторінки завжди `t('title')` (загальний «Component
   playground», НЕ назва компонента — так усі стенди залишаються однією «книгою»), origin- і
   eyebrow-бейджі поруч, `PageBreadcrumbs` триrівневі:
   `[{label: t('title'), to: '/playground'}, {label: t('nav.components')}, {label: t('nav.<slug>')}]`.
5. **`apps/web/src/locales/en/playground.json`** — рядок `nav.<slug>` + повний контент-блок
   `<slug>.*` (title/description/importLabel/sections/…, дивіться `tabs.*` як зразок обсягу).
6. **Перевірка**: `pnpm --filter @saas-skeleton/web run typecheck`, `pnpm exec eslint
<змінені файли> --max-warnings 0`, `pnpm exec prettier --check <змінені файли>`, і **живий
   прогін у браузері** (клік у сайдбарі, перевірка активного стану, breadcrumbs, і власне
   інтерактивності стенда — не лише скриншот).

## 4. Що покласти на сторінку одного компонента

Не всі секції потрібні всім компонентам — беріть лише ті, що відповідають реальному API:

- **Import** (`ShowcaseCard`-less блок `rounded-xl bg-muted/50 p-4` з рядком `import { … }
from '@saas-skeleton/ui/components/ui/<file>'`) — завжди перша секція.
- **Variants** — якщо в компонента є `variant` (cva). Показати КОЖЕН варіант окремим
  `ExampleTile` з описом, коли його застосовувати (не просто «варіант default»).
- **Sizes** — якщо є `size`.
- **States** — disabled/loading/error/empty/invalid, залежно від того, що компонент реально
  підтримує (перевіряйте пропси в самому файлі компонента, не вигадуйте неіснуючі).
- **Real usage** — ОБОВ'ЯЗКОВА секція, і це найважливіше правило документа: **посилання мусять
  бути на реальний код**, знайдений грепом, а не вигадані приклади. Розділи 5–7 нижче вже
  містять перевірені файли-споживачі для кожного компонента — використовуйте їх. Якщо
  компонент має ≥2 помітно різні патерни використання (як Tabs: content-таби на картці
  клієнта vs. view-switcher у хедері календаря) — покажіть обидва поруч, як у Tabs.
- **Interactivity** — якщо компонент має клавіатурну/вказівникову поведінку, варту перевірки
  руками (focus trap у Dialog, typeahead у Combobox, keyboard nav у DropdownMenu/ContextMenu,
  drag у чомусь), явно зазначте в описі стенда, що саме перевірити (Tab/Escape/стрілки), і
  переконайтесь живим прогоном, а не лише читанням коду.
- **API reference** — таблиця тільки з project-facing пропсами (тими, що додає наш cva-шар:
  variant/size/radius тощо), НЕ переписуйте весь API Base UI. Заголовки колонок беріть з уже
  наявних generic-ключів `button.api.{prop,type,default,description}` — не дублюйте їх у
  кожному новому блоці локалі.
- **Origin-бейдж** — завжди в шапці, поруч з eyebrow-бейджем `Design system`.

**Бандлінг дрібних primitives.** Кілька компонентів занадто малі для окремої повноцінної
сторінки (одна секція, один приклад) — краще об'єднати їх в одну сторінку з кількома
`ShowcaseCard`, ніж плодити майже порожні пункти меню. Конкретні рекомендації — у розділі 5
(позначка «бандл»). Це рекомендація, не догма: якщо в процесі роботи компонент виявиться
багатшим, ніж здається зараз (наприклад, у нього зʼявиться помітний usage-патерн) — робіть
окрему сторінку.

## 5. Інвентар — General Components: примітиви `libs/ui/src/components/ui/*`

Origin визначено перевіркою `grep -rl "ЛОКАЛЬНА ПРАВКА" libs/ui/src/components/ui` на
2026-09-11 — перевірте повторно, якщо із того часу минуло багато часу. «К-во споживачів» —
кількість файлів поза самим `libs/ui/components/ui`, що імпортують компонент (обидва фронти
разом), пораховано грепом по `components/ui/<name>'`.

### Рівень 1 — окрема повноцінна сторінка (явно використовуються, є за що показати)

| Компонент       | Origin  | Slug            | К-во споживачів | Реальне використання (грунтовка для «Real usage»)                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------- | --------------- | :-------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Button~~      | changed | `buttons`       |       49        | **Зроблено.**                                                                                                                                                                                                                                                                                                                                                                      |
| ~~Tabs~~        | changed | `tabs`          |        6        | **Зроблено.**                                                                                                                                                                                                                                                                                                                                                                      |
| Input           | changed | `input`         |        9        | `playground-inline-form.tsx`, `user-settings/account.tsx` (email/name поля), `settings/calendar.tsx`. Разом з `InputGroup` (адорновані поля) — дивіться нижче, чи варто одна сторінка на двох.                                                                                                                                                                                     |
| Textarea        | changed | `textarea`      |        2        | Реально лише через `FormTextareaField` (`libs/ui/components/form/form-textarea-field.tsx`) — прямих споживачів у продукті нема. Показати і сирий `<Textarea>`, і обгортку.                                                                                                                                                                                                         |
| Select          | changed | `select`        |        6        | `playground-inline-form.tsx`, `settings/calendar.tsx` (перший день тижня), `calendar/reminder-rows.tsx` (одиниця нагадування).                                                                                                                                                                                                                                                     |
| Combobox        | changed | `combobox`      |        6        | Фундамент `UserSelect`/`UserMultiSelect`/`customer-select.tsx`/`country-select.tsx` (телефон). **Важливо**: це базовий примітив пошуку-з-попапом — покажіть його ГОЛИМ (без бізнес-фетчингу), а бізнес-обгортки лишіть Platform-сторінкам. Дивіться `docs/frontend/multi-user-select.md` — там уже є розбір спільного фундаменту.                                                  |
| Checkbox        | changed | `checkbox`      |        1        | Лише в `libs/ui/components/data-grid/data-grid.tsx` (вибір рядків). Малий, але видимий у кожному гріді — вартий сторінки (variant checked/unchecked/indeterminate/disabled).                                                                                                                                                                                                       |
| Field           | native  | `field`         |       28        | Це каркас КОЖНОЇ форми в продукті. Vertical/Inline form стенди вже демонструють його «в дії» — окрема сторінка потрібна для ІЗОЛЬОВАНОГО показу `orientation="vertical"/"horizontal"`, `FieldDescription`, `FieldError`, `data-invalid` — тобто API, а не повний флоу форми.                                                                                                       |
| Badge           | changed | `badge`         |       18        | `users.tsx`/`customers.tsx` (статуси), `notification-bell.tsx` (лічильник), `user-row-note.tsx`. Варіанти вже описані в `badge.tsx` (default/secondary/destructive/success/warning/outline/ghost/link).                                                                                                                                                                            |
| Avatar          | native  | `avatar`        |        4        | `presence-dot.tsx`, `customer-identity.tsx`, `calendar/agenda-list.tsx`, `libs/ui/components/user-identity.tsx`. Покажіть розміри (`size=sm` з `avatar.tsx`), fallback-ініціали, і композицію з `AvatarBadge` (presence-крапка) — але сам presence-виклик лишіть Platform-сторінці «Presence».                                                                                     |
| Card            | changed | `card`          |       15        | Базовий контейнер практично кожного стенда й картки сутності (`dashboard.tsx`, `customer-detail.tsx`). Покажіть `size="sm"` варіант (є в `card.tsx`, `group-data-[size=sm]/card`).                                                                                                                                                                                                 |
| Table           | changed | `table`         |        5        | Сирий `<Table>` (не `DataGrid`) — `playground.tsx`/`playground-tabs.tsx` API-таблиці й `tenants.tsx` у platform-web (плоска таблиця без гріда, свідоме рішення — див. CLAUDE.md). Покажіть мінімальний приклад БЕЗ DataGrid, з поясненням коли брати сирий Table (`tenants.tsx`), а коли DataGrid.                                                                                 |
| Dialog          | changed | `dialog`        |        9        | `create-user-modal.tsx`, `edit-customer-modal.tsx`, `change-password-modal.tsx` — типова форма-в-модалці. **Interactivity**: focus trap, Escape закриває, фокус повертається на тригер.                                                                                                                                                                                            |
| AlertDialog     | changed | `alert-dialog`  |        8        | `user-detail.tsx`/`customer-detail.tsx` (підтвердження suspend/delete), `tenants.tsx` у platform-web. Покажіть саме паттерн підтвердження деструктивної дії з `variant="destructive"` кнопкою.                                                                                                                                                                                     |
| Sheet           | changed | `sheet`         |        3        | `activity-drawer.tsx`, `notification-panel.tsx`. **Важливо**: поясніть у описі, коли брати Sheet, а коли контекстну панель шела (`ContextPanelPortal`, `app-shell.md` §5.6) — це вже задокументоване правило, процитуйте його.                                                                                                                                                     |
| Popover         | native  | `popover`       |        2        | `user-row-note.tsx`, і всередині `date-picker.tsx`. Покажіть голий Popover (Trigger+Content), не заглиблюючись у DatePicker.                                                                                                                                                                                                                                                       |
| HoverCard       | native  | `hover-card`    |        1        | `calendar/event-chip.tsx` (peek по наведенню, `docs/calendar.md` CAL-2 §е). **Interactivity**: затримка на вхід/вихід, закриття на pointerdown/клік — процитуйте граблю з CLAUDE.md про фонову вкладку й drag-автоматизацію.                                                                                                                                                       |
| Tooltip         | native  | `tooltip`       |        5        | `last-seen.tsx`, `presence-dot.tsx`, `copy-to-clipboard.tsx`, і в самому `sidebar.tsx` (підказки рейлу в згорнутому стані — процитуйте граблю `hidden: isMobile` з `app-shell.md`).                                                                                                                                                                                                |
| DropdownMenu    | changed | `dropdown-menu` |        7        | `notification-card.tsx` (дії ⋯), `account-footer.tsx` (профіль), `customer-detail.tsx`. **Interactivity**: keyboard nav стрілками, typeahead.                                                                                                                                                                                                                                      |
| ContextMenu     | changed | `context-menu`  |        1        | `calendar/event-context-menu.tsx` — цитуйте граблю з CLAUDE.md: «правий клік автоматизації не доставляє нативний `contextmenu`, перевіряти через `dispatchEvent`». `ContextMenuLabel` без `ContextMenuGroup` падає в рантаймі — теж процитуйте.                                                                                                                                    |
| Empty           | native  | `empty`         |       13        | `chat.tsx` (порожній чат), `notification-panel.tsx`, `data-grid.tsx` (порожній результат фільтра), `not-found-page.tsx`. Покажіть 2-3 реальні тексти порожніх станів, не вигадані.                                                                                                                                                                                                 |
| Item            | changed | `item`          |        6        | Фундамент `UserIdentity`/`CustomerIdentity`/рядків нотифікацій/agenda-рядків. Покажіть голий `Item`+`ItemMedia`+`ItemContent`+`ItemActions`, і згадайте, що `UserIdentity` (General, `libs/ui`) і `CustomerIdentity` (Platform) — це вже готові композиції поверх нього (з посиланням на відповідні сторінки каталогу).                                                            |
| Pagination      | changed | `pagination`    |        1        | Лише всередині `DataGrid`. Покажіть як самостійний контрол (сторінка N з M) окремо від гріда.                                                                                                                                                                                                                                                                                      |
| ScrollArea      | changed | `scroll-area`   |        8        | `app-shell.tsx` (скрол сторінки), `calendar/time-grid.tsx`, `activity-drawer.tsx`. Процитуйте ключове правило з CLAUDE.md: `ScrollAreaPrimitive.Content` обов'язкова обгортка, висота — тільки через flex (`min-h-0 flex-1`), ніколи `h-full`/`absolute inset-0`. Покажіть `size="default"` і `size="lg"`.                                                                         |
| Toast           | changed | `toast`         |       13        | `toast-host.tsx`, `use-event-intents.tsx` (undo-тост). Стенд — кнопки «Show success/error/undo toast», а не статичний рендер (тости живуть у портал-черзі). Згадайте два регіони тостів (`ui-stack.md`).                                                                                                                                                                           |
| Calendar (грід) | changed | `date-grid`     |        2        | Це примітив ДАТИ (`libs/ui/components/ui/calendar.tsx`, `react-day-picker`), НЕ фіча `/calendar` застосунку — оберіть slug `date-grid`, щоб не плутати з area. Живе всередині `date-picker.tsx` (розділ 6). Якщо робите окрему сторінку — покажіть тільки грід (без поля вводу), і різницю зі стилізацією міні-місяця (`app-shell.md` §… «Міні-місяць звірено з Notion Calendar»). |
| Collapsible     | native  | `collapsible`   |        1        | **Перший реальний споживач — сам `playground-sidebar.tsx`**, щойно зроблений. Покажіть код прикладу зі скороченою версією того самого патерну (Trigger+Panel, `data-open`/`data-panel-open`), можна навіть буквально показати міні-версію нав-групи.                                                                                                                               |
| Alert           | changed | `alert`         |        2        | `calendar/event-panel.tsx`, `pages/calendar.tsx`. Банер-повідомлення, не плутати з `AlertDialog` — поясніть різницю прямо в описі сторінки.                                                                                                                                                                                                                                        |
| Kbd             | native  | `kbd`           |        1        | `calendar/shortcuts-dialog.tsx` — довідка гарячих клавіш календаря (`use-calendar-hotkeys.ts`). Гарний маленький, але самодостатній стенд.                                                                                                                                                                                                                                         |

### Рівень 2 — бандл-кандидати (рекомендовано об'єднати, не плодити порожні сторінки)

| Бандл                              | Компоненти                               | Slug      | Чому разом                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading & progress**             | Skeleton (7), Spinner (17), Progress (2) | `loading` | Кожен — один прямокутник/спінер/смужка, без варіантів по суті. Spinner найпомітніший (17 споживачів: кнопки в стані `disabled` + `Spinner`, `data-grid.tsx`) — дайте йому основну увагу на сторінці, Skeleton і Progress — по одному `ExampleTile`.                                                |
| **InputGroup (адорнований Input)** | Input (9) + InputGroup (4)               | `input`   | `InputGroup` — це `Input` з адорнами (іконка/кнопка з боків), а не окремий незалежний компонент; природно на одній сторінці: голий Input → Input з адорнами. Споживачі InputGroup: `form-phone-field.tsx`, `date-picker.tsx`, `combobox.tsx`, `form-password-field.tsx` (toggle видимості пароля). |

### Явно поза Рівнем 1/2 (див. розділ 9)

`Breadcrumb` (0 прямих споживачів — обгорнутий у `PageBreadcrumbs`), `ToggleGroup` (0
споживачів), `Toggle` (1 споживач — внутрішній для `ToggleGroup`), `Label` (1 споживач —
внутрішній для `Field`), `Sidebar` (це сама навігаційна оболонка, self-hosting).

## 6. Інвентар — General Components: складені (поза `components/ui/`)

| Компонент                                                                                                | Файл                                                            | Origin                                          | Slug             | Нотатка                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DataGrid**                                                                                             | `libs/ui/src/components/data-grid/*`                            | custom                                          | `data-grid`      | Найбільший і найважливіший пункт усього плану — публічний API `createDataGrid<TFilters,TItem>()`, споживачі: `users.tsx`, `customers.tsx`, `jobs.tsx` (обидва фронти). Потребує кількох `ShowcaseCard` на ОДНІЙ сторінці (не розбивати на під-сторінки): базова таблиця+пагінація, фільтри (`Grid.filter` фабрики `search()`/`select()`), вибір рядків (`selection`, `SelectionSummary`), кастомний бізнес-фільтр (`{id, render}` — приклад `userStatusFilter`). Стенду потрібні фейкові дані (без реального `useListQuery` до бекенда) або локальний `useState`-масив — не тягніть реальний API у Playground. Прочитайте профільний блок CLAUDE.md «DataGrid» ПОВНІСТЮ перед стартом — там усі контракти. |
| **DatePicker**                                                                                           | `libs/ui/src/components/date-picker.tsx`                        | custom (композиція Popover+Calendar+InputGroup) | `date-picker`    | **Міграція, не нова робота**: увесь контент уже написаний і живе в `playground-vertical-form.tsx` під ключами `datePicker.*` у локалі (title/description/tiles/accepts-таблиця клавіатурного вводу). Перенесіть цей блок у власну `playground-date-picker.tsx` за рецептом розділу 3, приберіть з `playground-vertical-form.tsx` (там лишиться тільки форма, що USE-є DatePicker, як реальний usage-приклад).                                                                                                                                                                                                                                                                                              |
| **UserIdentity**                                                                                         | `libs/ui/src/components/user-identity.tsx`                      | custom                                          | `identity`       | Генерична сутність-чіп (avatar+ім'я+email), попри назву — General (лежить у `libs/ui`, і сайдбар-футер `platform-web` теж його використовує). Покажіть із presence-бейджем і без.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **ThemeSwitcher / ThemeSelect**                                                                          | `libs/ui/src/components/theme-switcher.tsx`, `theme-select.tsx` | custom                                          | `theme-switcher` | Маленький, видимий у хедері обох застосунків. Разом з `CopyToClipboard` — кандидат у бандл «Utilities» (розділ 5, той самий принцип), якщо здасться замало контенту на окрему сторінку.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **CopyToClipboard**                                                                                      | `libs/ui/src/components/copy-to-clipboard.tsx`                  | custom                                          | —                | Дивіться нотатку вище — імовірний бандл із ThemeSwitcher або з Tooltip-сторінкою (він сам споживач Tooltip).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Form-обгортки (`FormTextField`, `FormSelect`, `FormDateField`, `FormPasswordField`, `FormTextareaField`) | `libs/ui/src/components/form/*`                                 | custom                                          | —                | **Не робити нових сторінок**: уже повністю продемонстровані в живій дії на `playground-vertical-form.tsx`/`playground-inline-form.tsx` (RHF+Zod). Ізольований показ без форми не додасть цінності.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `page-header-slot`, `page-breadcrumbs`, `context-panel-slot`, `not-found-page`                           | `libs/ui/src/components/*`                                      | custom                                          | —                | Layout-плумбінг, не «компонент для перегляду варіантів» — поза скоупом, як і `Sidebar`. Див. розділ 9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 7. Інвентар — Platform Components

Усі — `apps/web/src/components/**`, з бекенд-залежністю, лише tenant-портал.

| Стенд                    | Компоненти                                                                                                                           | Slug                | Origin | Нотатка                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~User select~~          | `user-multi-select/*`                                                                                                                | `user-select`       | custom | **Частково зроблено** — Inline/Stacked multi-select уже є. **Розширити** (не нова сторінка): додати третій `Stand` для одиночного `UserSelect` (`apps/web/src/components/user-select.tsx`) — той самий `Combobox`-фундамент, лише `value: string \| null`. Оновіть `userSelect.description` в локалі, щоб згадати всі три форми.                                                                                                                                                                                         |
| **Presence & last seen** | `presence-dot.tsx` (`PresenceDot`/`UserPresenceBadge`), `last-seen.tsx`                                                              | `presence`          | custom | Обидва — тонкі споживачі `usePresence()`/realtime; документовані разом і в `docs/realtime.md`/`docs/realtime-internals.md` (розділ «Last seen»). Стенд: crapка на аватарі (online/offline/unknown — БЕЗ крапки для offline, це свідоме правило з CLAUDE.md), рядок `LastSeen` з форматами (`Online` / `Last seen 5 minutes ago` з тултипом абсолютної дати / `Never signed in`). Живих даних presence у Playground не буде (немає сокета в стенді) — зробіть контрольовані пропси/фейкові значення, поясніть це в описі. |
| **Phone number**         | `phone-number.tsx`, `form/form-phone-field.tsx` (+ `form/phone/country-select.tsx`)                                                  | `phone-number`      | custom | `libphonenumber-js` + `country-flag-icons` (єдине місце в продукті, де це є — див. `ui-stack.md`: «Власного components/ui немає; локальним лишилось телефонне поле»). Стенд: голе відображення (`PhoneNumber`) + форма-поле з вибором країни.                                                                                                                                                                                                                                                                            |
| **Notification Center**  | `notifications/notification-bell.tsx`, `-card.tsx`, `-item.tsx`, `-message.tsx`, `-panel.tsx`, `-toast-item.tsx`, `-preferences.tsx` | `notifications`     | custom | Ціла фіча-родина (`docs/notifications.md`) — ОДНА сторінка, кілька `ShowcaseCard`: дзвінок+бейдж, `NotificationCard` у трьох станах (непрочитане/прочитане/згорнута група), `NotificationPanel` із табами (дивіться `tabs.tsx` `size="sm"` — той самий стенд можна прямо процитувати як «ще один реальний usage Tabs»), тост-варіант, форма преференцій. Дані — фейковий масив у стенді, не реальний сокет.                                                                                                              |
| **Activity feed**        | `activity/activity-feed.tsx`, `-panel.tsx`, `-drawer.tsx`, `-message.tsx`                                                            | `activity`          | custom | Родина Activity Log (`docs/activity-log.md`). Стенд: `ActivityPanel` (варіант «в колонці картки сутності»), `ActivityDrawer` (варіант `Sheet`), рендер кількох типів подій через `ActivityMessage`/`<Trans>` на фейкових даних.                                                                                                                                                                                                                                                                                          |
| **File upload**          | `file-upload/file-dropzone.tsx`, `change-avatar-modal.tsx`                                                                           | `file-upload`       | custom | Presigned upload-флоу (`docs/file-storage.md`). Стенд: порожній/dragover/uploading-стани дропзони (без реального `POST /files` — замокайте `useFileUpload` або покажіть чисто візуальні стани), модалка зміни аватара.                                                                                                                                                                                                                                                                                                   |
| **Customer identity**    | `customer-identity.tsx`                                                                                                              | `customer-identity` | custom | Домен-звʼязана версія `Item`-композиції (аналог `UserIdentity`, але для кастомера — organization/person `kind`). Малий стенд, можна об'єднати з поясненням різниці від `UserIdentity` (посилання на General-сторінку `identity`).                                                                                                                                                                                                                                                                                        |

## 8. Пропоноване фазування

Порядок обраний за співвідношенням «цінність показу / складність», а не алфавітом:

1. **Фаза A — форми** (найбільша повторюваність у продукті): Input+InputGroup (бандл),
   Textarea, Select, Combobox, Checkbox, Field, Loading-бандл (Skeleton/Spinner/Progress).
2. **Фаза B — оверлеї й взаємодія**: Dialog, AlertDialog, Sheet, Popover, HoverCard, Tooltip,
   DropdownMenu, ContextMenu, Collapsible.
3. **Фаза C — відображення даних**: Badge, Avatar, Card, Table, Item, Empty, Pagination,
   ScrollArea, Toast, Alert, Kbd, Calendar-грід (`date-grid`).
4. **Фаза D — складені General**: DataGrid (найбільша окрема робота фази), DatePicker
   (міграція наявного контенту), UserIdentity, ThemeSwitcher/CopyToClipboard-бандл.
5. **Фаза E — Platform Components**: розширення User select (одиночний вибір), Presence &
   last seen, Phone number, Customer identity — малі й швидкі.
6. **Фаза F — Platform Components, важкі родини**: Notification Center, Activity feed, File
   upload — кожна це ціла фіча, найбільше тексту й станів.

Кожна фаза — самодостатній PR: після неї продукт компілюється, лінтиться і працює, нічого не
лишається «наполовину».

## 9. Свідомо поза скоупом

- **`Sidebar` (`libs/ui/components/ui/sidebar.tsx`)** — сама навігаційна оболонка. Показ
  «сайдбара всередині сайдбара» — self-hosting парадокс, немає сенсу.
- **`ToggleGroup`** — 0 споживачів у всьому продукті (перевірено грепом). НЕ вигадуйте
  приклад заради каталогу — додайте сторінку тільки коли зʼявиться реальний перший споживач
  (тоді і `Toggle` разом з ним, зараз лише внутрішній для `ToggleGroup`).
- **`Breadcrumb`** — 0 прямих споживачів (усе йде через `PageBreadcrumbs`, який сам на кожній
  сторінці каталогу вже демонструється живим прикладом).
- **`Label`** — 1 внутрішній споживач (`Field`), самостійної цінності немає.
- **`page-header-slot`, `page-breadcrumbs`, `context-panel-slot`, `not-found-page`** —
  layout-плумбінг застосунку, не «компонент з варіантами», аналогічно до `Sidebar`.
- **Form-обгортки `libs/ui/components/form/*`** — уже демонструються в дії на Vertical/Inline
  form стендах; окрема ізольована сторінка нічого не додасть.
- **`apps/platform-web`** — увесь план про `apps/web`. У `platform-web` немає area
  Playground і не планується в межах цього документа.

## 10. Відкриті питання — на розсуд виконавця

- **Де межа для DataGrid-стенда**: чи варто йому взагалі жити під «одна сторінка = один
  компонент», чи він настільки великий, що заслуговує власного під-меню (як «Components»
  зараз під «Playground»)? За замовчуванням — одна сторінка з кількома `ShowcaseCard` (як
  Buttons), але якщо в процесі стане очевидно, що там 300+ рядків JSX і 6 незалежних
  концепцій — розбийте на кілька `ShowcaseCard` секцій з якорями (`#data-grid-filters` тощо,
  за зразком `on this page` навігації в `playground.tsx`), не на окремі роути.
- **`CopyToClipboard`/`ThemeSwitcher`**: бандл чи окремі сторінки — вирішіть за фактичним
  обсягом контенту, коли дійдете до Фази D.
- **`date-grid` vs `date-picker`**: чи потрібен окремий стенд для голого календарного гріда,
  якщо `DatePicker` (Фаза D) його й так показує всередині попапа? Рекомендація документа —
  зробити, бо `Calendar` сам по собі технічно `libs/ui/components/ui/calendar.tsx`, а
  `DatePicker` — `libs/ui/components/date-picker.tsx`, різні файли з різним origin
  (native vs custom-композиція) і різним API. Але якщо після DatePicker сторінка виглядає
  вичерпною — не плодьте дублікат, позначте `Calendar` як «покрито через DatePicker» і
  приберіть з таблиці розділу 5.
- **`on this page` бічна навігація** (як на `playground.tsx`/Buttons) — Tabs її свідомо не
  отримав (сторінка коротша). Немає жорсткого правила «коли додавати» — орієнтир: якщо на
  сторінці ≥5 `ShowcaseCard`, додайте `on this page`; менше — не варто.
- **Локалізація**: увесь контент — тільки `en` (проєкт поки одномовний, `docs/i18n-plan.md`).
  Не заводьте інших мов у `playground.json`.
