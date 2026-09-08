# UI-стек фронтендів

Довідник поточного стану. Відповідає на питання «як у нас зроблений UI і за якими правилами
його продовжувати». Звідки брати новий компонент — `ui-registry.md`; як ми до цього стану
дійшли — `ui-migration-history.md`.

Стан на 2026-08-26. Обидва фронти (`apps/web`, `apps/platform-web`) на одному стеку;
спільний код — у `libs/ui`.

---

## 1. Стек

| Шар       | Рішення                                                       |
| --------- | ------------------------------------------------------------- |
| Примітиви | **shadcn/ui на Base UI**, стиль `base-nova`, CLI 4.19.0       |
| CSS       | Tailwind CSS 4 (`@theme inline`, `@custom-variant dark`)      |
| Іконки    | `lucide-react`, per-icon імпорти                              |
| Тема      | `next-themes`, атрибут **лише `class`**                       |
| Каркас    | React 19 + Vite 7, TanStack Router + Query v5, Zustand        |
| Форми     | react-hook-form + `zodResolver` + власні обгортки (`libs/ui`) |
| i18n      | react-i18next поверх дефолтного синглтона `i18next`           |
| Шрифт     | Inter (`@fontsource-variable/inter`)                          |

Примітиви **вендоряться** (код лежить у репо, не в `node_modules`) — це модель shadcn, а не
обхід. Оновлення — `shadcn diff <name>` у теці пакета.

---

## 2. `libs/ui` — спільний шар обох фронтів

Source-only workspace-пакет `@saas-skeleton/ui` (той самий тип, що `libs/i18n` і
`libs/contracts`: без білда, консюмер компілює джерела). Резолюція — через `exports`-мапу
`package.json`, тому окремих `paths` у застосунку не потрібно.

### Що в пакеті

```
libs/ui/src/
  styles.css                  ЄДИНА тема обох фронтів (:root/.dark, @theme inline, @layer base)
  components/ui/**            вендорені примітиви реєстру (33)
  components/data-grid/**     грід (generic по TFilters/TItem)
  components/form/**          FormTextField/FormPasswordField/FormSelect + server-error
  components/page-header-slot.tsx   портал у хедер layout-а
  components/page-breadcrumbs.tsx   крихти через цей портал
  components/theme-switcher.tsx
  components/user-identity.tsx
  api/api-error.ts            нормалізація конверта ApiError
  lib/{utils,page-items,format,error-toast}.ts
  hooks/use-mobile.ts
  components.json             конфіг shadcn CLI пакета
```

### Що лишається в застосунку

Тільки те, що справді різне: `app-layout` (навігація й бренд), `toast-host` (у web два регіони
тостів, у platform-web один), `api/http-client`, `i18n/index`, `lib/init-auth`, стори, роутер і
весь домен. Плюс `FormPhoneField` + `phone/**` — він generic, але тягне `libphonenumber-js` і
`country-flag-icons`, які потрібні лише `apps/web` (див. відкриті питання в `README.md`).

### Правило i18n у пакеті

Пакет імпортує **`import i18n from 'i18next'`** — дефолтний синглтон, який конфігурує кожен
фронт (`i18n.use(initReactI18next).init(…)`, не `createInstance`). Тому пакет не знає про
неймспейси застосунку, а спільні ключі приходять із `libs/i18n`.

### Підключення в застосунку

`index.css` застосунку зводиться до трьох рядків:

```css
@import 'tailwindcss';
@import '@saas-skeleton/ui/styles.css';
@source '../../../libs/ui/src';
```

Без `@source` Tailwind **не бачить класи пакета** — утиліти просто не генеруються.

Аліас `@/*` (локальний код застосунку) дублюється у `tsconfig.json` **і** `vite.config.ts` —
vite не читає tsconfig paths.

### Імпорти всередині пакета

Конвенція — **самопосилання** `@saas-skeleton/ui/…` (документований монорепо-режим shadcn:
`aliases.ui` у `components.json` вказує на workspace-пакет, і CLI сам переписує імпорти в
доданих файлах). Зараз так зроблено в 41 файлі; три файли, що переїхали останнім ходом
(`page-breadcrumbs.tsx`, `lib/error-toast.ts`, `lib/format.ts`), використовують відносні
шляхи — розбіжність відома, див. відкриті питання.

---

## 3. Тема

Одна на обидва фронти — `libs/ui/src/styles.css`. Палітра перенесена з
[HeroUI v3](https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css)
у семантичну структуру shadcn. Ми не підключаємо HeroUI і не копіюємо його компонентні
рецепти: беремо лише модель canvas → surface → overlay, zinc-нейтралі, слабкі межі та
багатошарові тіні. У `components.json` лишається `baseColor: "neutral"`: це метадані
генератора, а не назва runtime-теми; фактичну палітру задають CSS-токени.

| Параметр    | Значення                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Нейтралі    | zinc, hue ≈ 286, chroma 0…0.014 — майже ахроматичні, без синьої «сталі»                           |
| Світла тема | canvas `oklch(0.9702 0 0)`; card/popover/fields білі; поля мають мʼяку тінь і видиму zinc-обводку |
| Темна тема  | сирий чорний canvas `oklch(0.12 0.005 285.823)`; card/popover `oklch(0.2103 0.0059 285.89)`       |
| `--radius`  | `0.625rem`                                                                                        |
| Тіні        | HeroUI-подібні: слабка `surface` для полів/панелей, глибша `overlay`; у dark без зовнішнього glow |
| Шрифт       | Inter (`@fontsource-variable/inter`)                                                              |
| Перемикач   | `attribute="class"`; storageKey `saas_theme` / `saas_platform_theme`                              |

### Три свідомі відхилення від стоку

Зафіксовані рішенням користувача — **не переглядати без запиту**:

1. **`--primary` (і `--ring`) — точний accent HeroUI v3.** В обох темах
   `oklch(0.6204 0.195 253.83)` із `oklch(0.9911 0 0)` foreground. Destructive також бере
   точні HeroUI danger-пари: `oklch(0.6532 0.2328 25.74)` у light і
   `oklch(0.594 0.1967 24.63)` у dark. Hover обчислюється так само, як у HeroUI:
   90% semantic color + 10% його foreground. Фокус синій, бо `--ring` = `--primary`.
2. **Метрика однорядкових контролів — 36px.** `default` кнопка, `input`, `select` та
   `input-group` мають 36px; кнопки `sm` 32, `xs` 28, `lg` 40, іконкові — `size-7/8/9/10`.
   `textarea` багаторядкова і лишається `min-h-16`. Горизонтальні відступи полів — `px-3`.
   Фокус form controls — суцільний `ring-1` кольору `--ring` без відступу; error-state
   лишається помітнішим `ring-2`. Кнопки й навігаційні примітиви зберігають `ring-2`.
3. **Опційна повна округлість кнопок.** `Button radius="full"` дає pill-форму текстовій
   кнопці, а разом із `size="icon*"` — геометрично круглу icon-only кнопку. Дефолт
   `radius="default"` зберігає стандартний `rounded-lg` / `rounded-md` і сумісність усіх
   наявних викликів.

Саме ці три відхилення — причина, чому `button`/`input`/`select`/`input-group` лишаються
з коментарем «ЛОКАЛЬНА ПРАВКА реєстру». **Нову висоту не задавати класом на місці
використання** — вона дефолтна. Для компактних toolbar-ів `Input`, `SelectTrigger` і `Button`
мають opt-in `size="sm"` (32px); звичайні поля форм лишаються 36px.

`--success` / `--warning` (+`-foreground`) — **наше розширення**: у shadcn таких ролей немає.
Це нейтрально сумісні emerald/amber; lightness скоригований так, щоб дрібний текст у мʼяких
`bg-*/10` badge мав контраст не нижче 4.5:1. Варіанти — у cva `ui/badge.tsx`.
`--destructive-foreground` доповнює суцільну semantic pair і має різне значення в light/dark.

### Межа між темою і компонентом

- **У темі:** семантичні кольори та їхні `*-foreground` пари, шрифт, базовий radius і ті
  значення, які справді перемикаються між light/dark або брендами.
- **У рецепті компонента (`cva`/класи):** висота, padding, розмір іконки, геометрія focus ring,
  popup placement/width, анімація та поведінкові варіанти.
- Тому висота `SelectTrigger` — у recipe `select.tsx`, а не в `--select-height` теми.
  Дефолт — `h-9`; компактний toolbar використовує спільний opt-in `size="sm"`, а не локальні
  height-класи чи select-специфічний токен.

### Семантична мапа: роль у UI → токен

| Роль                                         | Токен                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Фон сторінки                                 | `bg-background`                                                                                   |
| Сайдбар                                      | `bg-sidebar` (+ `--sidebar-border` / `--sidebar-accent`)                                          |
| Хедер                                        | `bg-background` + `border-b`                                                                      |
| Контентна картка                             | `bg-card text-card-foreground shadow-sm` без зовнішнього border                                   |
| Спливна поверхня (попап/діалог/драйвер/тост) | `bg-popover text-popover-foreground`                                                              |
| Поверхня наведення                           | `hover:bg-accent` — **`accent` це НЕ бренд** (бренд це `primary`) і НЕ поверхня: з 2026-09-08 це ПРОЗОРА накладка, тому однаково читається на полотні, сайдбарі, картці й попапі |
| Вибраний / активний стан                     | **той самий `bg-accent`, що й наведення** — стан показує ЗНАК (`text-icon-strong`), а не другий відтінок фону. Окремого «сильнішого» токена в темі немає навмисно |
| Активний пункт навігації                     | `SidebarMenuButton isActive`                                                                      |
| Другорядний текст                            | `text-muted-foreground` (`--muted` — це _фон_, не текст)                                          |
| **Іконка** поруч із текстом                  | `text-icon` — окрема шкала з трьох рівнів, НЕ `text-foreground`: знак стоїть на сходинку блідіше за літери (правило Notion `--c-ico*` проти `--c-tex*`). Ставлять ПРИМІТИВИ (`button` ghost/outline/secondary/toolbar, `sidebar`, пункти меню), на місці використання писати не треба |
| **Іконка під взаємодією** (наведення / активний пункт) | `text-icon-strong` — верхній рівень шкали; перемикають `hover` і `data-active` у самих примітивах  |
| **Службова іконка** (шеврон, адорн поля)     | `text-icon-muted` — нижній рівень (`--c-icoTer`)                                                   |
| Небезпека: текст / суцільна заливка / мʼяка  | `text-destructive` / `bg-destructive text-destructive-foreground` / `Badge variant="destructive"` |
| Успіх, попередження                          | наше розширення `--success` / `--warning`                                                         |
| Попередження, яке НЕ помилка                 | `Alert variant="warning" accent="left"` + `TriangleAlertIcon` (банер зони календаря, накладання подій) |
| Подія календаря (заливка / смужка типу / текст) | палітра подій Notion: `bg-event-<колір>-bg` / `bg-event-<колір>-line` / `text-event-<колір>` — **не semantic-роль**, а іменований колір; мапінг «тип події → колір» живе в `apps/web/src/components/calendar/event-kind.ts` |
| Вихідні в сітці календаря                    | `bg-calendar-weekend`                                                                             |
| Період, відкритий у сітці (у міні-календарі) | `bg-calendar-in-view`; наведення на день — `bg-calendar-day-hover`                                |
| Бренд                                        | `text-primary`                                                                                    |
| Посилання в тексті                           | `text-primary underline underline-offset-4`                                                       |
| Присутність offline                          | `bg-muted-foreground/40` (`bg-muted` — світлий фон, крапка була б невидима)                       |
| Межа / межа поля                             | `border-border` / `border-input`                                                                  |
| Обрана поверхня рядка                        | `data-[state=selected]:bg-accent` — та сама накладка, що скрізь (не `bg-muted`)                    |
| Form fields                                  | `bg-field border-input` без тіні; focus `border-ring ring-1 ring-ring`                            |
| Контейнер Tabs                               | `bg-accent` — ПРОЗОРА накладка (таби стоять і на картці, і на полотні, і в тулбарі календаря)      |
| Активний default Tab                         | `bg-segment text-segment-foreground shadow-sm` — у темряві `--segment` ІНВЕРТОВАНИЙ у майже білий (`theming.md` §1.3.4) |
| Піднята («біла») кнопка                      | `Button variant="elevated"` — той самий матеріал, що активний сегмент                              |

Не підставляти `text-white` в суцільні semantic pairs: foreground-токен визначає контраст
ролі й може бути темним, як у dark-парах `success` та `warning`.

---

## 4. Конвенції коду

- **Композиція замість compound-неймспейсів**: `DialogContent`/`DialogTitle`,
  `TableHead`/`TableCell`, `DropdownMenuItem` — а не `Dialog.Content`.
- **Підміна елемента — `render={<Button/>}`** (Base UI), **не** `asChild`.
- **Кустарних обгорток над примітивами не заводимо.** Медіа-обʼєкт — `Item*`, порожні стани —
  `Empty*`, індикатор на аватарі — `AvatarBadge`, набір фільтрів — `ToggleGroup`, бокова
  панель — `Sheet`, навігація — `Sidebar*`. Якщо примітив є в реєстрі, свій не пишемо.
  Єдиний виняток — `FileDropzone` (дропзони в реєстрі немає), і його оболонка теж складена з
  `Empty` + `Button`.
- **Правки вендореного коду позначаються коментарем «ЛОКАЛЬНА ПРАВКА реєстру»** — інакше
  наступне оновлення тихо їх знесе. Перед ним запускати `shadcn diff <name>`. Реєстр правок —
  §6.
- **Вкладеність HTML.** `AlertDialogDescription` / `ItemDescription` уже є `<p>`, а
  `Item render={<button/>}` уже є `<button>` — не класти всередину ще один абзац або кнопку
  (React пише про це в консоль).
- **Частини, які вимагають батька, Base UI перевіряє в РАНТАЙМІ, а не типами.**
  `DropdownMenuLabel` — це `MenuPrimitive.GroupLabel`, і без `DropdownMenuGroup` навколо він
  падає з `MenuGroupContext is missing` уже в браузері; те саме стосується інших `*GroupLabel`
  і радіо-частин. Це головна пастка при переносі блоків із реєстру: shadcn-блоки писались під
  Radix, де `DropdownMenuLabel` лежить прямо в `DropdownMenuContent` (див. `nav-user`), і
  компілятор різницю не бачить — **кожен перенесений дропдаун треба відкрити руками**.
- **Іконки** — `lucide-react`, per-icon імпорти; у компонентах через
  `data-icon="inline-start"|"inline-end"` **без** класів розміру (компонент керує сам).
- **Неосновні button-actions** — `variant="secondary"`; `outline` лишається частиною
  дизайн-системи, але не є стандартним cancel/load-more/edit action у продуктових екранах.
- **Icon-only X-close/clear/remove** — `radius="full"`: це стосується `Dialog`, `Sheet`, toast,
  notification card та Combobox. Розмір як і раніше задається через `size="icon*"`.

### Форми

`useController` → `Field` + `FieldLabel htmlFor` + `Input id` (`useId()`) + `FieldError`.
Стан помилки — `data-invalid` на `Field` і `aria-invalid` на контролі; підказка —
`FieldDescription` усередині `Field`. Серверні помилки — `applyServerError(error, form)`:
`fieldErrors` → `setError` по імені поля, решта → `errors.root.server`. Тому форми **мусять
мати повні `defaultValues`** (звірка йде через `getValues`).

`FormSelect` **мусить** діставати `items` — без мапи value→label Base UI малює в тригері сире
значення (`USER` замість `User`).

### Розкладка

- **Шел `apps/web` — ДВА рівні навігації** (смуга іконок area + колонка активної area):
  окремий документ [`app-shell.md`](app-shell.md), реєстровий предок — `sidebar-09`.
  Термінологія (`AppRail` / area / `AreaSidebar`), прив'язка до роутингу і метрики
  розкладки — там.
- **Шел `apps/platform-web` — патерн `sidebar-07`** реєстру: бренд-плитка + назва +
  підзаголовок у `SidebarHeader`, профіль юзера з дропдауном у `SidebarFooter` (`UserIdentity`
  із `libs/ui`), у хедері лише `SidebarTrigger` + дзвінок + перемикач теми.
  `collapsible="icon"` — згорнутий сайдбар стає смугою іконок 48px. Другого рівня там немає
  навмисно: одна area, і рейл був би декорацією.
- **Крихти сторінок — через портал.** Сторінка рендерить `PageBreadcrumbs`, а
  `PageHeaderPortal` телепортує розмітку в слот хедера layout-а. Портал міняє лише місце в
  DOM — дерево React те саме, тож `Link` роутера й контексти сторінки працюють як звичайно.
  Новий вміст хедера додається без зміни контракту layout-а.
- **Хедер layout-а — sticky glass surface.** Він закріплений зверху в єдиному scroll-контексті
  сторінки; контент проходить під напівпрозорим `background` із `backdrop-blur`. Не додавайте
  `overflow-y-auto` внутрішньому контейнеру сторінки без явно обмеженої висоти — це створить
  другий scroll-контекст і порушить sticky-поведінку.
- **Верхній відступ контенту — 16px**, бічні та нижній — 24px. Це тримає заголовки й primary
  actions ближче до sticky-хедера, не стискаючи основний контент сторінки.
- **Сторінка списку** (за shadcn-admin): рядок шапки (`h2` + підзаголовок ліворуч, головні дії
  праворуч) → окремий рядок тулбара над таблицею (пошук і фільтри ліворуч, `Reset` зʼявляється
  лише коли є що скидати; проп `actions` праворуч) → таблиця → пагінація.
- `SidebarInset` реєстру САМ рендериться як `<main>` — не вкладати всередину ще один.

### Регіони тостів

`toast-host.tsx` лишається локальним у застосунку, бо регіонів різна кількість: у `apps/web`
два (сповіщення і помилки), у `apps/platform-web` один. **Позиції спільні для обох** — людина,
яка ходить між двома консолями, шукає повідомлення в тому самому куті:

| Що                         | Де                                                              |
| -------------------------- | --------------------------------------------------------------- |
| Помилки API                | **знизу праворуч**                                              |
| Живі сповіщення (web)      | **зверху праворуч під дзвінком**, зміщені вниз на висоту хедера |
| Будь-який тост на `/login` | знизу по центру                                                 |

Два окремі регіони — щоб подія і невдала дія не витісняли одна одну. Менеджер `toast` —
модульний синглтон, тому `error-toast.ts` працює **поза React-деревом** (його кличуть
глобальні `QueryCache`/`MutationCache` `onError` у `main.tsx`, дедуп 5 с).

### DataGrid

Публічний API — фабрика `createDataGrid<TFilters, TItem>()` на рівні модуля сторінки; повертає
компаунд-набір `Grid.Root` / `Grid.Filters` / `Grid.Toolbar` / `Grid.Table` /
`Grid.SelectionSummary` / `Grid.filter`. Повний контракт (фетчинг через проп `useListQuery`,
скидання вибору, headless escape hatches, wire-формат boolean-фільтрів) — у `CLAUDE.md`,
розділ про DataGrid; він не змінювався від міграції UI.

`Grid.Table surface="card"` — опційна HeroUI-подібна поверхня: спільний `Card size="sm"`
дає radius/background/shadow, а прозора таблиця заповнює її без внутрішнього padding. Режим
`Table separator="inset"` малює горизонтальні separator-и через комірки й відступає лише саму
лінію на 12 px від обох країв. Режим використовується в tenant Users і platform Jobs grids.
Platform Tenants має ту саму композицію `Card + Table separator="inset"` вручну, бо цей список
не потребує DataGrid-фільтрів чи пагінації. `bordered` лишається backward-compatible дефолтом.

`Grid.Toolbar` — контекстна панель списку для business actions. У звичайному стані вона показує
`Total: N` і компактні фільтри, у selection-стані — `Selected: N`, передані сторінкою
bulk actions і Clear. Обидва стани накладені в одну CSS grid-комірку: неактивний невидимий,
але продовжує резервувати найбільші ширину й висоту, тому surface не стрибає при перемиканні.
Панель має `bg-secondary` без тіні й споріднена з `TabsList`; її Reset — доступна icon-only
кнопка (`aria-label` + `Tooltip`) з `radius="full"` і `ghost` hover. Нижчорівневий
`Grid.Filters` лишається для plain toolbar-ів без selection business logic.

Власний тип `SortDescriptor { column: string; direction: 'ascending' | 'descending' }` живе в
`data-grid/types.ts` і реекспортується з барелю — раніше він приходив із UI-бібліотеки.

---

## 5. Оновлення примітивів

`components.json` лежить **і в пакеті, і в кожному застосунку**. Межа така:

- запуск із `libs/ui` додає/оновлює спільні примітиви;
- запуск із `apps/web` або `apps/platform-web` додає сторінковий блок у застосунок;
- в app-конфігах `components`/`lib`/`hooks` локальні (`@/...`), а `ui`/`utils` і CSS теми
  вказують на `@saas-skeleton/ui`. Тому registry dependencies блоку не дублюють примітиви.

```bash
cd libs/ui
pnpm dlx shadcn@4.19.0 diff <name>   # побачити дельту апстріму
pnpm dlx shadcn@4.19.0 add <name>    # додати новий примітив

cd ../../apps/web
pnpm dlx shadcn@4.19.0 add @shadcn/<block> --dry-run
```

Перед прийняттям дифу — звірити з реєстром локальних правок (§6), інакше вони зникнуть.

---

## 6. Локальні правки вендореного коду

Точкові плюс одна наскрізна. Усі позначені коментарем «ЛОКАЛЬНА ПРАВКА реєстру».

| Файл                                | Правка                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/toast.tsx`                      | позиції регіонів (`position` на `Toaster`/`ToastViewport`, `anchor` на `Toast`)                                                        |
| `ui/checkbox.tsx`                   | `MinusIcon` у стані `indeterminate` (реєстр знає лише галочку); focus `ring-1`                                                         |
| `ui/badge.tsx`                      | `success`/`warning`; opacity мʼяких фонів обмежена так, щоб дрібний текст тримав 4.5:1                                                 |
| `ui/alert.tsx`                      | варіант **`warning`** (мʼякий фон `bg-warning/10` + `text-warning`, як у `badge`) і вимір **`accent="left"`** — кольорова смужка 3px ліворуч; товщину задає `accent`, колір бере `compoundVariants` від варіанта. Реєстр радить робити це хардкодом `bg-amber-50 dark:bg-amber-950` на місці використання («Custom Colors»), що розписувало б dark у кожному виклику |
| `ui/calendar.tsx`                   | обведення дня прибрано з `data-focused` і лишилось лише на `focus-visible`: `react-day-picker` тримає «сфокусований день» своїм станом і сам кличе `focus()`, тому реєстрові класи малювали кільце після кліку МИШЕЮ — воно лишалось висіти й переїжджало на інший день при навігації. Індикатор для клавіатури збережений |
| `ui/button.tsx`                     | суцільний `destructive`, HeroUI hover, метрика 28/32/36/40px, `radius="full"` і суцільний focus ring                                   |
| `ui/{input,select,input-group}.tsx` | висота 36px і `px-3`; `bg-field` / `border-input`, без тіні, тонкий primary-blue focus `ring-1`                                        |
| `ui/textarea.tsx`                   | `px-3`, `bg-field`, без тіні, `ring-1`; стокова багаторядкова мінімальна висота `min-h-16`                                             |
| `ui/combobox.tsx`                   | поле пошуку й chips-контейнер використовують `bg-field` / `border-input`, без тіні, `ring-1`; **`ComboboxClear` доданий до експортів** — реєстр визначає його, але тримає приватним для `ComboboxInput` (`showClear`), а комбобокс із кнопкою-тригером (`UserSelect`) інпута зовні не має і рендерить скидання сестрою тригера; **`ComboboxTrigger` отримав `showChevron`** — комбобокс можна відкривати кнопкою-ДІЄЮ («+ Add a guest» у `UserMultiList`), де шеврон означав би розкривний список; **`ComboboxChip` отримав `removeLabel`** — кнопка зняття чипа несе саму іконку і не отримує від Base UI дефолтного `aria-label`, а ззовні її не дістати (`...props` ідуть на чип) |
| `ui/{dialog,sheet,toast}.tsx`       | круглі X-close через `radius="full"`; toast action і footer close використовують `secondary`                                           |
| `ui/{alert-dialog,pagination}.tsx`  | secondary для cancel та активної сторінки замість outline                                                                              |
| `ui/switch.tsx`                     | тонкий primary-blue focus `ring-1`; error-state зберігає `ring-2`                                                                      |
| `ui/tabs.tsx`                       | HeroUI neutral list, muted inactive text, окрема `segment`-поверхня active tab і primary indicator у `line`                            |
| `ui/card.tsx`                       | HeroUI `surface-shadow` без зовнішнього border; стокові spacing, size та композиція частин                                             |
| `ui/select.tsx`                     | `alignItemWithTrigger: false` — попап відкривається ПІД тригером, а не накриває його; `align="start"`; ширина `min-w-(--anchor-width)` |
| `ui/input.tsx`                      | глушник autofill + скидання `::-webkit-search-cancel-button`                                                                           |
| `ui/calendar.tsx`                   | знято `bg-background` з кореня — сітка прозора і бере поверхню споживача; разом із фоном пішли й обидва гасіння (`in-data-[slot=card-content]`, `in-data-[slot=popover-content]`), бо без нього це мертвий код |
| **наскрізна:** form controls        | суцільний semantic focus `ring-1`; error-state — `ring-2`                                                                              |

### 6.1 Правки сесії «звірка з Notion» (2026-09-08)

Ця сесія зачепила вендорений шар ширше за звичайне: змінено **14 файлів**. Причина в тому, що
дві зміни були не косметичні, а СИСТЕМНІ — окрема шкала знаків (`--icon*`) і прозорі накладки
станів (`--accent`), — а такі речі за визначенням лягають у примітиви, а не в сторінки. Тримати
їх на місцях використання означало б писати `text-icon` у кожній кнопці й кожному пункті меню
назавжди.

| Файл                                          | Правка                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ui/button.tsx`                               | знак бере `--icon` (у нейтральних варіантах) і `--icon-strong` під курсором; `hover`/`aria-expanded` — накладка `bg-accent` замість `bg-muted`; **новий варіант `elevated`** (біла піднята кнопка, у темряві інвертована) |
| `ui/sidebar.tsx`                              | те саме для обох рівнів навігації; вибраний пункт — та сама накладка, що наведення; **колірні правила знака звужені до `[&>svg]`** (інакше сірів логотип у бренд-плитці) |
| `ui/{dropdown-menu,context-menu,select,combobox}.tsx` | знак пункту бере `--icon`; шеврон селекта — `--icon-muted`                                                             |
| `ui/input-group.tsx`                          | адорни поля беруть `--icon-muted`                                                                                              |
| `ui/{badge,toggle,item}.tsx`                  | наведення (і `aria-pressed`/`data-[state=on]` у `Toggle`) — накладка `bg-accent` замість `bg-muted`                            |
| `ui/table.tsx`                                | рядок із відкритим меню і рядок `data-state=selected` — та сама накладка                                                        |
| `ui/tabs.tsx`                                 | жолоб — прозора накладка; активний сегмент у темряві ІНВЕРТОВАНИЙ (`--segment`, `theming.md` §1.3.4)                            |
| `ui/scroll-area.tsx`                          | повзунок бере `--icon-muted`: після переходу межі на 5.5% прозорості `bg-border` став невидимим, а повзунок — не розділювач    |
| `ui/calendar.tsx`                             | метрика підписів Notion (10px/500 weekday, 13px числа); клітинка не квадрат; заливка дня переїхала на `before:` з інсетом; `today` більше не малює фон |

**Що це коштує.** `pnpm dlx shadcn@4.19.0 diff <name>` на цих файлах тепер шумить сильніше — але
кожна правка позначена коментарем «ЛОКАЛЬНА ПРАВКА реєстру» з поясненням ЧОМУ, тож при оновленні
реєстру видно, що зберігати. Альтернатива — тримати шкалу знаків і накладки на місцях
використання — коштувала б дорожче: кожен новий екран мусив би про них памʼятати, а «забув
написати `text-icon`» не ловиться ні типами, ні лінтером.

Про `alignItemWithTrigger`: дефолт Base UI `true` — це macOS-поведінка, коли попап
«підіймається» так, щоб обраний пункт став на місце тригера. У формах адмінки це збиває.

Про глушник autofill: `[transition:…]` — це **shorthand**, і поруч зі стоковим
`transition-colors` вони конфліктують (перемагає порядок генерації утиліт, а не наміри). Тому
обидва склеєні в один: `background-color 5000000s, border-color 150ms, box-shadow 150ms`.

Єдиний легальний хардкод у вендореному шарі — `<span className="sr-only">Close</span>` у
`DialogContent` / `SheetContent`: правити означало б завести `useTranslation` у вендорений код.

---

## 7. Граблі, які варто знати наперед

- **Бекендні tsconfig-и НЕ мають підбирати фронтові ліби.** `include` у
  `apps/{api,platform-api,worker}/tsconfig*.json` перелічує `libs/{contracts,database,shared}`
  **явно**. Колишній wildcard `libs/*/src/**/*` затягнув `libs/ui` у webpack-збірку і дав 353
  помилки `TS17004` (JSX без флага). Turbo при цьому віддавав закешований зелений
  `typecheck` — нова ліба не інвалідує таск застосунку, тому перевіряти `--force`.
- **Пакет `shadcn` у `dependencies` тягне zod 3.** Він потрібен насправді (з нього йде
  `@import 'shadcn/tailwind.css'`), а `shamefully-hoist=true` піднімає його zod у корінь;
  `@hookform/resolvers` оголошує `zod` опційним peer-ом і підхоплює хойстнутий — `zodResolver`
  перестає типізуватись в обох фронтах. Тримає на місці `pnpm.overrides: { "zod": "^4.4.3" }`
  у кореневому `package.json`. **Не прибирати.**
- Через цей глобальний Zod 4 override локальний `pnpm exec shadcn` несумісний із CLI 4.19.0
  (`deepPartial is not a function`). Для CLI використовувати ізольований і зафіксований
  `pnpm dlx shadcn@4.19.0`; `@latest` не дає відтворюваного diff.
- **`pnpm-lock.yaml` у репо тримається відформатованим prettier-ом.** Будь-який
  `pnpm install` переписує його у власний компактний формат і дає диф на ~6000 рядків. Після
  install — `pnpm exec prettier --write pnpm-lock.yaml`.
- **`SidebarProvider` тримає стан згортання в cookie**, не в localStorage.

### Перевірка UI в браузері

- У вкладці з нульовим viewport (`0×0`) **не можна** вимірювати позицію тостів — трансформи
  стеку рахуються від висоти вікна і всі значення виходять відʼємними. Спершу `resize_window`.
- **У прихованій вкладці не програються CSS-анімації.** Base UI знімає попап із DOM після
  `animationend`, тож закритий `AlertDialog` лишається у дереві з `data-closed`. Судити треба
  за `data-open`/`data-closed`, а не за наявністю вузла.
- Буфер консолі в браузерних інструментах кумулятивний — `console.clear()` і перезавантаження
  його не чистять; «чистоту після правки» доводити структурою DOM.
- Dev-сервер, піднятий посеред великої правки, може тримати застарілий модульний граф —
  рестарт. HMR зміни в `libs/ui` підхоплює штатно.
