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
[satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) — з їхніх
`src/styles/theme.css`. У наших `components.json` лишається `baseColor: "neutral"`: це
метадані генератора, а не назва runtime-теми; фактичні slate-нейтралі задають CSS-токени.

| Параметр    | Значення                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Нейтралі    | slate, hue ≈ 250–265 — холодний підтон                                                                    |
| Світла тема | сторінка і панелі **білі** (`--background` = `--card` = `--popover` = `oklch(1 0 0)`); глибину дають межі |
| Темна тема  | bg `oklch(0.129 0.042 264.695)`, card `0.14 0.04 259.21`, popover `0.208 0.042 265.755`                   |
| `--radius`  | `0.625rem`                                                                                                |
| Тіні        | стокова шкала Tailwind                                                                                    |
| Шрифт       | Inter                                                                                                     |
| Перемикач   | `attribute="class"`; storageKey `saas_theme` / `saas_platform_theme`                                      |

### Два свідомі відхилення від стоку

Зафіксовані рішенням користувача — **не переглядати без запиту**:

1. **`--primary` (і `--ring`) — наш синій.** У світлій темі
   `oklch(0.56 0.195 253.83)`, у темній `oklch(0.6204 0.195 253.83)`. Різні lightness і
   `--primary-foreground` зберігають контраст суцільної пари та `text-primary` не нижче
   4.5:1. У стоку тут майже чорний slate. Фокус синій, бо `--ring` = `--primary`.
2. **Метрика однорядкових контролів — 36px.** `default` кнопка, `input`, `select` та
   `input-group` мають 36px; кнопки `sm` 32, `xs` 28, `lg` 40, іконкові — `size-7/8/9/10`.
   `textarea` багаторядкова і лишається `min-h-16`. Горизонтальні відступи полів — `px-3`.
   Фокус — суцільне `ring-2` кольору `--ring`: у кнопок із `ring-offset-2` кольору фону, у
   полів без відступу.

Саме ці два відхилення — єдина причина, чому `button`/`input`/`select`/`input-group` лишаються
з коментарем «ЛОКАЛЬНА ПРАВКА реєстру». **Нову висоту не задавати класом на місці
використання** — вона дефолтна.

`--success` / `--warning` (+`-foreground`) — **наше розширення**: у shadcn таких ролей немає.
Це slate-сумісні emerald/amber; lightness скоригований так, щоб дрібний текст у мʼяких
`bg-*/10` badge мав контраст не нижче 4.5:1. Варіанти — у cva `ui/badge.tsx`.
`--destructive-foreground` доповнює суцільну semantic pair і має різне значення в light/dark.

### Межа між темою і компонентом

- **У темі:** семантичні кольори та їхні `*-foreground` пари, шрифт, базовий radius і ті
  значення, які справді перемикаються між light/dark або брендами.
- **У рецепті компонента (`cva`/класи):** висота, padding, розмір іконки, геометрія focus ring,
  popup placement/width, анімація та поведінкові варіанти.
- Тому висота `SelectTrigger` — `h-9` у `select.tsx`, а не `--select-height` у темі. Якщо
  зʼявиться реальна runtime-вимога compact/comfortable для всіх контролів, вводимо спільний
  density-рецепт або загальний `--control-height`, не select-специфічний токен.

### Семантична мапа: роль у UI → токен

| Роль                                         | Токен                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Фон сторінки                                 | `bg-background`                                                                                   |
| Сайдбар                                      | `bg-sidebar` (+ `--sidebar-border` / `--sidebar-accent`)                                          |
| Хедер                                        | `bg-background` + `border-b` (у світлій темі `--card` = `--background`)                           |
| Контентна картка                             | `bg-card text-card-foreground`                                                                    |
| Спливна поверхня (попап/діалог/драйвер/тост) | `bg-popover text-popover-foreground`                                                              |
| Поверхня наведення                           | `hover:bg-accent` — **`accent` це НЕ бренд**, бренд це `primary`                                  |
| Активний пункт навігації                     | `SidebarMenuButton isActive`                                                                      |
| Другорядний текст                            | `text-muted-foreground` (`--muted` — це _фон_, не текст)                                          |
| Небезпека: текст / суцільна заливка / мʼяка  | `text-destructive` / `bg-destructive text-destructive-foreground` / `Badge variant="destructive"` |
| Успіх, попередження                          | наше розширення `--success` / `--warning`                                                         |
| Бренд                                        | `text-primary`                                                                                    |
| Посилання в тексті                           | `text-primary underline underline-offset-4`                                                       |
| Присутність offline                          | `bg-muted-foreground/40` (`bg-muted` — світлий фон, крапка була б невидима)                       |
| Межа / межа поля                             | `border-border` / `border-input`                                                                  |
| Обрана поверхня рядка                        | `bg-muted`                                                                                        |

Не підставляти `text-white` в суцільні semantic pairs: foreground-токен може навмисно бути
темним у dark-темі, як у `primary` і `destructive`.

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
- **Іконки** — `lucide-react`, per-icon імпорти; у компонентах через
  `data-icon="inline-start"|"inline-end"` **без** класів розміру (компонент керує сам).

### Форми

`useController` → `Field` + `FieldLabel htmlFor` + `Input id` (`useId()`) + `FieldError`.
Стан помилки — `data-invalid` на `Field` і `aria-invalid` на контролі; підказка —
`FieldDescription` усередині `Field`. Серверні помилки — `applyServerError(error, form)`:
`fieldErrors` → `setError` по імені поля, решта → `errors.root.server`. Тому форми **мусять
мати повні `defaultValues`** (звірка йде через `getValues`).

`FormSelect` **мусить** діставати `items` — без мапи value→label Base UI малює в тригері сире
значення (`USER` замість `User`).

### Розкладка

- **Шел — патерн `sidebar-07`** реєстру: бренд-плитка + назва + підзаголовок у
  `SidebarHeader`, профіль юзера з дропдауном у `SidebarFooter` (`UserIdentity` із `libs/ui`),
  у хедері лише `SidebarTrigger` + дзвінок + перемикач теми. `collapsible="icon"` — згорнутий
  сайдбар стає смугою іконок 48px.
- **Крихти сторінок — через портал.** Сторінка рендерить `PageBreadcrumbs`, а
  `PageHeaderPortal` телепортує розмітку в слот хедера layout-а. Портал міняє лише місце в
  DOM — дерево React те саме, тож `Link` роутера й контексти сторінки працюють як звичайно.
  Новий вміст хедера додається без зміни контракту layout-а.
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
компаунд-набір `Grid.Root` / `Grid.Filters` / `Grid.Table` / `Grid.SelectionSummary` /
`Grid.filter`. Повний контракт (фетчинг через проп `useListQuery`, скидання вибору, headless
escape hatches, wire-формат boolean-фільтрів) — у `CLAUDE.md`, розділ про DataGrid; він не
змінювався від міграції UI.

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

| Файл                                  | Правка                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/toast.tsx`                        | позиції регіонів (`position` на `Toaster`/`ToastViewport`, `anchor` на `Toast`)                                                        |
| `ui/checkbox.tsx`                     | `MinusIcon` у стані `indeterminate` (реєстр знає лише галочку)                                                                         |
| `ui/badge.tsx`                        | `success`/`warning`; opacity мʼяких фонів обмежена так, щоб дрібний текст тримав 4.5:1                                                 |
| `ui/button.tsx`                       | суцільний `destructive`, contrast-safe hover, метрика 28/32/36/40px і суцільний focus ring                                             |
| `ui/{input,select,input-group}.tsx`   | висота однорядкового поля 36px і `px-3`; поверхня/тінь лишаються стоковими                                                             |
| `ui/textarea.tsx`                     | `px-3`; стокова багаторядкова мінімальна висота `min-h-16`                                                                             |
| `ui/select.tsx`                       | `alignItemWithTrigger: false` — попап відкривається ПІД тригером, а не накриває його; `align="start"`; ширина `min-w-(--anchor-width)` |
| `ui/input.tsx`                        | глушник autofill + скидання `::-webkit-search-cancel-button`                                                                           |
| **наскрізна:** інтерактивні примітиви | фокус-кільце `ring-2` замість `ring-[3px] ring-ring/50`                                                                                |

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
