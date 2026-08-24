# Задача: перевести `apps/platform-web` з HeroUI v3 (beta) на shadcn/ui (Base UI)

Виконуй у монорепо `saas-skeleton`, застосунок `apps/platform-web`. Це React 19 + Vite 7 + Tailwind CSS v4 +
TanStack Router/Query SaaS-адмінка (керування tenant'ами, моніторинг job-черг). Зараз UI повністю на
`@heroui/react` (`^3.2.2`, бета compound-API на React Aria Components). Мета — прибрати HeroUI, поставити
shadcn/ui на базі **Base UI**, зберігши публічні контракти власних компонентів.

> **Ревізія плану 2026-08-23.** Первинна версія плану перевірена проти коду і проти актуального стану
> бібліотек. Знайдено 5 файлів із HeroUI поза інвентарем, 3 хибних твердження про «не треба чіпати» і
> 2 великі пропущені блоки робіт (токени Tailwind-утиліт у розмітці; конфіг-передумови shadcn CLI).
> Дельта — у §0, повний перевірений інвентар — у §2.

---

## 0. Що змінено проти первинного плану (і чому)

| #   | Первинний план                                                                                     | Факт / правка                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | «Це вичерпний список» (12 файлів)                                                                  | **Неповний.** `grep -rn "@heroui" apps/platform-web/src` дає **17** файлів. Пропущені: `data-grid/filters.tsx`, `data-grid/types.ts`, `data-grid/sort.ts`, `data-grid/create-data-grid.tsx`, `lib/error-toast.ts` (§2)                                                                                                                                                                                                                                                                                                                          |
| 2   | «`types.ts`, `use-data-grid-filters.ts`, `sort.ts` чіпати не треба — не залежать від HeroUI»       | **Хибно.** `types.ts` і `sort.ts` імпортують `type SortDescriptor` з `@heroui/react`, і цей тип стоїть **у публічному контракті** `DataGridNavigation`. Правка мінімальна, але обов'язкова (§5.4)                                                                                                                                                                                                                                                                                                                                               |
| 3   | «Сторінки чіпати не треба»                                                                         | **Частково хибно.** `tenants.tsx`/`jobs.tsx`/`login.tsx` імпортують HeroUI напряму (це план знає) **і** всюди використовують Tailwind-утиліти на токенах HeroUI-теми (`text-muted`, `bg-surface`, `bg-accent-soft`, `text-warning`…). Після зняття `@heroui/styles` ці класи **не ламають білд — вони просто перестають щось робити** (Tailwind v4 не має таких `--color-*`). Тихий регрес зовнішнього вигляду. Потрібен окремий крок-свіп (§4)                                                                                                 |
| 4   | Крок 5: «заміни `@import '@heroui/styles'` на стандартну shadcn-тему… перенеси наміри override'ів» | Робиться не руками: `shadcn init --preset base-nova` **сам** пише повний набір токенів light/dark у `index.css`. Наміри радіусів зводяться до **одного** рядка `--radius: 0.5rem` (арифметика — §4.2), а «видима рамка полів» — це вже дефолт shadcn `Input` (`border border-input`). Уся секція `--field-*` і класи `.modal__dialog`/`.select__popover` просто зникають                                                                                                                                                                        |
| 5   | Крок 3: «подивись, чи в ReUI є готовий data-table… використай як каркас»                           | **Не рекомендується.** ReUI DataGrid побудований на TanStack Table (клієнтська модель колонок/сортування/пагінації). Наш `data-grid/` — це вже власний headless-шар під **серверну** колекцію (URL-синхронізовані фільтри, `page/limit/sortBy/sortOrder` в API, keyset немає), і він **уже не залежить від HeroUI** нічим, крім типу `SortDescriptor`. Замінювати каркас = переписувати контракт, який план забороняє змінювати. Рішення: примітиви беремо з `@shadcn`, ReUI **не використовуємо**, реєстр `@reui` прописуємо на майбутнє (§D3) |
| 6   | Крок 2: «Sonner або Toast-компонент» / «Input Group або еквівалент з ReUI» / «Empty State»         | Уточнено по факту реєстру: `@shadcn/toast` (для Base UI — саме він, не sonner), `@shadcn/input-group`, `@shadcn/empty`, `@shadcn/spinner`, `@shadcn/field`. Повний перелік — §3                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Крок 1: «постав shadcn CLI, обери базу Base UI»                                                    | Base UI — **дефолт** CLI з липня 2026 (`init` без флагів; `-b radix` — щоб НЕ Base UI). Але перед `init` треба закрити конфіг-передумови, яких у проєкті немає: alias `@/*` у tsconfig **і** у `vite.config.ts`, ESLint-override, prettier. Це новий крок §5.0                                                                                                                                                                                                                                                                                  |
| 8   | Крок 7: «перевір, чи потрібен `lucide-react`»                                                      | Перевірено: **потрібен**. Компоненти реєстру (`select`, `checkbox`, `dropdown-menu`, `pagination`, `dialog`, `spinner`) імпортують іконки з `lucide-react`. Це конфлікт із зафіксованим у CLAUDE.md рішенням «без пакетів іконок»; **рішення прийнято — lucide повністю, наші інлайн-SVG теж на нього** (§D2)                                                                                                                                                                                                                                   |
| 9   | — (немає в плані)                                                                                  | `data-grid/*` — **8 файлів побайтово ідентичні** з `apps/web` (перевірено `diff -rq`; різняться тільки `index.ts` і `cell-switch.tsx`). Міграція одного застосунку робить постійну розбіжність двох UI-стеків у монорепо. Рішення: **пілот на platform-web**, `apps/web` лишається на HeroUI (§D1)                                                                                                                                                                                                                                              |
| 10  | Критерії приймання                                                                                 | Додано: `pnpm lint` / `format:check`, відсутність `@heroui` у `pnpm-lock.yaml`, grep на мертві токен-утиліти, **обидва** хаки з `data-grid.tsx` видалені (не тільки чекбокс — ще й портал у `<th>`), оновлення `CLAUDE.md` і `docs/frontend-ui-known-issues.md`                                                                                                                                                                                                                                                                                 |

---

## 1. Зафіксовані рішення (закриті користувачем 2026-08-23)

### D1. Обсяг: **пілот на `apps/platform-web`; `apps/web` лишається на HeroUI**

`apps/web/src/components/data-grid/{data-grid,filters,create-data-grid,data-grid-query,use-data-grid-filters,use-data-grid-selection,sort,types}.*`
— **побайтово ті самі файли**, що в `platform-web` (CLAUDE.md фіксує це як свідоме копіювання 1:1 на MT-3);
`form/`, `theme-switcher.tsx`, `api-error.ts` — так само. Міграція одного застосунку робить ці копії
розбіжними **свідомо і надовго**.

Наслідки, які треба тримати в голові під час роботи:

- tenant-web (files, notifications, realtime, activity drawer) у цій задачі **не зачіпається** — жодного
  файла в `apps/web` не редагуємо;
- правки, зроблені в `platform-web/components/data-grid/**` і `form/**`, **не back-portable** в `apps/web`,
  доки той на HeroUI. Копіювати їх назад — заборонено (зламає HeroUI-версію);
- `libs/ui` як спільний шар — **не зараз** (розглянуто й відкладено: новий workspace-пакет + три місця
  реєстрації за правилом №1 CLAUDE.md + Tailwind-джерела через `@source`);
- запис у `CLAUDE.md` обов'язковий (§5.6) — інакше наступна сесія «полагодить» розбіжність назад.

### D2. Іконки: **`lucide-react` прийнято повністю**

Компоненти реєстру приходять з `lucide-react` у своєму коді (chevron у `Select`, check у `Checkbox`,
⋯ у `DropdownMenu`, стрілки в `Pagination`, ✕ у `Dialog`, лоадер у `Spinner`) — вичищати їх вручну
означало б назавжди конфліктні `shadcn add --diff` при оновленні з апстріму.

- `iconLibrary: "lucide"` у `components.json`, per-icon імпорти (tree-shaking).
- **Наші власні інлайн-SVG теж переїжджають на lucide**: `SunIcon`/`MoonIcon` (`theme-switcher.tsx`),
  `EyeIcon`/`EyeSlashIcon` (`form-password-field.tsx`), `MoreIcon` (`data-grid.tsx`) → `Sun`, `Moon`,
  `Eye`, `EyeOff`, `MoreHorizontal`. ≈80 рядків SVG видаляється.
- Іконки в компонентах — за правилом скіла: `data-icon="inline-start"|"inline-end"`, **без** класів розміру
  (`size-4` тощо — компонент керує розміром сам).
- **Це перегляд зафіксованого рішення CLAUDE.md, правило 12** («без пакетів іконок, інлайн-SVG») —
  рішення користувача 2026-08-23; правило 12 треба переписати (§5.6).

### D3. Стиль `base-nova`; ReUI **не використовуємо**, реєстр прописуємо

- `style: "base-nova"`. Причина: (i) дефолт `init --defaults`; (ii) реєстр ReUI віддає файли по URL
  `https://reui.io/r/{style}/{name}.json`, де `{style}` — саме `base-nova`/`radix-nova`, тож цей вибір
  тримає ReUI сумісним «на потім» без міграції стилю.
- Усі потрібні примітиви є в `@shadcn` (§3) — ReUI у цій міграції **не використовується**; ReUI DataGrid як
  каркас **відкинуто** (обґрунтування — §0.5: TanStack-Table-центрична клієнтська модель проти нашої
  серверної колекції з URL-фільтрами).
- Реєстр `@reui` все одно прописуємо в `components.json` — тоді компонент звідти = один
  `shadcn add @reui/<name>`, коли реально знадобиться (Filters, Autocomplete, Tree, Kanban — цього в
  shadcn немає).
- MCP ReUI (`https://mcp.reui.io`, HTTP + OAuth) — **не ставимо** до першого `@reui/*` компонента.

### D4. Мертвий код у контракті (вирішити на місці, за рекомендацією)

- `FormSelect` — **ніде не використовується** (`grep` по `platform-web` дає тільки визначення). Base UI
  `Select` вимагає `items`-проп на корені (§3), тобто перепис нетривіальний. Рекомендація: **видалити**
  разом із експортом із `components/form/index.ts`; повернути, коли з'явиться перша форма із селектом.
- Проп `variant?: 'primary' | 'secondary'` у `FormTextField`/`FormPasswordField` — **жоден викликач його не
  передає**, а в shadcn немає такої вісі варіантів у `Input`. Рекомендація: **видалити проп** (це не
  звуження контракту, який хтось споживає).

### D5. `SortDescriptor` — власний тип у `types.ts`

`DataGridNavigation.sortDescriptor/onSortChange` типізовані типом React Aria з `@heroui/react`. shadcn
`Table` — чиста розмітка без моделі сортування, тобто споживача словника `ascending`/`descending` не
лишається. Рішення: `export interface SortDescriptor { column: string; direction: 'ascending' | 'descending' }`
у `types.ts` — форма публічного контракту не змінюється, `sort.ts` лишається містком, зникає навіть каст
`String(descriptor.column)` (у RAC `column` — `Key`, у нас — `string`). Альтернатива
(`sortBy/sortOrder + toggleSort(columnId)`) відкинута: це зміна контракту `DataGridNavigation`, яку план
забороняє.

---

## 2. Перевірений інвентар HeroUI (17 файлів)

Джерело: `grep -rn "@heroui" apps/platform-web/src` (2026-08-23).

| Файл                                                | Що з HeroUI                                                                                                                                 | Було в плані |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `src/index.css`                                     | `@import '@heroui/styles'` + ~90 рядків override'ів HeroUI-класів                                                                           | ✔            |
| `src/main.tsx`                                      | `ThemeProvider attribute={['class','data-theme']}`                                                                                          | ✔            |
| `src/components/app-layout.tsx`                     | `Avatar`, `Avatar.Fallback`, `Dropdown.*`                                                                                                   | ✔            |
| `src/components/theme-switcher.tsx`                 | `Button`, `Dropdown.*`                                                                                                                      | ✔            |
| `src/components/toast-host.tsx`                     | `Toast.Provider` (`placement`)                                                                                                              | ✔            |
| `src/components/create-tenant-modal.tsx`            | `Button`, `Modal.*`                                                                                                                         | ✔            |
| `src/components/form/form-text-field.tsx`           | `TextField`, `Label`, `Input`, `FieldError`                                                                                                 | ✔            |
| `src/components/form/form-password-field.tsx`       | `TextField`, `Label`, `InputGroup.*`, `Button`, `FieldError`                                                                                | ✔            |
| `src/components/form/form-select.tsx`               | `Select.*`, `ListBox.*`, `Label`, `FieldError`                                                                                              | ✔            |
| `src/components/data-grid/data-grid.tsx`            | `Table.*`, `Pagination.*`, `Select.*`, `ListBox.*`, `Checkbox.*`, `Dropdown.*`, `AlertDialog.*`, `Button`, `Label`, `Spinner`, `EmptyState` | ✔            |
| `src/pages/login.tsx`                               | `Button`, `Card`                                                                                                                            | ✔            |
| `src/pages/tenants.tsx`                             | `Table.*`, `AlertDialog.*`, `Button`, `Chip`, `Spinner`, `EmptyState`                                                                       | ✔            |
| `src/pages/jobs.tsx`                                | `Card`, `Chip`                                                                                                                              | ✔            |
| **`src/lib/error-toast.ts`**                        | **імперативний `toast.danger(title, { description })`** — його кличе глобальний `onError` у `main.tsx`, тобто **поза React-деревом**        | ✗            |
| **`src/components/data-grid/filters.tsx`**          | **`TextField`, `Input`, `Select.*`, `ListBox.*`** (тулбар фільтрів)                                                                         | ✗            |
| **`src/components/data-grid/create-data-grid.tsx`** | **`Button`** (у `SelectionSummary`)                                                                                                         | ✗            |
| **`src/components/data-grid/types.ts`**             | **`type SortDescriptor`** — у публічному `DataGridNavigation`                                                                               | ✗            |
| **`src/components/data-grid/sort.ts`**              | **`type SortDescriptor`** (місток UI ↔ API)                                                                                                 | ✗            |

Файли `data-grid/`, які HeroUI **справді** не торкаються і які чіпати не треба:
`data-grid-query.ts`, `use-data-grid-filters.ts` (лишається як є — тільки транзитивно бере тип із `sort.ts`),
`use-data-grid-selection.ts`, `index.ts` (реекспорти).

---

## 3. Мапа компонентів HeroUI → shadcn (перевірено по реєстру `@shadcn`, CLI 4.19.0)

| HeroUI                               | shadcn (`shadcn add …`)           | Примітки / пастки                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                             | `@shadcn/button`                  | `onPress` → `onClick`; `isDisabled` → `disabled`; `isIconOnly` → `size="icon"`; `fullWidth` → `className="w-full"`; варіанти: `primary`→`default`, `tertiary`→`outline`, `ghost`→`ghost`, `danger`→`destructive`                                                                                                                                                                                                                                                                                                     |
| `Card`                               | `@shadcn/card`                    | Правило скіла: повна композиція `CardHeader/CardTitle/CardContent`. Для `jobs.tsx` (плитка чергі) і `login.tsx` (обгортка форми) це або композиція, або свідомо `Card` + `CardContent`                                                                                                                                                                                                                                                                                                                               |
| `Chip`                               | `@shadcn/badge`                   | Варіанти shadcn: `default/secondary/destructive/outline`. **`success`/`warning` немає** — 6 станів job-а і статус тенанта вимагають розширення `badge.tsx` (§4.3)                                                                                                                                                                                                                                                                                                                                                    |
| `Avatar`, `Avatar.Fallback`          | `@shadcn/avatar`                  | `AvatarFallback` обов'язковий (правило скіла)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Dropdown.*`                         | `@shadcn/dropdown-menu`           | **Base UI: тригер через `render`, не `asChild`**: `<DropdownMenuTrigger render={<Button/>}>`. `onAction(key)` на меню → `onClick` на кожному `DropdownMenuItem`. Пункти обов'язково в `DropdownMenuGroup`. `variant="danger"` → `variant="destructive"`                                                                                                                                                                                                                                                              |
| `Modal.*`                            | `@shadcn/dialog`                  | `DialogTitle` обов'язковий (a11y). `Modal.CloseTrigger` → вбудована ✕ у `DialogContent` (`showCloseButton`). `<Button slot="close">` → `<DialogClose render={<Button variant="outline"/>}>`                                                                                                                                                                                                                                                                                                                          |
| `AlertDialog.*`                      | `@shadcn/alert-dialog`            | `AlertDialogCancel` / `AlertDialogAction` замість `slot="close"`. **`AlertDialog.Icon status=…` аналога немає** → або lucide-іконка вручну, або свідомо прибрати (§7, візуальна розбіжність)                                                                                                                                                                                                                                                                                                                         |
| `TextField` + `Label` + `FieldError` | `@shadcn/field` + `@shadcn/label` | `Field`/`FieldLabel`/`FieldError`/`FieldDescription`/`FieldGroup`. Валідність: **`data-invalid` на `Field` + `aria-invalid` на контролі** (обидва). `FieldError` приймає `errors={fieldState.error}` (RHF-сумісний) або children. **HeroUI зв'язував label↔input сам — тепер потрібен явний `id` (`useId()`) + `htmlFor`**                                                                                                                                                                                           |
| `Input`                              | `@shadcn/input`                   | Рамка полів (`border border-input`) — дефолт shadcn, наш override зникає                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `InputGroup.*`                       | `@shadcn/input-group`             | Всередині — **`InputGroupInput`, не `Input`**; кнопка — в `InputGroupAddon`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Select.*` + `ListBox.*`             | `@shadcn/select`                  | **Base UI вимагає `items` на корені `Select`** + плейсхолдер як `{ value: null }`; позиціювання — `alignItemWithTrigger`, не `position`                                                                                                                                                                                                                                                                                                                                                                              |
| `Checkbox.*`                         | `@shadcn/checkbox`                | Base UI: `checked` / `onCheckedChange` / **`indeterminate`** + `inputRef` до схованого `<input>`. Саме це закриває баг, через який існує костиль (§5.5)                                                                                                                                                                                                                                                                                                                                                              |
| `Table.*`                            | `@shadcn/table`                   | **Чиста розмітка** (`Table/TableHeader/TableRow/TableHead/TableBody/TableCell/TableCaption`), без колекції React Aria: **немає** `sortDescriptor`/`onSortChange`/`renderEmptyState`/`isRowHeader`/`ScrollContainer`/`Footer`. Сортування, порожній стан і скрол-контейнер реалізуємо самі (§5.5)                                                                                                                                                                                                                     |
| `Pagination.*`                       | `@shadcn/pagination`              | `PaginationLink` рендерить `<a href>`; нам потрібні кнопки без навігації → `render={<button type="button"/>}` (+ `nativeButton={false}` де потрібно). Наш `lib/page-items.ts` (вікно сторінок з `…`) лишається без змін                                                                                                                                                                                                                                                                                              |
| `Spinner`                            | `@shadcn/spinner`                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `EmptyState`                         | `@shadcn/empty`                   | `Empty/EmptyHeader/EmptyTitle/EmptyDescription`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Toast.Provider` + `toast.danger()`  | `@shadcn/toast`                   | **Для Base UI — саме `toast`, не `sonner`.** API: `<Toaster/>` + `toast.add({ type: 'error', title, description })`. **Позиція — виключно CSS** (немає `placement`-пропа): per-route розкладка стає нашим `className` (§5.2). Імперативний виклик поза React (наш `error-toast.ts`) вимагає, щоб менеджер тостів був створений на рівні модуля (Base UI `Toast.createToastManager()` → `toastManager` у `Toast.Provider`) — **перевірити в доданому `ui/toast.tsx` і, якщо там менеджер із хука, зробити модульний** |
| —                                    | `@shadcn/data-table`              | **Не існує.** Data-table у shadcn — це рецепт у доках на TanStack Table, не компонент реєстру. Наш `data-grid/` лишається нашим (§0.5)                                                                                                                                                                                                                                                                                                                                                                               |

---

## 4. Тема, токени й утиліти (найбільш недооцінений блок)

### 4.1 Звідки беруться кольори

`init --preset base-nova` перезаписує `src/index.css`: `@import "tailwindcss"`, `@custom-variant dark`,
`:root`/`.dark` з повним набором `--background/--foreground/--card/--popover/--primary/--secondary/--muted/
--accent/--destructive/--border/--input/--ring/--radius/--sidebar-*`, `@theme inline` з мапінгом у
`--color-*`. Ручного «переносу кольорової теми» немає — є ревізія того, що згенерувалось.

**Обов'язково: збережіть поточний `index.css` у git до `init`** (він перезаписується) — з нього беруться
_наміри_, перелічені нижче.

### 4.2 Наміри поточних override'ів → куди діваються

| Намір (з коментарів у `index.css`)                                      | У shadcn                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| панелі/вікна/діалоги 24→**12px**                                        | `rounded-xl` = `calc(var(--radius) + 4px)`                                                                                                                                                                          |
| попапи й поля 12→**8px**                                                | `rounded-lg` = `var(--radius)`                                                                                                                                                                                      |
| пункти меню/списків **6px**                                             | `rounded-md` = `calc(var(--radius) - 2px)`                                                                                                                                                                          |
| таблиця **12px** (внутрішні 8px)                                        | `rounded-xl` / `rounded-lg`                                                                                                                                                                                         |
| —                                                                       | **⇒ один рядок: `--radius: 0.5rem`** (8px) → sm=4, md=6, lg=8, xl=12. Уся арифметика збігається з поточними намірами; перевірити фактичні формули у згенерованому `index.css` після `init`                          |
| «поля мають видиму рамку» (`--field-border`, `--field-border-width`)    | Дефолт: `Input` має `border border-input`. Блок `--field-*` видаляється цілком                                                                                                                                      |
| «з рамкою тінь полів зайва»                                             | Дефолт shadcn: тіні на полях немає                                                                                                                                                                                  |
| «чисте 2px focus-кільце без подвійної лінії»                            | shadcn дефолт — `ring-[3px] ring-ring/50` + `border-ring`. Це **розбіжність**: або приймаємо 3px-дефолт, або точково правимо `focus-visible:ring-2` у `ui/input.tsx`/`ui/select.tsx`. Рішення — по факту в браузері |
| `.checkbox { --field-border: transparent }` (виняток для чекбокса)      | Не потрібно: у shadcn чекбокс не споживає токени полів                                                                                                                                                              |
| світла тема: 1px-обвід попапів (`box-shadow … 0 0 0 1px var(--border)`) | `PopoverContent`/`DropdownMenuContent`/`SelectContent` у shadcn мають `border` за дефолтом                                                                                                                          |

### 4.3 Свіп Tailwind-утиліт на токенах HeroUI (тихий регрес!)

`@heroui/styles` реєструє `--color-muted`, `--color-surface`, `--color-accent-soft` тощо, тому в розмітці
живуть `text-muted`, `bg-surface`, `bg-accent-soft`… Після зняття імпорту Tailwind **не згенерує цих класів і
не впаде** — текст просто втратить колір. Знайти все:

```bash
grep -rnE '\b(bg|text|border|ring|outline)-(background|background-secondary|surface|muted|accent|accent-soft|accent-soft-foreground|danger|success|warning|link|field|field-border)\b' apps/platform-web/src
```

Мапа (≈37 вживань у 13 файлах, включно з тими, які план вважав «не треба чіпати»):

| HeroUI-утиліта                                                       | shadcn                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg-background`, `text-foreground`, `border-border`                  | без змін (імена збігаються)                                                                                                                                                                                                                    |
| `text-muted`                                                         | `text-muted-foreground`                                                                                                                                                                                                                        |
| `bg-surface` (сайдбар, хедер)                                        | `bg-card` (або `bg-sidebar` — `sidebar-*` токени preset дає)                                                                                                                                                                                   |
| `bg-background-secondary` (hover нав-лінка)                          | `bg-accent`                                                                                                                                                                                                                                    |
| `bg-accent-soft` + `text-accent-soft-foreground` (активний нав-лінк) | `bg-accent text-accent-foreground`                                                                                                                                                                                                             |
| `text-accent` (бренд у сайдбарі)                                     | `text-primary`                                                                                                                                                                                                                                 |
| `text-danger`                                                        | `text-destructive`                                                                                                                                                                                                                             |
| `outline-accent` (focus-ring костиля)                                | зникає разом із костилем (§5.5)                                                                                                                                                                                                                |
| `text-warning`, `Chip color="success"/"warning"`                     | **немає в shadcn.** Додати `--success`/`--warning` (+`-foreground`) у `:root`/`.dark` та `@theme inline`, і варіанти `success`/`warning` у cva `badge.tsx`. Це мінімальне розширення теми — 6 станів job-а і статус тенанта інакше не передати |
| `bg-field`, `border-field-border` (у костилі/InputGroup)             | зникають                                                                                                                                                                                                                                       |

---

## 5. Порядок виконання

### 5.0 Передумови конфігу (нове; ДО `shadcn init`)

1. **Alias `@/*` — у ДВА місця.** shadcn пише імпорти `@/components/ui/...`, `@/lib/utils`.
   - `apps/platform-web/tsconfig.json`: додати `"baseUrl": "."` і `"paths": { "@/*": ["src/*"] }`.
     ⚠️ `paths` у наслідуваному конфігу **замінюється, а не зливається** (грабля з MT-3, CLAUDE.md): після
     цього `@saas-skeleton/*` більше не резолвиться через `paths` із `tsconfig.base.json`. Це **безпечно** —
     `libs/contracts` має `exports` (`.` і `./platform`), `libs/i18n` має `main`, тобто резолюція йде через
     workspace-симлінки в `node_modules` (як у `platform-api` і як уже робить Vite). Перевірити `typecheck`
     **одразу після** правки tsconfig, до будь-яких змін у коді.
   - `apps/platform-web/vite.config.ts`: `resolve.alias` — Vite **не читає** tsconfig `paths`:
     ```ts
     resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
     ```
2. **ESLint.** Корневий конфіг — `strictTypeChecked` + `stylisticTypeChecked` + `no-explicit-any` на
   `apps/platform-web/**`. Вендорений код у `src/components/ui/**` під це не писався. Додати в
   `eslint.config.mjs` блок-override саме для `apps/platform-web/src/components/ui/**` (склад правил
   визначити емпірично: `pnpm lint` після першого `add`, гасити лише те, що реально стріляє).
   **Не** заносити в `ignores` — файли наші, ми їх редагуємо.
3. **Prettier.** Реєстр віддає код у своєму формуванні (подвійні лапки), у нас `singleQuote`, `semi`,
   `printWidth: 100`. Після кожного `add` — `pnpm prettier --write apps/platform-web/src/components/ui`.
   Це очікуваний шум у дифі, не сюрприз.
4. **Тулінг агента — уже стоїть** (2026-08-23): skill `shadcn` (`.agents/skills/shadcn`, симлінк у
   `.claude/skills/`, зафіксовано в `skills-lock.json`) і MCP-сервер `shadcn` у `.mcp.json`
   (`pnpm dlx shadcn@latest mcp`). Робочий цикл на кожен компонент:
   `npx shadcn@latest docs <c>` → прочитати доки/приклад → `add` → **прочитати доданий файл** →
   `npx shadcn@latest info --json` для аліасів/стилю/бази.

### 5.1 Init і тема

```bash
cd apps/platform-web
pnpm dlx shadcn@latest init --preset base-nova     # Base UI — дефолт; -b radix НЕ передавати
```

- Перевірити `components.json`: `base: "base"`, `style: "base-nova"`, `tailwindVersion: "v4"`,
  `framework` = vite, `aliases.ui = "@/components/ui"`, `iconLibrary` (§D2), `tailwindCssFile = "src/index.css"`.
- Додати реєстр `"@reui": "https://reui.io/r/{style}/{name}.json"` (§D3) — не використовуючи його зараз.
- `iconLibrary: "lucide"`; `pnpm add lucide-react` у `apps/platform-web` (§D2).
- Переконатися, що `@tailwindcss/vite` **один** (CLI не мусить додати другий Tailwind-плагін).
- `--radius: 0.5rem` (§4.2) + `--success`/`--warning` (§4.3).
- `main.tsx`: `attribute="class"`, оновити коментар (`data-theme` більше не потрібен).
- **Контрольна точка:** застосунок збирається і рендериться ще на HeroUI-компонентах, але з shadcn-темою —
  тут буде видно все, що поїхало по токенах.

### 5.2 Примітиви

```bash
pnpm dlx shadcn@latest add button card badge avatar dropdown-menu dialog alert-dialog \
  field label input input-group select checkbox table pagination spinner empty toast
```

Після кожного — прочитати файл, звірити з правилами скіла (композиція, `render` замість `asChild`, `data-icon`
на іконках, `cn()`), прогнати prettier і `typecheck`.

### 5.3 Свіп токенів (§4.3)

Одним заходом по всіх 13 файлах, до переписування компонентів: інакше кожен наступний крок валідується проти
поламаного візуалу.

### 5.4 Розрив залежності контракту від HeroUI

`types.ts` — власний `SortDescriptor` (§D5); `sort.ts` — імпорт з `./types`, прибрати `String(...)`.
`use-data-grid-filters.ts` — без змін. Тут `grep "@heroui" src/components/data-grid/{types,sort}.ts` уже пустий.

### 5.5 Компоненти — файл за файлом (typecheck після кожного)

1. `theme-switcher.tsx` — `DropdownMenu` + `DropdownMenuTrigger render={<Button size="icon" variant="ghost"/>}`;
   `onAction(key)` → `onClick` на трьох `DropdownMenuItem`; `SunIcon`/`MoonIcon` → `Sun`/`Moon` з lucide (§D2).
2. `toast-host.tsx` + `lib/error-toast.ts` — **разом** (один API). `<Toaster/>` + per-route класи позиції
   (`/login` → низ-центр, решта → верх-право; §3, позиція лише CSS). `error-toast.ts`:
   `toast.add({ type: 'error', title, description })`, дедуп 5 с лишається. Перевірити модульний
   `toastManager` (виклик іде з `main.tsx` поза React).
3. `form/form-text-field.tsx` → `Field` + `FieldLabel htmlFor` + `Input id` (`useId()`) + `FieldError`;
   `data-invalid` + `aria-invalid`. `form/form-password-field.tsx` → `InputGroup` + `InputGroupInput` +
   `InputGroupAddon` + іконка-кнопка (`Eye`/`EyeOff` з lucide замість власних SVG). `form/form-select.tsx` → §D4 (видалити або переписати з `items`).
4. `app-layout.tsx` — `Avatar`/`AvatarFallback` + `DropdownMenu`.
5. `create-tenant-modal.tsx` — `Dialog`; тригер `DialogTrigger render={<Button/>}` (зараз кнопка лежить
   прямим дитям `<Modal>`), `DialogTitle` обов'язковий, футер — `DialogClose render={<Button variant="outline"/>}`.
6. `pages/login.tsx`, `pages/tenants.tsx` — `Card`, `Table`, `Badge`, `AlertDialog`, `Button`, `Empty`, `Spinner`.
   `tenants.tsx` — перший «живий» приклад ручного порожнього стану (`TableRow`+`TableCell colSpan`).
7. `data-grid/filters.tsx` — `Input type="search"` з власним `aria-label` (обгортки `TextField` більше немає)
   - `Select` з `items` (сентинел `'all'` ↔ `undefined` лишається як є).
8. `data-grid/create-data-grid.tsx` — один `Button` у `SelectionSummary`.
9. `data-grid/data-grid.tsx` — найскладніший. Тут **видаляються ДВА костилі**, обидва спричинені React Aria:
   - **`SelectionCheckbox`** (прозорий нативний `<input>` поверх інертного HeroUI-чекбокса) → штатний
     `Checkbox` з `checked` / `onCheckedChange` / `indeterminate`.
   - **`createPortal` хедер-чекбокса в `thead th`** (+ `rootRef`, `selectAllCell`, `setTimeout(…, 0)`,
     `useEffect` на `items`) → **зникає повністю**: shadcn `Table` — звичайна розмітка, кешованої колекції
     колонок, через яку робився портал, більше немає. Це ~40 рядків мінус.
   - Сортування: `TableHead` + кнопка з `aria-sort` на `<th>` (RAC давав це задарма) → `grid.onSortChange`.
   - Порожній стан: `renderEmptyState` → рядок із `colSpan` + `Empty`.
   - Футер/пагінація: `Table.Footer` немає → власний `<div>` під таблицею; `Pagination` з кнопками (§3).
   - `PageSizeSelect` → `Select` з `items`.
   - Row actions: `DropdownMenu` (`onAction` → `onClick`, `isDisabled` → `disabled`, danger → `destructive`),
     `MoreIcon` → `MoreHorizontal` з lucide.
   - `AlertDialog` підтвердження: `AlertDialogCancel`/`AlertDialogAction`; `pendingAction` **не** скидати на
     закриття (той самий коментар про промигування лишається чинним).

### 5.6 Прибирання

- `package.json`: мінус `@heroui/react`, `@heroui/styles`; плюс те, що поставив CLI (`@base-ui/react`,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `lucide-react` — §D2).
- `pnpm install` → у `pnpm-lock.yaml` не лишається `@heroui`.
- Тулінг HeroUI, який більше не обслуговує platform-web: MCP `heroui-react` і skill `heroui-react`
  **лишаються** — вони обслуговують `apps/web`, який за D1 залишається на HeroUI.
- Документи: `CLAUDE.md` (блок `apps/platform-web` в «Архітектура», правило 12, таблиця «Зафіксовані
  рішення» — новий рядок про UI-стек platform-web і рішення D1/D2), `docs/frontend-ui-known-issues.md`
  (UI-1: зафіксувати, що в platform-web обхід знято міграцією, у `apps/web` — лишається).

---

## 6. Що не можна ламати (уточнений контракт)

- Публічні props `FormTextField`, `FormPasswordField`, `DataGrid`/`createDataGrid` (`Grid.Root`, `Grid.Filters`,
  `Grid.Table`, `Grid.SelectionSummary`, `Grid.filter.search/select`), `CreateTenantModal` — крім свідомо
  вилученого `variant` (§D4) і `FormSelect` (§D4).
- Інтеграція RHF через `useController` (`value/onChange/onBlur/ref` → нативний `Input`); `applyServerError`
  і `api-error.ts` — не UI-шар, без змін. **`defaultValues` мусять лишатися повними** (`applyServerError`
  звіряє `fieldErrors` з `getValues`).
- Хуки `useDataGridFilters` / `useDataGridSelection` / `data-grid-query.ts`: логіка (debounce пошуку, скидання
  `page`, скидання вибору при звужувальних фільтрах, затемнення по `isPlaceholderData`, а не `isFetching`) —
  без змін. `page-items.ts` — без змін.
- Boolean-фільтри в URL їдуть **рядком** `'true'/'false'`; `syncToUrl`, `validateSearch` роутів — без змін.
- Переклади: ключі з `src/locales/en/*.json` і `libs/i18n` — без змін; новий текст (напр. aria-label для
  сортування) — **новий ключ, не хардкод**.
- `next-themes` лишається механізмом теми (`storageKey: 'saas_platform_theme'`), змінюється лише `attribute`.

---

## 7. Критерії приймання

Автоматичні:

- `pnpm --filter @saas-skeleton/platform-web typecheck` і `build` — зелені.
- `pnpm lint` (корінь, `--max-warnings 0`) і `pnpm format:check` — зелені.
- `grep -rn "@heroui" apps/platform-web/src` — порожньо; `@heroui/*` немає ні в
  `apps/platform-web/package.json`, ні в `pnpm-lock.yaml` (для гілки D1(a) — тільки в `apps/web`).
- Grep мертвих токен-утиліт (§4.3) — порожньо.
- `grep -n "createPortal\|SelectionCheckbox\|inert" apps/platform-web/src/components/data-grid/data-grid.tsx`
  — порожньо (**обидва** костилі знято — головна ціль міграції).

Ручні (`pnpm --filter @saas-skeleton/platform-web dev`, :5174, оператор `platform@example.com`/`Platform12345`):

- світла/темна/системна тема перемикається; на `<html>` лишається лише `class` (жодного `data-theme`);
- `/login`: валідація zod, серверні помилки полів через `applyServerError`, toast **знизу по центру**;
- `/` Tenants: список, `New tenant` (створює tenant+admin), Suspend/Resume через `AlertDialog`, F5 не
  губить сесію, toast **у верхньому правому куті**;
- `/jobs`: сортування колонок (з `aria-sort`), пагінація, зміна `items per page`, фільтри queue/state у URL,
  автооновлення 5 с не блимає, **вибір рядків чекбоксом у шапці й у рядку працює з першого кліку**
  (у т.ч. indeterminate-стан і клавіатура — Space/Tab);
- dropdown акаунта і theme-switcher: Tab/Escape/стрілки, фокус повертається на тригер;
- вимкнути API (`api` не запущений) → глобальний toast про недоступність (перевіряє
  `error-toast.ts` поза React-деревом).

Візуально звірити з §4.2, а не з дефолтом shadcn «з коробки»: радіуси 12/8/6, видима рамка полів, чисте
focus-кільце. **Свідомо прийняті розбіжності зафіксувати списком** у підсумку (очікувані щонайменше:
відсутність `AlertDialog.Icon`, товщина focus-ring, дрібна типографіка `Badge` замість `Chip`).

---

## 8. Формат роботи

Порядок — строго §5.0 → 5.6, файл за файлом у §5.5. Після кожного файлу — `typecheck`; червоний тайпчек
блокує перехід до наступного. Перед кожним компонентом shadcn — `npx shadcn@latest docs <c>` і читання доків
(не по пам'яті). Після кожного `add` — прочитати доданий файл і прогнати prettier.

Наприкінці — повний прогін §7 і підсумок: що замінено на що, які файли зачеплені, які візуальні розбіжності
свідомо прийняті, що дописано в `CLAUDE.md` / `docs/frontend-ui-known-issues.md`.

---

## 9. Журнал виконання

### ✅ 5.0 Передумови конфігу + 5.1 Init і тема (2026-08-23)

Зроблено:

- `apps/platform-web/tsconfig.json`: `baseUrl: "."` + `paths: { "@/*": ["src/*"] }`;
  `vite.config.ts`: `resolve.alias['@']`. **Перевірено одразу**: `typecheck` і `build` зелені —
  тобто заміна успадкованих `paths` справді безпечна (`@saas-skeleton/*` іде через симлінки).
- `pnpm dlx shadcn@latest init --preset nova -b base --no-monorepo --yes`.
  **Правка плану:** у CLI 4.19.0 пресет зветься `nova`, а не `base-nova` (`base-nova` приймає лише
  `--defaults`); база передається окремо `-b base`. У `components.json` при цьому лягає
  `"style": "base-nova"`, `info --json` показує `base: "base"` — тобто мета плану досягнута.
- **Правка плану (§4.1):** `init` НЕ перезаписав `src/index.css`, а **дописав** свій блок у наявний.
  HeroUI-специфічні override'и (`--field-*`, `.checkbox`, `.card/.popover/.table-root--primary`,
  селектори `[data-theme=…]`) прибрані вручну за §4.2; `@import '@heroui/styles'` **свідомо лишився**
  до §5.6 — інакше немігровані компоненти лишились би без стилів.
- Тема: `--radius: 0.625rem → 0.5rem`. **Уточнення §4.2:** пресет рахує радіуси множниками
  (`sm .6 / md .8 / lg 1 / xl 1.4 / 2xl 1.8`), а не `calc(± px)`, тож маємо ≈4.8 / 6.4 / 8 / 11.2px —
  наміри (12/8/6) збігаються.
- Додано `--success`/`--warning` (+`-foreground`) у `:root`/`.dark` і мапінг у `@theme inline`.
  Перевірено прод-збіркою через тимчасовий probe-файл: `.bg-success{background-color:var(--success)}`,
  `.text-warning-foreground{color:var(--warning-foreground)}` — токени доїжджають до утиліт.
- `components.json`: додано реєстр `@reui` (не використовується, §D3). `iconLibrary: "lucide"`,
  `lucide-react` встановлено CLI.
- `main.tsx`: `attribute={['class','data-theme']}` → `attribute="class"`, коментар оновлено.
- `@tailwindcss/vite` лишився один; `src/lib/utils.ts` (`cn`) — прогнаний prettier.

**Грабля, якої в плані не було: `shadcn` як npm-залежність ламає zod у ВСЬОМУ монорепо.**
CLI додає в `dependencies` пакет `shadcn` (він потрібен насправді — з нього йде
`@import 'shadcn/tailwind.css'`, 629 рядків custom-variant'ів пресета). Той тягне за собою
`zod@3.25.76` (через власні deps і `@modelcontextprotocol/sdk`), а `.npmrc` у нас —
`shamefully-hoist=true`, тож у кореневий `node_modules/zod` піднявся **zod 3**.
`@hookform/resolvers` оголошує `zod` ОПЦІОНАЛЬНИМ peer-ом, тому pnpm не лінкує його локально —
резолвер підхопив хойстнутий zod 3 і `zodResolver(schema)` перестав типізуватись **і в
`platform-web`, і в `apps/web`** (TS2769, `_zod.version.minor: 4 не assignable до 0`).
Фікс: `pnpm.overrides: { "zod": "^4.4.3" }` у кореневому `package.json` — у дереві лишається один
zod, корінь знову хойстить v4. Безпечно: увесь zod@3-підграф — це нутрощі пакета `shadcn`, який ми
ніколи не виконуємо (CLI ходить через `npx shadcn@latest`, MCP — через `pnpm dlx`).

Ще два спостереження про lockfile:

- `pnpm-lock.yaml` у репо тримається **відформатованим prettier'ом**; будь-який `pnpm install`
  переписує його у власний компактний формат і дає диф на ~6000 рядків. Після install —
  `pnpm exec prettier --write pnpm-lock.yaml`, і диф стискається до реальних змін.
- `tailwind-merge` піднявся 3.4.0 → 3.6.0 (peer HeroUI-стилів переїхав разом).

Стан перевірок після кроку: `pnpm typecheck` (8/8), `pnpm lint` (--max-warnings 0), збірка
`platform-web` — зелені. `pnpm format:check` червоний **до цієї роботи** (89 файлів, зокрема
`libs/shared/**`, яких ми не торкались) — перевірено на версії файлів із HEAD; масове
переформатування свідомо не робимо, щоб не ховати диф міграції.

§5.0.2 (ESLint-override для `src/components/ui/**`) поки **не знадобився**: `lib/utils.ts` без явного
типу повернення проходить, бо `explicit-*-return-type` для `apps/platform-web/**` уже вимкнено.
Повернутись до питання після першого `add` примітивів (§5.2).

**Контрольна точка §5.1 у браузері не пройдена**: розширення Claude-in-Chrome не підключене.
Перевірено непрямо — dev-сервер віддає скомпільований CSS (200, 427 KB), прод-збірка зелена.
Візуальний огляд `/login` і `/` під обома темами лишається за користувачем.

### ✅ 5.2 Примітиви (2026-08-23)

`npx shadcn@latest add button card badge avatar dropdown-menu dialog alert-dialog field label input
input-group select checkbox table pagination spinner empty toast` — **20 файлів** у
`src/components/ui/`: 18 замовлених плюс `separator.tsx` і `textarea.tsx`, які приїхали залежностями
`field`/`input-group`. `pnpm-lock.yaml` і `package.json` **не змінились** (усі рантайм-залежності —
`@base-ui/react`, `lucide-react`, `cva`, `clsx`, `tailwind-merge` — стали ще на `init`), `index.css`
CLI не чіпав.

- Prettier по `src/components/ui` — прогнаний (очікуваний шум: подвійні лапки → одинарні).
- **§5.0.2 закрито емпірично:** з усього вендореного коду стрельнули рівно два правила, обидва в
  `field.tsx` — `@typescript-eslint/array-type` (`Array<{message?: string}>` у пропі) і
  `@typescript-eslint/no-unnecessary-condition` (`uniqueErrors?.length` на завжди-визначеному масиві).
  Обидва — стилістика апстріму, не баги. У `eslint.config.mjs` доданий блок-override на
  `apps/platform-web/src/components/ui/**` рівно з цими двома `off` (файли НЕ в `ignores`).
- **Badge отримав варіанти `success`/`warning`** (§4.3) — «мʼяка» заливка тією ж формою, що
  стоковий `destructive` (`bg-*/10 text-* dark:bg-*/20`), щоб `add --diff` читав це як локальну вставку.
- **Токени `--success`/`--warning` перезважені під цю форму badge-а:** попередні значення з §5.1
  давали нечитний текст (світлий бурштин на світлому тлі). Тепер light — green-700 / amber-700
  (`oklch(0.527 0.154 150.069)` / `oklch(0.555 0.163 48.998)`), dark — green-400 / amber-400.

Що з'ясувалося з читання доданих файлів (впливає на §5.5, вирішувати на місці):

| Файл             | Факт                                                                                                                                                                                                       | Наслідок                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `toast.tsx`      | `toast` — менеджер рівня модуля (`createToastManager()`), тож виклик із `error-toast.ts` поза React працює. Але `Toaster` віддає props у `Provider`, а не у `Viewport`, і `ToastList` **не експортований** | Позиція per-route (§5.5.2) вимагає або пропа `viewportClassName` на `Toaster`, або експорту `ToastList` — локальна правка вендореного файла   |
| `table.tsx`      | `TableFooter` (`<tfoot>`) **є** (план казав «немає»)                                                                                                                                                       | Для футера пагінації він усе одно не підходить (пагінація поза `<table>`) — план по суті лишається чинним                                     |
| `pagination.tsx` | `PaginationLink` жорстко рендерить `<a>` (`nativeButton={false}`)                                                                                                                                          | Наш грід гортає обробником, не посиланням → беремо `Pagination`+`Content`+`Item` і кладемо всередину звичайний `Button` (легальна композиція) |
| `checkbox.tsx`   | `Indicator` містить лише `CheckIcon`                                                                                                                                                                       | Для indeterminate у шапці гріда (§5.5.9) треба домалювати `MinusIcon` за станом                                                               |
| `button.tsx`     | `destructive` — **мʼякий** (`bg-destructive/10 text-destructive`), не суцільно-червоний; є розміри `xs/sm/default/lg` та `icon-xs/icon-sm/icon/icon-lg`                                                    | `AlertDialogAction` на Suspend/Delete виглядатиме інакше, ніж суцільна danger-кнопка HeroUI → у список свідомих розбіжностей (§7)             |
| `field.tsx`      | `Field` реагує на `data-invalid="true"`, `FieldError` приймає або `children`, або проп `errors`                                                                                                            | Контракт `FormTextField` лягає без сюрпризів                                                                                                  |

Перевірки після кроку: `typecheck`, `lint --max-warnings 0`, `prettier --check` по зачепленому,
`build` — зелені. Компоненти поки нікуди не імпортуються (у бандл не входять) — це наступні кроки.

### ✅ 5.3 Свіп токенів (2026-08-23)

Свіп зроблено одним заходом до переписування компонентів, як вимагає план. Замість того щоб довіритись
списку з §4.3, перелік HeroUI-only токенів **вирахувано з самої бібліотеки**: усі `--color-*` із
`@heroui/styles/dist` мінус `--color-*` нашої shadcn-теми = 73 імені, і по них — grep розмітки з
префіксами `bg|text|border|ring|outline|divide|fill|stroke|shadow|from|to|via`. Той самий прийом
повторено для некольорових токенів (`--shadow/--text/--radius/--font/--spacing/--ease/--animate`).
Результат: **нічого поза мапою §4.3 не знайшлось** — мапа була повна.

Застосовано (7 файлів): `text-muted` → `text-muted-foreground` (×8), `text-danger` →
`text-destructive` (×4), `hover:bg-background-secondary` → `hover:bg-accent`,
`bg-accent-soft text-accent-soft-foreground` → `bg-accent text-accent-foreground`,
`text-accent` (бренд) → `text-primary`.

Два рішення на місці:

- **`bg-surface` розійшовся на два різні токени.** Сайдбар → `bg-sidebar` (пресет дає `sidebar-*`,
  у світлій темі це трохи сіріше за фон — саме той ефект, що давав HeroUI `surface`). Хедер →
  `bg-background`, а **не** `bg-card`: у світлій темі `--card` дорівнює `--background`
  (`oklch(1 0 0)`), тож `bg-card` не дав би жодного контрасту — відділяє хедер `border-b`.
- **`outline-accent` у `data-grid.tsx:75` свідомо НЕ чіпали** — це focus-ring костиля
  `SelectionCheckbox`, який цілком зникає у §5.5.9 разом із класом.

`text-warning` лишився як є — токен тепер наш (§5.2).

Перевірено на збірці, що свіп переживе зняття HeroUI: у зібраному CSS
`.bg-sidebar{background-color:var(--sidebar)}`, `.text-muted-foreground{color:var(--muted-foreground)}`,
`.text-destructive{color:var(--destructive)}`, `.text-warning{color:var(--warning)}` — усі посилаються
на змінні нашої теми, жодна не на HeroUI-івські.

Побічне: `prettier --write` по `apps/platform-web/src` переформатував і файли, яких свіп не стосувався
(репо має ~89 нечистих файлів **до** цієї роботи). Такі файли повернуто через `git checkout` — зокрема
`api-error.ts` і `use-data-grid-filters.ts`, які за §6 мусять лишитись побайтово незмінними. У
зачеплених свіпом файлах переформатування лишили: вони й так у зоні міграції, а §7 усе одно вимагає
зелений `format:check`.

Перевірки: `typecheck`, `lint --max-warnings 0`, `build` — зелені.

### ✅ 5.4 Розрив залежності контракту від HeroUI (2026-08-23)

- `types.ts`: власний `export interface SortDescriptor { column: string; direction: 'ascending' | 'descending' }`
  (§D5), імпорт із бібліотеки прибрано. Форма `DataGridNavigation` не змінилась.
- `sort.ts`: імпорт із `./types`, каст `String(descriptor.column)` **зник** — `column` тепер `string`,
  а не React-Aria-івський `Key`.
- `index.ts`: `SortDescriptor` доданий у реекспорти типів — раніше споживач брав його з UI-бібліотеки,
  тепер тільки з барелю гріда (розширення контракту, нічого не ламає).
- `use-data-grid-filters.ts`: логіка **недоторкана** (§6), виправлено лише коментар, який називав
  `SortDescriptor` типом HeroUI, + prettier (одне перенесення дженерика).

**Знайдено те, чого план не передбачав:** після зміни типу `typecheck` червонів у `data-grid.tsx` —
HeroUI-`Table.Content` віддає в `onSortChange` React-Aria-івський дескриптор, де `column: Key`
(`string | number`), і він більше не підходить під наш `string`. Оскільки §5.5.9 (перепис `data-grid.tsx`)
ще попереду, а правило «після кожного кроку зелений тайпчек» діє, у `data-grid.tsx` вставлений
**тимчасовий місток** — інлайн-обгортка `onSortChange`, що робить `String(descriptor.column)`.
Помічений коментарем «зникає у §5.5.9 разом із HeroUI-таблицею»: каст не переїхав у контракт, він
локальний і одноразовий.

Перевірки: `typecheck`, `lint`, `build`, `prettier --check` по зачеплених файлах — зелені.
`grep "@heroui"` по `types.ts`/`sort.ts`/`index.ts`/`use-data-grid-filters.ts` — порожньо
(лишились очікувані три файли: `data-grid.tsx`, `filters.tsx`, `create-data-grid.tsx` — це §5.5).

### ✅ 5.5 Компоненти, файл за файлом (2026-08-23)

Порядок і межі — за планом; після кожного файла `typecheck`. Наприкінці кроку
`grep -rn "@heroui" apps/platform-web/src --include='*.ts*'` — **порожньо** (лишився тільки
`@import '@heroui/styles'` в `index.css` і дві залежності в `package.json` — це §5.6).

1. **`theme-switcher.tsx`** — `DropdownMenu` + `DropdownMenuTrigger render={<Button size="icon-sm"
variant="ghost"/>}`, `onAction(key)` → три `onClick`, власні SVG → `Sun`/`Moon` (lucide).
   Пункти обгорнуті в `DropdownMenuGroup` (правило композиції скіла).
2. **`toast-host.tsx` + `lib/error-toast.ts`** — `<Toaster position=…/>`, `toast.danger(...)` →
   `toast.add({ type: 'error', title, description })`; дедуп 5 с і виклик поза React-деревом — без змін
   (менеджер `toast` у реєстрі оголошений на рівні модуля, саме те, що треба `main.tsx`).
   **Рішення користувача 2026-08-23:** верхній правий кут для адмінки лишається, як у плані. Base UI
   стакає тости від НИЖНЬОГО краю viewport-а, тому у вендорений `ui/toast.tsx` внесена **локальна
   правка** за офіційним рецептом Base UI: `Toaster`/`ToastViewport` отримали проп
   `position: 'top-right' | 'bottom-right' | 'bottom-center'`, а `Toast` — `anchor: 'top' | 'bottom'`,
   який дзеркалить `origin`, `--offset-y`, transform стеку, `::after`-проміжок і
   starting/ending-трансформи та вмикає `swipeDirection="up"`. Класи винесені у дві константи
   (`toastViewportPositionClasses`, `toastAnchorClasses`), щоб `add --diff` лишався читабельним.
   ⚠️ Анімацію верхнього стеку **перевірити в браузері** — без нього коректність рецепта не доведена.
3. **Форми** — `FormTextField` і `FormPasswordField` переписані на `Field`+`FieldLabel htmlFor`+
   `Input id` (`useId()`)+`FieldError`, стан помилки через `data-invalid` на `Field` і `aria-invalid`
   на контролі; пароль — `InputGroup`+`InputGroupInput`+`InputGroupAddon align="inline-end"`+
   `InputGroupButton` з `Eye`/`EyeOff`. Проп `variant` **видалено** (§D4, жоден викликач не передавав),
   `form-select.tsx` **видалено** разом з експортом. **Розширення контракту:** доданий опційний проп
   `description` → `FieldDescription` усередині `Field` — інакше підказки (`slugHint`,
   `adminPasswordHint`) лишились би `<p>`-сиротами поруч із полем.
4. **`app-layout.tsx`** — `Avatar`+`AvatarFallback`, акаунт-меню на `DropdownMenu`; тригер —
   `render={<Button variant="ghost" className="h-9 rounded-full"/>}`.
5. **`create-tenant-modal.tsx`** — `Dialog`; тригер тепер справжній `DialogTrigger render={<Button/>}`
   (раніше кнопка лежала прямим дитям `<Modal>`), `DialogTitle` обовʼязковий, футер —
   `DialogClose render={<Button variant="outline"/>}`. Розмітку форми піднято до
   `FieldGroup` + `FieldSet`/`FieldLegend` замість `div`-ів із `mt-*`/`border-t`.
6. **`pages/login.tsx`** — `Card`+`CardHeader`/`CardTitle`/`CardContent`, `FieldGroup`,
   `fullWidth` → `className="w-full"`. **`pages/tenants.tsx`** — `Table`-розмітка з ручним порожнім
   станом (`TableRow`+`TableCell colSpan`+`Empty`), `Chip` → `Badge variant="success|destructive"`,
   `AlertDialog` на `AlertDialogContent/Header/Media/Title/Description/Footer/Cancel/Action`.
   **`pages/jobs.tsx`** (у §5.5 не був названий, але в інвентарі §2 є) — `Card`+`CardContent`,
   `Chip color` → `Badge variant`; нейтральні стани job-а (`created`/`cancelled`) стали `secondary`,
   бо `default` у badge — суцільна заливка primary.
7. **`data-grid/filters.tsx`** — пошук: `Input type="search"` із власним `aria-label` (обгортки
   `TextField` більше немає); селект: Base UI `Select` з обовʼязковим `items` на корені, сентинел
   `'all'` ↔ `undefined` лишився. Грабля: `onValueChange` типізований як `(value: string | null)` —
   `null` у Base UI означає placeholder-значення, у нас його немає, але сигнатуру треба прийняти.
8. **`data-grid/create-data-grid.tsx`** — один `Button` (`onPress` → `onClick`).
9. **`data-grid/data-grid.tsx`** — переписаний повністю. **Обидва костилі знято** (головна ціль
   міграції): `grep -n "createPortal\|SelectionCheckbox\|inert"` — порожньо. Замість прозорого
   нативного `<input>` поверх інертного чекбокса — штатний `Checkbox` з
   `checked`/`onCheckedChange`/`indeterminate`; портал хедер-чекбокса в `thead th` разом із
   `rootRef`/`selectAllCell`/`setTimeout`/`useEffect` **зник** (кешованої колекції колонок більше
   немає). Сортування — кнопка в `TableHead` + `aria-sort` на `<th>` (RAC давав це задарма) з тим
   самим циклом asc→desc; іконки `ChevronsUpDown`/`ArrowUp`/`ArrowDown`. Порожній стан — рядок із
   `colSpan` + `Empty`. Футер — власний `<div>` під таблицею (пагінація структурно поза `<table>`);
   `PaginationLink` реєстру жорстко рендерить `<a>`, тому всередині `Pagination`/`PaginationContent`/
   `PaginationItem` стоять звичайні `Button` з обробниками. Row actions — `DropdownMenu`
   (`onAction` → `onClick`, `isDisabled` → `disabled`, danger → `variant="destructive"`),
   `MoreIcon` → `MoreHorizontal`. Тимчасовий місток сортування з §5.4 видалений разом із файлом.
   Файл став **на ~90 рядків коротшим**.

Дві локальні правки вендореного коду (обидві помічені коментарем «ЛОКАЛЬНА ПРАВКА реєстру»):

- `ui/toast.tsx` — позиціювання (див. п. 2);
- `ui/checkbox.tsx` — індикатор малює `MinusIcon` у стані `indeterminate` (реєстр знає лише
  «галочку», а Base UI показує індикатор і для indeterminate — у шапці гріда це має бути риска).

Нові ключі i18n (замість хардкоду, §6): `common.pagination.previous` / `common.pagination.next` —
aria-label кнопок гортання, які раніше давав HeroUI сам. Ключі додані у спільний `libs/i18n`
(для `apps/web` вони просто невживані).

Перевірки після кроку: `typecheck`, `lint --max-warnings 0`, `build` — зелені; `prettier --check`
по `apps/platform-web/src` чистий, окрім двох файлів, яких міграція не торкалась
(`api-error.ts`, `i18n/index.ts` — нечисті ще до роботи).

**Не перевірено в браузері** (розширення Claude-in-Chrome не підключене): анімація/позиція тостів,
indeterminate-чекбокс, сортування з клавіатури, фокус-менеджмент дропдаунів і діалогів.

### ✅ 5.6 Прибирання (2026-08-23)

- `apps/platform-web/package.json`: `@heroui/react` і `@heroui/styles` **видалені**;
  лишилось те, що поставив CLI (`@base-ui/react`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `tw-animate-css`, `lucide-react`, `shadcn`, `@fontsource-variable/geist`).
- `src/index.css`: знято тимчасовий `@import '@heroui/styles'` (стояв із §5.1).
- `pnpm install` → у `pnpm-lock.yaml` `@heroui/*` лишився **тільки в імпортері `apps/web`**
  (гілка D1(a) плану). Лок після install прогнаний prettier (див. §5.1 про формат лок-файла).
- Тулінг HeroUI (MCP `heroui-react`, skill `heroui-react`) **лишається** — він обслуговує
  `apps/web`, який за D1 на HeroUI і залишається.
- `CLAUDE.md`: (1) блок `apps/platform-web` в «Архітектурі» — новий UI-стек; (2) правило 12
  переписане у «дві UI-бібліотеки, по одній на застосунок» з окремими абзацами під HeroUI
  (`apps/web`) і shadcn (`apps/platform-web`), включно з вимогою позначати правки вендореного
  коду коментарем «ЛОКАЛЬНА ПРАВКА реєстру»; (3) новий рядок «UI-бібліотека» в таблиці
  зафіксованих рішень (D1/D2/D3 + застереження, що файли гріда/форм розійшлися і не
  back-portable); (4) `docs/migrate.md` доданий у список документів.
- `docs/frontend-ui-known-issues.md`: врізка вгорі + статус UI-1 — «відкрита для `apps/web`,
  закрита для `apps/platform-web` (застосунок пішов із HeroUI, а не баг полагоджено)»;
  у варіанті D зафіксовано, що пілот і був способом зміряти його вартість.

**Ефект на бандл** (`vite build`, до → після зняття HeroUI): CSS **410.4 KB → 77.5 KB**
(−81%), JS **1077.0 KB → 937.2 KB** (−13%).

Стан §7 (автоматична частина):

| Критерій                                                   | Стан                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` + `build` platform-web                         | ✅                                                                                                                                                                                                                            |
| `pnpm lint --max-warnings 0` (корінь)                      | ✅                                                                                                                                                                                                                            |
| `grep -rn "@heroui" apps/platform-web/src`                 | ✅ порожньо                                                                                                                                                                                                                   |
| `@heroui/*` у `package.json` / `pnpm-lock.yaml`            | ✅ лише `apps/web`                                                                                                                                                                                                            |
| Мертві токен-утиліти (§4.3)                                | ✅ порожньо                                                                                                                                                                                                                   |
| `createPortal\|SelectionCheckbox\|inert` у `data-grid.tsx` | ✅ порожньо — **обидва костилі знято**                                                                                                                                                                                        |
| `pnpm format:check`                                        | ❌ 79 файлів, **усі поза міграцією** (було 89 до роботи). Два з них у platform-web — `api-error.ts` і `i18n/index.ts`, яких §6 велить не чіпати. Репозиторний `pnpm format` — окреме рішення користувача, не частина міграції |

Ручна частина §7 — за користувачем; сервіси підняті (5174/3002/3001/5173 + docker).

### ✅ 7. Приймання (2026-08-23)

Ручну частину §7 виконано **не «на око», а автоматизовано**: розширення Claude-in-Chrome так і не
підключилось, тож перевірка зроблена headless-Chromium через Playwright (1.60.0, у скретчпаді сесії —
у репозиторій нічого не додано) проти живого стенду (docker + api + platform-api + worker + обидва
фронти). Кожен критерій перевірявся **вимірюванням у DOM**, а не лише скріншотом.

Автоматичні критерії:

| Критерій                                                   | Результат                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `typecheck` (8 таргетів) + `build` platform-web            | ✅                                                                                         |
| `pnpm lint --max-warnings 0`                               | ✅                                                                                         |
| `grep -rn "@heroui" apps/platform-web/src`                 | ✅ 0                                                                                       |
| `@heroui/*` у `package.json` / `pnpm-lock.yaml`            | ✅ лише `apps/web`                                                                         |
| Мертві токен-утиліти §4.3                                  | ✅ 0 (два збіги — `bg-black/10` у вендорених оверлеях, стоковий Tailwind, не токен HeroUI) |
| `createPortal\|SelectionCheckbox\|inert` у `data-grid.tsx` | ✅ 0                                                                                       |
| `pnpm format:check`                                        | ❌ 79 файлів, усі поза міграцією (до роботи — 89)                                          |

Ручні критерії (виміряно в браузері):

| Критерій                             | Результат                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Тема світла/темна/системна           | ✅ `class="light"` / `class="dark"`; **`data-theme` немає**; `prefers-color-scheme: dark` дає темну без вибору                                                               |
| `/login`: zod-валідація              | ✅ 2 помилки полів, `Field[data-invalid=true]` ×2, `aria-invalid` ×2                                                                                                         |
| `/login`: серверна помилка           | ✅ 401 → `root.server` («Invalid email or password») у формі, не тостом                                                                                                      |
| `/login`: перемикач пароля           | ✅ `type` password→text, `aria-label` Show→Hide                                                                                                                              |
| `/login`: toast знизу по центру      | ✅ виміряно: x-центр 720/720, низ 900−884                                                                                                                                    |
| `/`: список, Suspend/Resume          | ✅ 2 тенанти; **живий цикл** Suspend → бейдж `Suspended` → Resume → `Active`                                                                                                 |
| `/`: New tenant                      | ✅ `DialogTitle` на місці, порожній сабміт дає 4 помилки полів, Cancel закриває                                                                                              |
| `/`: F5 не губить сесію              | ✅                                                                                                                                                                           |
| Тости адмінки — верхній правий кут   | ✅ виміряно: y=16, права межа 1424/1440. **Стек із 2 тостів росте ВНИЗ** (y=16 і y=38), нічого не за екраном — дзеркалений рецепт Base UI коректний                          |
| Глобальний toast поза React-деревом  | ✅ 500 → «Service unavailable», обрив мережі → «Connection problem» (гілка `status === null`)                                                                                |
| `/jobs`: сортування                  | ✅ `?sortBy=name&sortOrder=asc` → `desc`; `aria-sort` на `<th>` перемикається `none`/`ascending`/`descending`                                                                |
| `/jobs`: фільтри в URL               | ✅ `state=completed` у query, список перезапитується                                                                                                                         |
| `/jobs`: пагінація й items per page  | ✅ `limit=10` в URL; Next вимкнена на одній сторінці; автооновлення 5 с не блимає (затемнення по `isPlaceholderData`)                                                        |
| **Чекбокси гріда — з першого кліку** | ✅ клік по рядку → `aria-checked=true` + «1 selected»; шапка → `aria-checked="mixed"` (indeterminate, малюється риска); клік по шапці → 3/3; `Space` перемикає; Clear скидає |
| Дропдауни: клавіатура й фокус        | ✅ Escape закриває, фокус повертається на тригер (`aria-label="Switch theme"`)                                                                                               |
| Консоль без помилок                  | ✅ на `/`, `/jobs`, `/login` — жодної (крім навмисно змодельованих 500/abort)                                                                                                |

**Як перевірявся вибір рядків.** У platform-web `Grid.Root` **ніде не вмикає `selection`** — єдина
сторінка з грідом (`/jobs`) його не просить, тобто головна ціль міграції (штатний чекбокс замість
костиля) не мала живого споживача. Для приймання `selection` і `Grid.SelectionSummary` були **тимчасово**
ввімкнені на `/jobs`, перевірені й **відкочені** (у комітах правки немає). Це варто знати наперед:
код вибору рядків у platform-web зараз лежить неспожитим — перший реальний споживач з'явиться з
доменними сторінками.

Свідомо прийняті візуальні розбіжності (зафіксовано, як вимагає §7):

1. **`AlertDialog.Icon` не втрачений** — у shadcn є `AlertDialogMedia`, у нього покладено `TriangleAlert`
   (danger) / `CircleCheck`|`CircleHelp` (нейтральний). Тобто пункт плану «очікувана відсутність іконки»
   не справдився — іконка є.
2. **Кнопка підтвердження — мʼяка, а не суцільна.** `Button variant="destructive"` у base-nova це
   `bg-destructive/10 text-destructive`, а не суцільний червоний, як `Button variant="danger"` HeroUI.
3. **`Badge` замість `Chip`** — дрібніша типографіка (h-5, text-xs) і мʼяка заливка для success/warning.
4. **Focus-ring 3px** (`ring-[3px] ring-ring/50`) замість 2px, які спеціально налаштовувались під HeroUI.
5. **Підпис поля червоніє разом із помилкою** — `Field[data-invalid=true]` фарбує весь блок, включно з
   `FieldLabel`; у HeroUI червонів лише текст помилки.
6. **Шрифт Geist** — приїхав із пресетом `base-nova` (`@fontsource-variable/geist`), типографіка змінилась.
7. **Радіуси ≈11/8/6px** замість рівних 12/8/6 — пресет рахує їх множниками від `--radius: 0.5rem`.
8. **Хедер без власного тла** — `bg-background` + `border-b` (у світлій темі `--card` дорівнює
   `--background`, тож `bg-card` не дав би контрасту); сайдбар — `bg-sidebar`, як і був відчутно світліший.
9. **Тост верхнього кута перекриває смугу хедера** (y=16) — поведінка та сама, що була в HeroUI `top end`.

Дрібна правка, знайдена оглядом: пункт «Log out» використовував `className="text-destructive"` —
замінено на штатний `variant="destructive"` (дає ще й hover/focus-стан).

Що НЕ перевірено автоматикою і лишається за людиною: субʼєктивна оцінка типографіки/щільності,
поведінка на вузьких екранах, робота з реальним скрінрідером.
