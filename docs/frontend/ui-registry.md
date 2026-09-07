# Реєстр UI-джерел: звідки що беремо

Довідник на один випадок: «треба компонент/блок — де його взяти, щоб не зламати стек».
Оновлено 2026-08-27 за фактичною перевіркою реєстрів (усі посилання і коди відповідей —
живі на дату запису).

Наш стек: **shadcn/ui на Base UI, стиль `base-nova`, Tailwind 4**, вендорений код у
`libs/ui/src/components/ui/`, тема — `libs/ui/src/styles.css`. Правила стека — `ui-stack.md`
(стисло — `CLAUDE.md`, правило 12).

---

## 1. Порядок вибору джерела

1. **`@shadcn` (base-nova)** — дефолт. Ставимо без питань: це рідний стиль нашого
   `components.json`, ті самі токени, ті самі конвенції (`data-slot`, `cva`, `render`).
2. **`@coss` (Cal.com)** — коли примітива немає в `@shadcn`. Той самий Base UI під капотом,
   але **інша родина обгорток** — брати точково і за чеклістом §5.
3. **Kibo UI — лише погоджені доменні компоненти.** Уже погоджено `Tree` для майбутнього
   файлового або іншого ієрархічного меню; не встановлюємо, доки немає споживача (§3.3).
4. **`@reui`** — джерело ідей і безкоштовних прикладів; блоки платні (401 без ліцензії).
5. **Галереї-референси** (Tailwind Plus, Origin UI, 21st.dev, Tremor) — дивимось,
   переносимо руками, як залежність не підключаємо.

Конфіг реєстрів живе в `libs/ui/components.json` і в обох `apps/*/components.json`:

```jsonc
"registries": {
  "@reui": "https://reui.io/r/{style}/{name}.json"
}
```

`@coss` не реєструємо превентивно: додаємо namespace лише разом із першим реально прийнятим
компонентом. Kibo UI теж не підключаємо наперед: рішення про `Tree` зафіксоване, але код і
залежності додаємо лише разом із першим use case. Примітиви ставимо з `libs/ui`, сторінкові
блоки — з теки конкретного застосунку.

---

## 2. Що вже вендеровано у нас (37 примітивів)

`libs/ui/src/components/ui/`: alert · alert-dialog · avatar · badge · breadcrumb · button ·
calendar · card · checkbox · collapsible · combobox · dialog · dropdown-menu · empty · field ·
input · input-group · item · label · pagination · popover · progress · scroll-area · select ·
separator · sheet · sidebar · skeleton · spinner · switch · table · tabs · textarea · toast ·
toggle · toggle-group · tooltip

**alert · calendar · collapsible · popover** додані 2026-09-07 разом із календарем
(`docs/calendar.md` §11.3). Дві грабельки того `add`: (1) CLI вставив у три файли
`import { cn } from "cn"` — справжній npm-пакет `cn`, який не має стосунку до нашого
утиліта; замінено на `@saas-skeleton/ui/lib/utils`, пакет прибраний із залежностей;
(2) `calendar` тягне `react-day-picker` + `date-fns` — **перша дата-бібліотека в репозиторії**,
і використовується вона рівно як date-picker: сітки тижня й місяця свої.

Хуки: `hooks/use-mobile.ts`. Власні (не з реєстру): `theme-switcher.tsx`, `user-identity.tsx`,
`page-header-slot.tsx`, `page-breadcrumbs.tsx`, `not-found-page.tsx`, `components/data-grid/**`,
`components/form/**`.

`not-found-page.tsx` — сторінка неіснуючого роуту обох фронтів. Окремого 404-блока в `@shadcn`
немає (перевірено пошуком по реєстру), тож узятий блок shadcn-admin
(`features/errors/not-found-error.tsx`, MIT — той самий шаблон, звідки розкладка `/settings`),
але зібраний на реєстровому `Empty`: 404 — це порожній стан, а кустарних обгорток над
примітивами ми не заводимо. Підключається splat-роутом `$` ПІД app-роутом застосунку —
так сторінка малюється всередині layout-а і проходить той самий auth-гейт (гість замість 404
їде на `/login`).

**Локальні правки реєстру** (позначені коментарем «ЛОКАЛЬНА ПРАВКА реєстру») — `toast`
(позиції), `checkbox` (indeterminate), `button` (суцільний destructive, метрика, фокус),
`input`/`select`/`input-group` (однорядкова висота 36px і `px-3`), `textarea` (`px-3`, але
стокова `min-h-16`). Повний реєстр дельт — `ui-stack.md` §6.
Плюс наскрізна заміна фокус-кільця на `ring-2` у 14 файлах.

---

## 3. Примітиви: де що є

### 3.1 `@shadcn` — доступні, але ще не встановлені

[Документація](https://ui.shadcn.com/docs/components) · ставити з `libs/ui`:
`pnpm dlx shadcn@4.19.0 add <name>`
(з теки `libs/ui`).

| Компонент                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Ймовірний споживач у нас                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [accordion](https://ui.shadcn.com/docs/components/accordion) (`collapsible` — уже в §2)                                                                                                                                                                                                                                                                                                                                                                                                                              | згортні групи в сайдбарі, коли доменних модулів стане більше |
| [command](https://ui.shadcn.com/docs/components/command)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ⌘K-пошук по тенантах/юзерах                                  |
| [hover-card](https://ui.shadcn.com/docs/components/hover-card) (`popover` — уже в §2)                                                                                                                                                                                                                                                                                                                                                                                                                                | картка юзера при наведенні в гріді, peek події (CAL-2)       |
| [chart](https://ui.shadcn.com/docs/components/chart)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | дашборд, статистика черг                                     |
| [radio-group](https://ui.shadcn.com/docs/components/radio-group) · [slider](https://ui.shadcn.com/docs/components/slider) · [form](https://ui.shadcn.com/docs/forms)                                                                                                                                                                                                                                                                                                                                                 | форми налаштувань; `radio-group` — «це / це і наступні» (CAL-4) |
| [drawer](https://ui.shadcn.com/docs/components/drawer)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | мобільний варіант панелей (у нас зараз `sheet`)              |
| [context-menu](https://ui.shadcn.com/docs/components/context-menu) · [menubar](https://ui.shadcn.com/docs/components/menubar) · [navigation-menu](https://ui.shadcn.com/docs/components/navigation-menu)                                                                                                                                                                                                                                                                                                             | `context-menu` — правий клік на події (CAL-2); решта без споживача |
| [button-group](https://ui.shadcn.com/docs/components/button-group) · [kbd](https://ui.shadcn.com/docs/components/kbd) · [input-otp](https://ui.shadcn.com/docs/components/input-otp) · [carousel](https://ui.shadcn.com/docs/components/carousel) · [resizable](https://ui.shadcn.com/docs/components/resizable) · [aspect-ratio](https://ui.shadcn.com/docs/components/aspect-ratio) · [sonner](https://ui.shadcn.com/docs/components/toast) · [native-select](https://ui.shadcn.com/docs/components/native-select) | за потреби                                                   |

### 3.2 `@coss` — те, чого в `@shadcn` НЕМАЄ

[Документація](https://coss.com/ui/docs) · реєстр `https://coss.com/ui/r/{name}.json`
(вільний). Дизайн-система Cal.com на тому самому Base UI.

| Компонент                                                                                                                                                                                  | Навіщо нам                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [number-field](https://coss.com/ui/docs/components/number-field)                                                                                                                           | ліміти, квоти, білінг                                                                         |
| [meter](https://coss.com/ui/docs/components/meter)                                                                                                                                         | використання квоти (на відміну від `progress` — саме вимірювання, не прогрес)                 |
| [otp-field](https://coss.com/ui/docs/components/otp-field)                                                                                                                                 | 2FA, підтвердження пошти                                                                      |
| [fieldset](https://coss.com/ui/docs/components/fieldset) · [group](https://coss.com/ui/docs/components/group) · [frame](https://coss.com/ui/docs/components/frame)                         | секції довгих форм налаштувань                                                                |
| [toolbar](https://coss.com/ui/docs/components/toolbar)                                                                                                                                     | панель дій над грідом                                                                         |
| [preview-card](https://coss.com/ui/docs/components/preview-card)                                                                                                                           | попередній перегляд сутності по наведенню                                                     |
| [autocomplete](https://coss.com/ui/docs/components/autocomplete) · [checkbox-group](https://coss.com/ui/docs/components/checkbox-group) · [menu](https://coss.com/ui/docs/components/menu) | альтернативи нашим `combobox`/`checkbox`/`dropdown-menu` — брати лише якщо наших не вистачить |
| [segmented-control](https://coss.com/ui/docs/components/segmented-control)                                                                                                                 | перемикач режимів (у нас цю роль грає `toggle-group`)                                         |

> **Практичний висновок із розбору їхніх `select` і `input`** (UI-7, `ui-migration-history.md`):
> перш ніж тягнути компонент, перевір, чи потрібна поведінка вже не є **пропом у нашому**.
> `alignItemWithTrigger` (попап не накриває тригер) виявився в обох — це проп Base UI, а не
> фіча бібліотеки. З coss варто брати не файли, а **точкові прийоми**: ширина попапа
> `min-w-(--anchor-width)`, глушник autofill, скидання `::-webkit-search-cancel-button`.

⚠️ `toast`, `select`, `combobox`, `dialog` тощо в них теж є — **не брати**: у нас вони вже
є з `@shadcn`, а імена файлів збігаються (див. §5).

### 3.3 Kibo UI — погоджено точково

[Kibo UI Tree](https://www.kibo-ui.com/components/tree) — **погоджений on-demand компонент**
для файлового дерева та інших ієрархічних меню. Він має рекурсивні папки/файли, анімоване
розгортання, open/closed іконки папок, single/multi-select, кероване виділення, keyboard
navigation і опційні лінії вкладеності. Репозиторій
[shadcnblocks/kibo](https://github.com/shadcnblocks/kibo) має MIT-ліцензію.

Рішення: зараз не встановлювати і не додавати окремий namespace у `components.json`. Коли
зʼявиться перший споживач, перед додаванням повторно переглянути актуальний source/manifest,
встановити тільки `tree` з теки `libs/ui` через документований Kibo UI CLI, а потім:

1. звірити imports з alias `@saas-skeleton/ui` і Lucide;
2. перевірити, що компонент не приніс Radix primitives у наш Base UI стек;
3. привести focus, метрику, selection states і semantic tokens до `ui-stack.md`;
4. перевірити keyboard navigation та ARIA tree semantics;
5. експортувати через `libs/ui` для обох фронтендів.

Офіційний [`sidebar-11`](https://ui.shadcn.com/view/new-york-v4/sidebar-11) лишається
референсом простої композиції дерева всередині sidebar, але не замінює reusable `Tree`.

---

## 4. Блоки і шаблони: де що є

### 4.1 `@shadcn` — сторінкові блоки (безкоштовно, наш стиль)

[Галерея](https://ui.shadcn.com/blocks) · переглянути код:
`pnpm dlx shadcn@4.19.0 view @shadcn/<name>`

| Категорія            | Що всередині                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Посилання                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Сайдбари, 16 шт.** | `sidebar-01` секції · `sidebar-02` згортні секції · `sidebar-03`/`05` підменю · `sidebar-04` плаваючий · `sidebar-06` дропдауни · **`sidebar-07` іконковий рейл — шел `platform-web`** · `sidebar-08` inset із вторинною навігацією · **`sidebar-09` вкладені рейли — шел `web`** · `sidebar-10`/`13` у поповері/діалозі · `sidebar-11` дерево файлів · `sidebar-12` календар · `sidebar-14`/`15` праворуч / з обох боків · `sidebar-16` зі «липким» хедером | [/blocks/sidebar](https://ui.shadcn.com/blocks/sidebar)     |
| **Дашборд**          | `dashboard-01`: сайдбар + графіки + таблиця                                                                                                                                                                                                                                                                                                                                                                                                                  | [/blocks/dashboard](https://ui.shadcn.com/blocks/dashboard) |
| **Автентифікація**   | `login-01…05`, `signup-01…05` (форма, дві колонки з обкладинкою, лише email, соцпровайдери)                                                                                                                                                                                                                                                                                                                                                                  | [/blocks/login](https://ui.shadcn.com/blocks/login)         |
| **Графіки**          | ~70 блоків `chart-*` (area/bar/line/pie/radar/radial + тултіпи)                                                                                                                                                                                                                                                                                                                                                                                              | [/blocks](https://ui.shadcn.com/blocks)                     |

### 4.2 `@reui` — сторінкові блоки (**платні**, галерея відкрита)

[Галерея](https://reui.io/blocks) · JSON блоку віддає **401** без `REUI_LICENSE_KEY`.
Стиль `base-nova` підтримують, тобто після покупки лягли б у наш стек.

| Категорія                                     | К-сть      | Посилання                                                                                                                                                                            |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App Shell (каркаси застосунку)                | 20         | [/application/app-shell](https://reui.io/blocks/application/app-shell)                                                                                                               |
| Navbar (верхні меню)                          | 13         | [/application/navbar](https://reui.io/blocks/application/navbar)                                                                                                                     |
| Settings                                      | 16         | [/application/settings](https://reui.io/blocks/application/settings)                                                                                                                 |
| Stats (KPI-картки)                            | 15         | [/application/stats](https://reui.io/blocks/application/stats)                                                                                                                       |
| Dialog                                        | 14         | [/application/dialog](https://reui.io/blocks/application/dialog)                                                                                                                     |
| Empty State                                   | 14         | [/application/empty-state](https://reui.io/blocks/application/empty-state)                                                                                                           |
| Card                                          | 43         | [/application/card](https://reui.io/blocks/application/card)                                                                                                                         |
| Chart                                         | 30         | [/application/chart](https://reui.io/blocks/application/chart)                                                                                                                       |
| Form                                          | 12         | [/application/form](https://reui.io/blocks/application/form)                                                                                                                         |
| List                                          | 11         | [/application/list](https://reui.io/blocks/application/list)                                                                                                                         |
| Sheet                                         | 11         | [/application/sheet](https://reui.io/blocks/application/sheet)                                                                                                                       |
| Kanban Board                                  | 10         | [/application/kanban-board](https://reui.io/blocks/application/kanban-board)                                                                                                         |
| Schedule / Event Calendar / Gantt             | 10 / 6 / 4 | [/schedule](https://reui.io/blocks/application/schedule) · [/event-calendar](https://reui.io/blocks/application/event-calendar) · [/gantt](https://reui.io/blocks/application/gantt) |
| Profile (переважно self-service налаштування) | 9          | [/application/profile](https://reui.io/blocks/application/profile)                                                                                                                   |
| Onboarding                                    | 9          | [/application/onboarding](https://reui.io/blocks/application/onboarding)                                                                                                             |
| Dashboard                                     | 8          | [/application/dashboard](https://reui.io/blocks/application/dashboard)                                                                                                               |
| Auth                                          | 20         | [/application/auth](https://reui.io/blocks/application/auth)                                                                                                                         |

**Безкоштовна частина ReUI** — 1072 позиції `c-*`: це не бібліотека, а **приклади
використання** на наших же компонентах (`registryDependencies: ["avatar"]` тощо). Корисні
як зразок композиції, відкриваються прямо як JSON:

- [c-item-12](https://reui.io/r/base-nova/c-item-12.json) — стрічка активності з аватарами й діями
- [c-avatar-16](https://reui.io/r/base-nova/c-avatar-16.json) — аватар із деталями юзера й бейджем
- [c-popover-6](https://reui.io/r/base-nova/c-popover-6.json) — картка юзера в поповері
- [c-item-9](https://reui.io/r/base-nova/c-item-9.json) — рядки учасників із ролями і діями
- [c-dropdown-menu-14](https://reui.io/r/base-nova/c-dropdown-menu-14.json) — меню профілю з перемикачем теми

### 4.3 `@coss` — Particles (безкоштовно)

[Particles](https://coss.com/ui/particles) — **508** дрібних патернів `p-*` (не сторінкові
блоки, а варіанти застосування примітива): `p-button` 40, `p-input-group` 28, `p-calendar` 25,
`p-select` 23, `p-slider` 23, `p-group` 22, `p-badge` 20, `p-combobox` 20, `p-field` 18,
`p-autocomplete` 16, `p-tabs` 15, `p-drawer` 14, `p-toast` 13, `p-number-field` 11,
`p-date-picker` 9, `p-otp-field` 9 та інші. Формат — `https://coss.com/ui/r/p-<name>-<n>.json`.

### 4.4 DataGrid і фільтри

У нас уже є власний server-driven `components/data-grid/**`: Orval/TanStack Query fetching,
пагінація і сортування через API, URL-state через TanStack Router, selection та фабрики
типізованих `search`/`select` фільтрів. Зовнішні таблиці нижче не є drop-in заміною: більшість
із них побудована на TanStack Table і частково дублює нашу data/query architecture. Їхня
головна цінність зараз — складніші filter UX, column controls, virtualization та editing.

| Джерело                                                                                                                                                                         | Що дає                                                                                                                                                                                                                                          | Сумісність і ризики                                                                                                                                                                                                                        | Рішення для нас                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Офіційний shadcn Data Table](https://ui.shadcn.com/docs/components/data-table) · [`dashboard-01`](https://ui.shadcn.com/blocks/dashboard)                                      | Базовий рецепт Table + TanStack Table: sorting, filtering, pagination, selection і visibility; у dashboard є готова композиція таблиці                                                                                                          | Рідні Base UI primitives, але Data Table — **рецепт, не reusable registry-компонент**. Актуальна документація вже використовує TanStack Table v9; приклад переважно client-side                                                            | Канон для composition/accessibility і найнижчий ризик окремих UI-прийомів. Не переносити table engine поверх нашого гріда без окремої потреби                                                                                       |
| [ReUI Data Grid](https://reui.io/docs/components/base/data-grid) · [ReUI Filters](https://reui.io/docs/components/base/filters) · [галерея](https://reui.io/components/filters) | `@reui/data-grid`: TanStack Table v9, virtual, pin/resize/reorder, tree, infinite scroll. `@reui/filters`: flat chips і advanced builder над одним JSON query tree, вкладені `AND/OR`, async/paged options, custom editors, i18n та keyboard UX | **Base UI і `base-nova` є офіційними варіантами**, MIT; namespace уже налаштований. Filters ставиться в `components/reui/filters/**`, але тягне `cascader`, `@tanstack/react-virtual` і `date-fns`; grid створить паралельний table engine | **Найкращий кандидат.** Спочатку брати `@reui/filters` як source/окремий spike та адаптувати query tree до наших Zod contracts і TanStack Router. `@reui/data-grid` брати лише коли реально потрібні virtual/pin/edit/tree features |
| [Niko Table](https://niko-table.com) · [GitHub](https://github.com/Semkoo/niko-table-registry) · [advanced filters](https://niko-table.com/examples/advanced-table/)            | Модульний MIT registry: global/faceted/date/slider/inline filters, `AND/OR`, client/server pagination, selection, pinning, virtualization, CSV; окремий editable Data Grid із clipboard та undo/redo                                            | Явно підтримує Radix і **Base UI (`base-nova`)**, але базується на TanStack Table v8 і опційному `nuqs`; молодший проєкт, тож API/maturity треба перевіряти на конкретному item                                                            | Другий кандидат для читання composable filter primitives і spreadsheet UX. Не додавати namespace та не ставити весь набір наперед                                                                                                   |
| [shadcn-react-table](https://github.com/Monabbir-Ahmmad/shadcn-react-table) · [docs](https://monabbir-ahmmad.github.io/shadcn-react-table/docs/)                                | MIT registry-block з API, близьким до Material React Table: 8 типів column filter, compound `AND/OR` panel, fuzzy search, editing, grouping, pin/resize/DnD, virtualization і manual server modes                                               | Tailwind 4, TanStack Table v8; registry генерує Radix або **Base UI** flavor. Великий surface і багато опційних залежностей; це фактично повний альтернативний grid, а проєкт ще молодий                                                   | Вартий spike лише якщо вирішимо перейти на повний TanStack-based grid. Для додавання кількох фільтрів завеликий                                                                                                                     |
| [OpenStatus Data Table Filters](https://data-table.openstatus.dev/docs/introduction) · [GitHub](https://github.com/openstatusHQ/data-table-filters)                             | Зрілий MIT registry: schema-generated columns/filters, faceted filters, command palette, filter history, infinite Query, row sheet; адаптери memory/Zustand/`nuqs`                                                                              | Поточний demo/config — `new-york`/Radix і Next.js; server helpers орієнтовані на Drizzle. BYOS дозволяє власний store, але пряме встановлення принесе чужі table/schema/data abstractions                                                  | Сильний **UX-референс** для log/activity grids: command filters, async facets, filter history. Переносити патерни, не Drizzle/nuqs/schema layer                                                                                     |
| [TableCN](https://github.com/sadmann7/tablecn) · [Dice UI Data Table](https://diceui.com/docs/components/radix/data-table)                                                      | Популярне першоджерело Notion/Airtable filters, Linear-style command menu, auto filters, selection action bar, infinite virtualization; актуальна reusable документація живе в Dice UI                                                          | MIT, але поточний TableCN — `radix-nova`, Next.js, TanStack DB, Drizzle і PartyKit; Dice UI Data Table також Radix і показує `NuqsAdapter` для Next. Імпорти custom files після CLI треба правити вручну                                   | Лише read-only reference для `FilterList`/`FilterMenu` і bulk action bar. Не підключати `@diceui/data-table*` у Base UI застосунки                                                                                                  |
| [Shadcnblocks Data Table](https://www.shadcnblocks.com/blocks/data-table) · [faceted example](https://www.shadcnblocks.com/block/data-table12)                                  | 32 готові блоки: faceted/tabbed/multi filters, pinning, DnD, grouping, virtualization, editable/CRUD, multi-sort                                                                                                                                | Працюють як page blocks у React/Vite, але частина складних прикладів (зокрема faceted) — Pro; це цілі секції з page-level кодом, а не стабільна shared abstraction                                                                         | Галерея композицій і платне джерело під конкретний екран. Не купувати/встановлювати заради базових filter primitives                                                                                                                |

Практичний порядок розвитку нашого гріда:

1. Простий пошук, одинарні select/boolean і server pagination лишаються у нашому
   `createDataGrid`; зовнішній TanStack Table тут нічого не спрощує.
2. Наступні reusable primitives — faceted multi-select, date/date-range та applied-filter
   chips. Перший source для них — Base UI-версія ReUI Filters; другий — Niko Table.
3. Advanced builder додаємо лише разом із контрактом запиту: закрита Zod-схема полів,
   операторів і JSON query tree, серверна компіляція та обмеження depth/кількості правил.
   UI не повинен передавати довільні Prisma/SQL field names або predicates.
4. `nuqs` не вводимо: URL-state вже належить TanStack Router і route `validateSearch`.
   Зовнішній filter state адаптуємо до нього або передаємо як контрольований стан.
5. Повний сторонній Data Grid розглядаємо тільки під конкретну відсутню можливість —
   virtualization, column pinning/resizing, tree rows чи spreadsheet editing — окремим spike
   проти ReUI, Niko Table і shadcn-react-table. Orval hooks, API pagination, i18next і наші
   error/loading rules у будь-якому разі лишаються зовнішньою application boundary.

### 4.5 Адмін-блоки й застосунки, перевірені у 2026 році

Нижче джерела розділені за форматом. **Registry/block** можна оцінювати як точкове
джерело коду. **Full app** — це передусім референс архітектури та композиції сторінок:
цілий застосунок не переносимо в репозиторій.

| Джерело                                                                                                                                                                                                                                                              | Формат і актуальний стан                                                                                                                                                                                              | Сумісність із нами                                                                                                                                               | Рішення                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Офіційний `dashboard-01`](https://ui.shadcn.com/blocks/dashboard)                                                                                                                                                                                                   | Безкоштовний `registry:block`: shell, sidebar, KPI-картки, chart і data table                                                                                                                                         | Рідний `base-nova`; найнижчий ризик для наших токенів і примітивів                                                                                               | **Перша точка старту** для нового dashboard shell. Перед додаванням дивитися через `view`/`--dry-run`; сторінкові файли ставити в конкретний `apps/*`, не в `libs/ui`                                                                   |
| [Shadcn Studio — Dashboard & Application](https://shadcnstudio.com/blocks) · [Dashboard Shell](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-shell)                                                                                            | 800+ free/pro блоків загалом; у каталозі окремо є dashboard/application shells, headers, sidebars, charts, widgets, settings, forms, file upload та empty states. Безкоштовні блоки ставляться стандартним shadcn CLI | Автори явно постачають **Base UI і Radix UI** варіанти; працює з Vite                                                                                            | **Найкраще зовнішнє джерело готових блоків** для нашого стека. Брати один блок за раз і перевіряти ліцензію конкретної free/pro позиції                                                                                                 |
| [Shadcnblocks — Dashboard](https://www.shadcnblocks.com/blocks/dashboard) · [Templates](https://www.shadcnblocks.com/templates)                                                                                                                                      | Комерційний каталог: dashboard, application shell, CRUD, data table, settings, charts та повні admin templates; copy/paste або shadcn CLI                                                                             | Підтримує Base UI і Radix та читає тему з `components.json`                                                                                                      | Сильна платна альтернатива Shadcn Studio. Купувати лише під конкретний екран/набір; не використовувати як другу дизайн-систему                                                                                                          |
| [Marmelab Shadcn Admin Kit](https://github.com/marmelab/shadcn-admin-kit) · [`registry.json`](https://github.com/marmelab/shadcn-admin-kit/blob/main/registry.json) · [raw registry](https://raw.githubusercontent.com/marmelab/shadcn-admin-kit/main/registry.json) | MIT, справжній окремий registry. Блок `admin` містить CRUD List/Show/Edit/Create, DataTable, поля, reference inputs, auth/access control, i18n, layout і dashboard                                                    | Radix; залежить від `ra-core`, React Router, TanStack Query та власних CRUD-абстракцій                                                                           | **Не ставити `admin` цілком**: він створить паралельну архітектуру до наших Orval hooks, `createDataGrid`, RHF wrappers, TanStack Router і custom auth. Читати код для CRUD-композиції, bulk actions, reference fields та saved queries |
| [Kiranism Next Shadcn Dashboard Starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)                                                                                                                                                                  | MIT, актуальний Next 16 starter: робочі tables/forms/auth/orgs/billing, feature-based structure, URL-synced tables                                                                                                    | Shadcn на **Base UI**, Tailwind 4, React 19, TanStack Query/Zustand; але Next.js, Clerk і TanStack Form замість Vite, custom auth і RHF                          | Один із найкращих **архітектурних референсів** 2026 року. Переносити патерни сторінок і URL-state, не framework/auth/form code                                                                                                          |
| [Studio Admin — Base UI](https://github.com/arhamkhnz/next-shadcn-admin-dashboard-baseui) · [TanStack Start fork](https://github.com/arhamkhnz/tanstack-shadcn-admin-dashboard)                                                                                      | MIT, багато готових екранів: CRM, finance, analytics, file manager, users/roles, chat, calendar, kanban, invoice, auth                                                                                                | Base UI fork має точний стиль `base-nova`, але Next 16. TanStack fork ближчий до нашого router/Vite-підходу, проте це Start/Nitro і Base UI там не підтверджений | Base UI fork — референс візуальної композиції; TanStack fork — референс routes/features. Не копіювати app shell або primitives пакетно                                                                                                  |
| [ShadcnStore Dashboard Landing Template](https://github.com/shadcnstore/shadcn-dashboard-landing-template)                                                                                                                                                           | MIT, має Vite/React 19/Tailwind 4 варіант, dashboard-и та сторінки Mail, Tasks, Chat, Calendar, Users                                                                                                                 | Vite близький до нас, але компоненти побудовані на Radix/`new-york`                                                                                              | Корисний референс повних Vite-сторінок; переносити лише layout/composition після заміни primitives на наші                                                                                                                              |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)                                                                                                                                                                                                    | MIT, зріла Vite + TanStack Router адмінка; вже була джерелом частини наших рішень                                                                                                                                     | Radix і модифіковані shadcn-компоненти                                                                                                                           | Залишається перевіреним референсом для page layout і URL-driven data tables, але не джерелом primitives                                                                                                                                 |
| [Shadcn UI Kit — Admin Dashboard](https://shadcnuikit.com/admin-dashboard)                                                                                                                                                                                           | Комерційний full app; на сторінці вказано оновлення 2026-08-23, Next 16, Tailwind 4, 15 dashboard-ів і 17 app-модулів                                                                                                 | Base UI не підтверджений; Next.js                                                                                                                                | Свіжий каталог сценаріїв/екранів, не технічне джерело, доки не перевірено ліцензію й код конкретного пакета                                                                                                                             |

Додаткове місце пошуку — офіційний
[Registry Directory](https://ui.shadcn.com/docs/directory). CLI вміє шукати community registries,
але сам shadcn попереджає, що сторонній registry-код треба переглядати перед встановленням.

### 4.6 Практичний порядок для наших адмінок

1. Спочатку шукаємо сторінковий блок в офіційному `@shadcn`, далі — Base UI-варіант у
   Shadcn Studio, потім — у Shadcnblocks, якщо виправдана комерційна ліцензія.
2. Перед встановленням дивимося повний manifest і diff:
   `pnpm dlx shadcn@4.19.0 view <item>` та
   `pnpm dlx shadcn@4.19.0 add <item> --dry-run`. Команду запускаємо з теки цільового
   застосунку для page/block і з `libs/ui` лише для справді спільного primitive.
3. Full-app репозиторії використовуємо як **read-only reference**. Не переносимо їхні
   routing, auth, data fetching, form abstractions, providers, global CSS або
   `components/ui` поверх наших.
4. Із зовнішнього блоку лишаємо композицію сторінки, а поведінку підключаємо до наших
   Orval/TanStack Query hooks, `createDataGrid`, RHF wrappers, i18next і generated contracts.
5. Новий app block має пройти стани loading/error/empty/forbidden, keyboard/focus,
   responsive shell, dark theme та обидва фронтенди. UI-перевірка RBAC не замінює
   серверну авторизацію.

Спільний знаменник сильних адмінок 2026 року — це не «універсальний admin component», а
композиція з app shell, URL-синхронізованої таблиці, окремих query/mutation boundaries,
повних async/empty/error states і доменних feature-модулів. У нас ці межі вже закладені;
тому блоки мають заповнювати **layout**, а не приносити другу application architecture.

### 4.7 Інші референси без встановлення

| Джерело                                                                                 | Що там                                                                                                                                                                                  | Ціна            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [Tailwind Plus → Application UI](https://tailwindcss.com/plus/ui-blocks/application-ui) | першоджерело більшості патернів; окремо цінні [Detail screens](https://tailwindcss.com/plus/ui-blocks/application-ui/page-examples/detail-screens) — з них узята розкладка наших карток | платно          |
| [Origin UI](https://originui.com)                                                       | ~500 дрібних патернів                                                                                                                                                                   | безкоштовно     |
| [21st.dev](https://21st.dev)                                                            | спільнотний каталог                                                                                                                                                                     | безкоштовно     |
| [Tremor Blocks](https://blocks.tremor.so)                                               | дашборди й KPI                                                                                                                                                                          | частково платно |
| [tailark.com](https://tailark.com/blocks)                                               | велика бібліотека переважно marketing-блоків; для адмінок нижчий пріоритет                                                                                                              | платно          |

---

## 5. Чекліст: беремо компонент НЕ з `@shadcn`

1. **Імʼя файла не повинно збігатися** з нашим у `libs/ui/src/components/ui/` — інакше CLI
   перезапише наш вендорений код разом із локальними правками, а місця виклику зламаються
   (у `@coss` частини звуться інакше: `SelectPopup` замість нашого `SelectContent`).
2. **Прогрепати на невідомі токени.** `destructive-foreground` у нас уже є; `info` та інші
   ролі, яких немає в `@theme inline`, треба свідомо зіставити з нашими semantic tokens або
   додати повною парою `--role` / `--role-foreground` для light і dark.
3. **Вирівняти метрику й фокус** під наші: висота контролів 36px (`sm` 32, `xs` 28, `lg` 40),
   фокус — суцільне `ring-2` кольору `--ring` (у `@coss` — адаптивна висота `min-h-9 sm:min-h-8`
   і `ring-[3px]` при 24% непрозорості).
4. **Позначити джерело** коментарем у файлі — так само, як ми позначаємо локальні правки.
5. **Не запускати** `add @coss/ui`, `init @coss/style`, `add --all` — вони тягнуть увесь
   набір поверх нашого і перезаписують тему та шрифти.

---

## 6. Що з цього вже застосовано

| Рішення                                                                              | Джерело                                                                                    | Де                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Розкладка шела (бренд угорі, профіль у футері, `collapsible="icon"`)                 | `@shadcn/sidebar-07`                                                                       | `app-layout.tsx` у `platform-web`, UI-3                  |
| Двоколонковий шел: смуга іконок + колонка розділу                                    | `@shadcn/sidebar-09`                                                                       | `app-shell/` у `web` (2 відхилення — `app-shell.md` §5)  |
| Розкладка карток `/users/$userId` і `/tenants/$tenantId`                             | Tailwind Plus → Detail screens                                                             | `pages/user-detail.tsx`, `pages/tenant-detail.tsx`       |
| Палітра slate, білі поверхні, `--radius`, стокові тіні                               | [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) (`src/styles/theme.css`) | `libs/ui/src/styles.css`, UI-4                           |
| Розкладка сторінок списків (шапка + рядок тулбара + `Reset`)                         | там само (`src/features/users`, `src/components/data-table/toolbar.tsx`)                   | `data-grid/filters.tsx`, сторінки списків, UI-6          |
| Хлібні крихти в хедері                                                               | `@shadcn/breadcrumb` + власний портал                                                      | `page-header-slot.tsx`, `page-breadcrumbs.tsx`, UI-5     |
| Синій `--primary`/`--ring`, метрика контролів 36px                                   | наші свідомі відхилення від стоку (`ui-stack.md` §3)                                       | `ui/button.tsx`, поля                                    |
| Ширина попапа `min-w-(--anchor-width)`, глушник autofill, скидання ✕ у `type=search` | `@coss` — точкові прийоми, не файли                                                        | `ui/select.tsx`, `ui/input.tsx`, UI-7                    |
| Розкладка розділу `/settings` (липка бічна навігація + `ContentSection`)             | там само (`src/features/settings`)                                                         | `components/settings/*`, `pages/settings/*` (2026-08-29) |
