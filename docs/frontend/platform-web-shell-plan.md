# План: підтягнути `apps/platform-web` під шел і патерни `apps/web`

> **Історичний план.** Згадані тут `areas.tsx`, `paths.ts` (`NavPath`/`AreaPrefix`), `area-nav.tsx`,
> `canSee` і `AppArea.Sidebar` пізніше замінила спільна навігація `libs/ui/src/navigation` із
> `*.nav.ts` у модулях — актуальна модель у `docs/frontend/app-shell.md` §2.

**Одна ітерація для агента.** Скоуп: `apps/platform-web` отримує ту саму
структуру, що вже прийнята в tenant-порталі — два рівні навігації (рейл + колонка
area), нижня смуга акаунта, контекстна панель, `ScrollArea`-скрол сторінки,
друга вісь теми (палітра), `bleed`/`padded`, `DataGrid` на всіх списках. Плюс
один мінімальний бекенд-хід, без якого `/tenants` не може стати близнюком
`/users` (пагінація/пошук у `GET /tenants`).

Читати перед початком: `docs/frontend/app-shell.md` (усе, особливо §5 і §7),
`docs/frontend/ui-stack.md` § «Прокрутка» і § «Розкладка шела», `docs/settings.md`
§ «особисте vs організаційне».

---

## 0. Що означає «структурна парність»

Парність — це **однакова МОДЕЛЬ**, не однаковий набір екранів. Однакові:
розкладка шела, механіка навігації (area = префікс URL, активна area = чиста
функція від pathname), місце ідентичності сторінки (`PageHeader` у хедері шела),
патерн списку (`bleed` + band-тулбар + `DataGrid`), патерн картки (шапка +
вкладки + колонка стану), патерн налаштувань (`ContentSection`), обидві осі
теми, регіони тостів.

Різне і має лишитись різним: **склад area** (контрол-плейн не має календаря,
кастомерів, чату), **дзвінок сповіщень** (tenant-фіча), **presence/last-seen**
(tenant-фіча), **стрічка активностей** (`activities` живуть під RLS у
tenant-плані — платформа їх не читає), **refresh-токен** (у платформи його немає
взагалі, access 60m у localStorage — свідомий trade-off MT-3).

**Копіюємо, а НЕ витягуємо в `libs/ui`.** Файли шела не побайтово однакові:
реєстр area, бренд, футер (свій auth-стор), шапка колонки (у web — назва тенанта
з `GET /settings/bootstrap`, у платформи такого ендпоінта немає). Так само
народжувався сам `libs/ui` (UI-0): спершу два побайтово однакові набори, потім
екстракція. Кандидати на екстракцію після цієї ітерації — у §6.

---

## 1. Стан на старті: інвентаризація розбіжностей

| Що                | `apps/web` (еталон)                                                                                   | `apps/platform-web` зараз                              | Дія       |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| Шел               | `src/app-shell/` — рейл + колонка area + `AppFooterBar`                                               | `components/app-layout.tsx`, один сайдбар `sidebar-07` | Крок 2–3  |
| Навігація         | area з префіксом URL, `resolveArea(pathname)`                                                         | два `SidebarMenuButton` з `pathname === '/'`           | Крок 2–3  |
| Профіль           | нижня смуга на всю ширину обох колонок, `side="top"`                                                  | `SidebarFooter`, `side="right"`                        | Крок 2    |
| Скрол             | `SidebarInset h-svh overflow-hidden` + `ScrollArea size="lg"` + скидання на `pathname`                | скролить ВІКНО, хедер `sticky` з `backdrop-blur`       | Крок 2    |
| Хедер             | суцільний `bg-background`, не sticky (він поза скролером)                                             | `bg-background/70 supports-[backdrop-filter]:blur`     | Крок 2    |
| Відступи контенту | `staticData.layout: 'padded' \| 'bleed'`                                                              | завжди `px-6 pt-4 pb-6`                                | Крок 3    |
| Контекстна панель | третя колонка, `--context-panel-width: 18rem`, `ContextPanelTrigger` у хедері                         | немає                                                  | Крок 7    |
| Палітра теми      | `UiThemeProvider` + блокувальний скрипт в `index.html` + `ThemeSelect`                                | тільки режим (`next-themes`)                           | Крок 4    |
| Список (головний) | `/users`: `bleed`, `Grid.Toolbar surface="band" size="sm"`, `Grid.Table surface="flush"`, row actions | `/`: плоска `<Table>` у `Card`, кнопка дії в рядку     | Крок 1, 5 |
| Список (другий)   | —                                                                                                     | `/jobs`: `Grid.Filters` у `mb-4`, `surface="card"`     | Крок 6    |
| Картка            | `/workspace/users/$userId`: шапка + вкладки + колонка стану                                           | `/tenants/$tenantId` — той самий патерн, уже є         | лишається |
| Налаштування      | area `/user-settings` (Profile/Account/Security/Notifications/Appearance) + `ContentSection`          | немає зовсім                                           | Крок 8    |
| Тости             | два регіони (помилки знизу-справа, сповіщення зверху-справа)                                          | один, знизу-справа                                     | лишається |
| 404               | `notFoundComponent` на `appRoute` + splat-роут                                                        | тільки splat-роут                                      | Крок 3    |

---

## 2. Зафіксовані рішення (прийняті цим планом; не переглядати на ходу)

### 2.1 Склад area — дві видимі, одна прихована

| Area              | Префікс          | У рейлі                      | Друга колонка            | Іконка      |
| ----------------- | ---------------- | ---------------------------- | ------------------------ | ----------- |
| **Tenants**       | `/tenants`       | так                          | `All tenants`            | `Building2` |
| **Operations**    | `/operations`    | так                          | `Jobs` · `Queues`        | `Activity`  |
| **User settings** | `/user-settings` | **ні** — з дропдауна аватара | `Profile` · `Appearance` | `UserCog`   |

**Чому саме такий поділ.** Рейл вимагає ≥2 area, інакше він декорація (саме тому
в platform-web його досі не було). Природна межа: **Tenants — клієнти
платформи**, **Operations — машинерія системи**. Друга має реальне меню вже
зараз (Jobs + Queues) і росте на EDA-2 (DLQ, replay, лаг черг) — тобто це не
штучно роздутий рівень, а той самий аргумент, яким Settings у web стали окремою
area.

**Колонка Tenants має ОДИН пункт — це легально.** Контракт `AppArea.Sidebar` —
компонент-контейнер area, а не підменю (найяскравіше видно на порожньому
`ChatSidebar` у web). Тут вона наповнюється на MT-4 (оператори, сегменти
тенантів).

**`Queues` — окрема сторінка, а не картки над гридом джоб.** Зараз
`GET /jobs/queues` малює сітку карток ПЕРЕД таблицею, і через них `/jobs` не може
стати `bleed`-полотном (таблиця мусить впиратись у краї, як `/users`). Розділення
дає Operations другий реальний пункт і чистий грід.

**Особисте зветься «User settings», префікс `/user-settings` — як у web.** Не
«Operator settings»: це читалось би як «налаштування операторІВ» (список), тобто
рівно та двозначність, від якої застерігає `docs/settings.md`. Однакові URL у
двох консолях — це та сама ментальна модель для людини, що ходить між ними.

**Розділу «Settings» (організаційного) у platform-web НЕ буде.** Суб'єкт
контрол-плейну — сама платформа, і в `platform-api` немає жодного ендпоінта її
налаштувань. Заводити area заради порожньої сторінки — мертвий код.

### 2.2 URL і сумісність

- `/` → редірект на `/tenants` (`appIndexRoute`, `replace: true`).
- `/jobs` → редірект на `/operations/jobs` **з `location.searchStr`** (стан гріда
  живе в URL; без `searchStr` редірект губив би фільтри — точно як
  `LEGACY_WORKSPACE_PREFIXES` у web).
- `/tenants/$tenantId` **не змінюється** — роут переїжджає під `tenantsRoute`, але
  і шлях, і route-id (`/app/tenants/$tenantId`) лишаються ті самі, тож
  `useParams({ from })` у `tenant-detail.tsx` правити НЕ треба. Перевірити, не
  припускати.
- `/operations` → редірект на `/operations/jobs` (домівка area мусить щось
  показувати — патерн `calendarIndexRoute`/`playgroundIndexRoute`).
- Legacy-нормалізатор позначити як тимчасовий (орієнтир зняття — кінець 2026), як
  у web.

### 2.3 Ширини й метрики — беруться з web БЕЗ змін

`--sidebar-width: calc(14rem + var(--sidebar-width-icon) + 2px)`,
`--context-panel-width: 18rem`, `h-14` шапок (три межі в одну лінію), `h-12`/`p-2`
нижньої смуги, `RAIL_NAV_BUTTON` / `RAIL_ANCHOR_BUTTON` дослівно. Це вже
вимірювалось оком і документоване — переміряти нема потреби, розійтись — легко.

### 2.4 Список тенантів переходить на `DataGrid`, і для цього правиться контракт

`GET /tenants` отримує `page`/`limit`/`search`/`isActive`/`sortBy`/`sortOrder`, а
відповідь — повну пагіновану форму. Це прибирає задокументований виняток
(«плоска таблиця, бо ендпоінт без пагінації») замість того, щоб його увічнити:
список тенантів — головний екран консолі, і він зростає з кожним клієнтом.

### 2.5 Контекстна панель отримує ОДНОГО реального споживача

`JobDetailsPanel` на `/operations/jobs`: повний `data`/`output` (у гріді вони
обрізані `max-w-56`), таймінги, спроби. Заводити механізм без споживача
заборонено правилом репо; вигадувати панель для тенанта не треба — його картка
вже є окремою сторінкою.

---

## 3. Кроки

### Крок 1 — контракт і бекенд: пагінований `GET /tenants`

**`libs/contracts/src/platform/tenant.schema.ts`**

```ts
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

/** Той самий whitelist-патерн, що UserQuerySchema: sortBy — закритий enum у Swagger */
export const TenantQuerySchema = listQuerySchema(['slug', 'name', 'isActive', 'createdAt']).extend({
  // Рядок 'true'/'false' на дроті + transform у boolean — дзеркало UserQuerySchema.isActive
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const TenantListResponseSchema = paginatedResponseSchema(TenantResponseSchema);
```

Тип `TenantQuery` — у `tenant.types.ts` (там уже перелічені всі `z.infer`
поштучно; `index.ts` реекспортує обидва файли зірочкою, тому більше нічого
дописувати не треба).

**`apps/platform-api/src/tenants/tenants.service.ts`** — `findAll(query)`:
`skip`/`take`, `orderBy` з `sortBy`/`sortOrder` (дефолт `createdAt asc` —
поточна поведінка), `where` з `isActive` і `search` (`OR` по `slug`/`name`,
`mode: 'insensitive'`), відповідь `{ items, total, page, limit, totalPages }`.
`SystemPrismaService` лишається — RLS тут ні до чого.

**`apps/platform-api/src/tenants/tenants.controller.ts`** — `@Query()` з
`createZodDto(TenantQuerySchema)`, `@ApiOkResponse({ type: Dto.Output })`.
**`tenants.mapper.ts`** (або де мапінг зараз) — `toTenantListResponse`.

Далі обов'язково, саме цими двома командами (у платформи СВІЙ конвеєр —
`pnpm openapi:generate` стосується tenant-API і тут ні до чого):

```bash
pnpm platform:openapi:generate      # → apps/platform-api/openapi.json
pnpm platform:web:codegen           # → apps/platform-web/src/api/generated
```

**Обидва артефакти комітяться.** `TenantQueryDto` — це `createZodDto` у
`apps/platform-api/src/tenants/dto/tenant.dto.ts` (там уже лежать
`CreateTenantDto`/`TenantListResponseDto` — додати поруч); `findAll` у контролері
отримує `@Query() query: TenantQueryDto`, а мапінг списку виносити в
`tenants.mapper.ts` (зараз контролер збирає відповідь інлайном).

Тести: `apps/platform-api/test/platform.e2e-spec.ts` лишається зеленим
(`items`/`total` на місці). Додати 2 кейси: `?search=` знаходить за slug і за
name; `?isActive=false` віддає лише suspended.

### Крок 2 — каркас шела

Нові файли (копіювати з `apps/web/src/app-shell/`, адаптуючи вміст, не
структуру):

```
apps/platform-web/src/app-shell/
  app-shell.tsx        провайдери, дві колонки, SidebarInset + ScrollArea, ContextPanelSlot
  app-rail.tsx         бренд (ShieldCheck) + пункти area; RAIL_* константи дослівно
  area-sidebar.tsx     шапка h-14 (назва консолі + area сірим) + вміст area
  area-nav.tsx         список пунктів (для area, що є меню) — дослівна копія
  areas.tsx            реєстр AppArea, resolveArea, DEFAULT_AREA
  paths.ts             AreaPrefix / NavPath (літерали) + isUnder
  account-footer.tsx   AppFooterBar + AccountMenu (operator зі свого стору)
  areas/
    tenants-sidebar.tsx  operations-sidebar.tsx  user-settings-sidebar.tsx
```

Змістові відмінності від web (і тільки вони):

- `areas.tsx` — реєстр за таблицею §2.1; `canSee` не потрібен (роль у
  `PlatformUserResponse` відсутня, усі оператори рівні), `hiddenFromRail: true`
  лише на `user-settings`.
- `app-rail.tsx` — знак бренду `ShieldCheck` (як зараз), `Link to="/tenants"`.
- `area-sidebar.tsx` — перший рядок шапки `t('brand')` («Platform Console»),
  другий — `t(area.labelKey)`. Запиту `useSettingsBootstrap` тут НЕ буде:
  відповідного ендпоінта в контрол-плейні немає, і фолбек на бренд у web написаний
  саме під цей випадок.
- `account-footer.tsx` — `operator` замість `user`, без `avatarUrl` (його немає в
  `PlatformUserResponse`), logout = `clearSession()` + `navigate('/login')` без
  виклику API (ендпоінта `POST /auth/logout` у platform-api немає).
  `DropdownMenuLabel` **обов'язково** всередині `DropdownMenuGroup` (граблі §7).
- `app-shell.tsx` — без `NotificationBell` (сповіщення — tenant-фіча). Решта
  дослівно: `PageHeaderSlotProvider` → `ContextPanelProvider` → `SidebarProvider`
  зі style-змінними §2.3, `Sidebar collapsible="icon" overflow-hidden`, рядок із
  двох колонок + `AppFooterBar` сиблінгом, `SidebarInset h-svh min-w-0
overflow-hidden`, суцільний хедер `h-14` (`SidebarTrigger` + `PageHeaderSlot` +
  `ThemeSwitcher` + `ContextPanelTrigger`), `ScrollArea size="lg"` з
  `viewportRef` і скиданням `scrollTo({top:0})` на зміну `pathname`,
  `ContextPanelSlot` сусідом інсету.

Видалити: `apps/platform-web/src/components/app-layout.tsx`.

### Крок 3 — роутер

`apps/platform-web/src/router.tsx`:

```
rootRoute            beforeLoad: legacy /jobs → /operations/jobs (href + searchStr, replace)
  loginRoute         /login                      requireGuest
  appRoute           id:'app'  requireAuth  AppShell  notFoundComponent → NotFoundPage homeTo="/tenants"
    appIndexRoute    /          → redirect /tenants
    tenantsRoute     /tenants
      index          /          validateSearch TenantsSearchSchema   staticData: {layout:'bleed'}
      detail         $tenantId
    operationsRoute  /operations
      index          /          → redirect /operations/jobs
      jobs           jobs       validateSearch JobsSearchSchema        staticData: {layout:'bleed'}
      queues         queues
    userSettingsRoute /user-settings
      profile        /
      appearance     appearance
    notFoundRoute    $
```

- `TenantsSearchSchema` — за зразком `UsersSearchSchema` у web:
  `search`/`page`/`limit` + `sortBy`/`sortOrder` з `TenantQuerySchema.shape` +
  `isActive: z.enum(['true','false'])` (wire-формат, НЕ reuse transform-схеми) —
  усе через `.catch(undefined)`. Експортувати тип `TenantsSearch`.
- `JobsSearchSchema` лишається як є.
- Додати `declare module '@tanstack/react-router'` з
  `interface StaticDataRouteOption { layout?: 'padded' | 'bleed' }` — скопіювати
  з web разом із коментарем.
- `notFoundComponent` на `appRoute` (404 всередині area малюється ВСЕРЕДИНІ
  шела) + splat-роут `$` — обидва, як у web.

### Крок 4 — друга вісь теми (палітра)

- `apps/platform-web/index.html` — блокувальний скрипт із web, ключ
  `saas_platform_theme_palette` (регулярка-просіювання лишається).
- `main.tsx` — `<UiThemeProvider storageKey="saas_platform_theme_palette">`
  усередині `ThemeProvider` (порядок як у web).
- `locales/en/layout.json` — додати `theme.paletteLabel` і `theme.palettes.gray`
  / `theme.palettes.slate` (`ThemeSelect` читає namespace `layout`), а також
  `areas.*` і `nav.*` під §2.1.

### Крок 5 — `/tenants` на `DataGrid`

`apps/platform-web/src/pages/tenants.tsx` — переписати за еталоном
`apps/web/src/features/users/pages/users.tsx`:

- `const Grid = createDataGrid<TenantsSearch, TenantResponseDtoOutput>()` на рівні
  модуля.
- `PageHeader label="TenantsPage" breadcrumbs={[{label: t('title')}]} subtitle
actions={<CreateTenantModal/>}`.
- `<div className="border-b border-border"><Grid.Toolbar surface="band" size="sm"
filters={...} totalLabel selectedLabel /></div>` — фільтри: `Grid.filter.search`
  - `Grid.filter.select({ key: 'isActive', options: [true/false] })`.
- `Grid.Table surface="flush"`, `isRowMuted={(x) => !x.isActive}`.
- Колонка ідентичності — новий `src/components/tenant-identity.tsx`, дзеркало
  `CustomerIdentity` з web: `Avatar` зі `rounded-md after:rounded-md` +
  `Building2`, `colorSeed={tenant.id}`, титул — `name`, другий рядок — `slug`
  моноширинним. Колонка обгорнута `Link to="/tenants/$tenantId"` (як у `/users`).
- Решта колонок: `isActive` (Badge success/destructive), `locale`, `createdAt`
  (`DateTimeCell`). `sortable` — тільки поля з whitelist `TenantQuerySchema`.
- Suspend/Resume переїжджають у **row actions** з `confirm` (`DataGridRowAction`
  уміє підтвердження — окремий `AlertDialog` у сторінці більше не потрібен).
  Два окремі пункти з `isVisible`, а не один із динамічним label — правило з
  `/users`.
- **`selection` НЕ вмикаємо**: bulk-ендпоінта немає, а демо-кнопку `disabled` із
  web копіювати не треба (це там демонстраційний слот, а не патерн).
- `locales/en/tenants.json` — додати `toolbar.total`, `toolbar.selected`,
  `filters.*`, `table.*` під новий склад колонок; прибрати ключі знятого
  `AlertDialog`, які переїхали в `confirm` row action.

### Крок 6 — `/operations/jobs` і `/operations/queues`

- `pages/jobs.tsx`: прибрати сітку карток черг; `Grid.Filters` у `mb-4` →
  `Grid.Toolbar surface="band" size="sm"` в обгортці `border-b border-border`;
  `Grid.Table surface="card"` → `surface="flush"`; роут — `bleed`.
  `refetchInterval` через спред `{ ...gridOptions, refetchInterval }`
  залишається.
- Нова `pages/queues.tsx`: `PageHeader` + та сама сітка карток
  (`useJobsQueues`, `refetchInterval: 5000`), режим `padded`. Порожній стан —
  `Empty*`, а не самописний блок.
- `locales/en/jobs.json` — додати `toolbar.*`; ключі `queueCard.*` перенести або
  залишити (вирішує агент; головне — один namespace на обидві сторінки, окремий
  `queues.json` не заводити).

### Крок 7 — контекстна панель: деталі джоби

- `src/components/job-details-panel.tsx`: `ContextPanelPortal` + `ContextPanelHeader`
  (назва черги + `onClose`), вміст — `Fact`-рядки (стан, спроби, created/started/
  completed) і `data`/`output` у `<pre>` з переносом.
- Відкриття — row action «View details» на гріді джоб (той самий патерн, що «View
  activity» у `/users`); стан `selectedJob` живе на сторінці.
- **Метрика панелі — `p-2` (8px), не `p-6`**: усі частини (шапка `px-2`, вміст
  `p-2`) — див. `app-shell.md` §5.6. Перевірка: назва в шапці й ліва межа вмісту
  на одному піксельному стовпчику.
- Скролер вмісту — `ScrollArea` (вертикаль; горизонталь примітив глушить сам).
  `<pre>` із довгим JSON — `whitespace-pre-wrap break-all`, інакше він розіпре
  колонку 288px.

### Крок 8 — area «User settings»

- `src/components/section/content-section.tsx` — копія з web (метрика розділу,
  `max-w-2xl` / `lg:max-w-xl`).
- `pages/user-settings/profile.tsx` — **read-only** картка ідентичності оператора
  з `GET /auth/me` (хук `usePlatformAuthMe` уже згенерований): email, name,
  createdAt. Форми немає: `PATCH` для `platform_users` не існує.
  Явний рядок-підпис «змінюється адміністратором платформи» (i18n-ключ), щоб
  порожнеча читалась як рішення, а не як недороблене.
- `pages/user-settings/appearance.tsx` — копія з web: `ThemeSwitcher` +
  `ThemeSelect` у `ContentSection`.
- `locales/en/user-settings.json` — новий namespace, підключити в `i18n/index.ts`.
- Вхід — пункт `User settings` у дропдауні аватара (`account-footer.tsx`), як у
  web.

### Крок 9 — i18n-звірка

`i18n/index.ts` реєструє новий `user-settings`; `layout.json` отримує `areas.*`,
`nav.*`, `theme.palette*`. Тексту в коді не лишається (доктрина). Множина — лише
суфікси `_one`/`_other` (граблі календаря: форма `*_plural` у i18next 26 не
резолвиться і мовчки падає на базовий ключ).

### Крок 10 — перевірка

```bash
pnpm lint && pnpm typecheck && pnpm build          # 6/6 таргетів
pnpm platform:test:e2e                              # 11 + 2 нових
pnpm api:test:e2e                                   # не чіпали, але контракти спільні
```

`pnpm typecheck` після зміни `include`/paths ганяти з `--force` — turbo віддає
закешований зелений результат (граблі CLAUDE.md).

Браузерний прогін — `pnpm platform:dev` (Nest, :3002) + `pnpm platform:web:dev`
(Vite, :5174):

1. Логін оператором (`platform@example.com` / `Platform12345`).
2. Рейл: дві іконки + бренд + аватар у нижній смузі; підказки на іконках
   показуються В ОБОХ станах згортання.
3. Cmd+B / `SidebarTrigger` ховає ДРУГУ колонку, рейл лишається; cookie
   `sidebar_state` переживає F5.
4. Три `h-14` (шапка рейлу, шапка колонки, хедер) складають одну неперервну
   лінію; у згорнутому стані бренд-плитка й аватар НЕ стискаються і не з'їжджають
   (граблі §7.1).
5. `/` → `/tenants`; `/jobs?state=failed` → `/operations/jobs?state=failed`
   (фільтр не загубився); `/tenants/<id>` відкривається прямим посиланням.
6. `/tenants`: пошук, фільтр статусу, сортування, пагінація живуть в URL і
   переживають F5; Suspend через row action із підтвердженням; suspended рядок
   приглушений.
7. `/operations/jobs`: таблиця впирається в краї (`bleed`), автооновлення 5с не
   блимає (затемнення по `isPlaceholderData`), «View details» відкриває праву
   панель, вона СТИСКАЄ контент, а не накриває; горизонтального скролу в панелі
   немає.
8. `/user-settings` із дропдауна аватара; перемикач палітри міняє тему і
   переживає F5 без кадру дефолтної теми (блокувальний скрипт).
9. Прокрутка: вікно не скролиться, смуга оверлейна і згасає; перехід між
   сторінками скидає прокрутку на початок; з довгої сторінки на коротку смуга не
   залипає.
10. 404: `/operations/nope` малюється ВСЕРЕДИНІ шела; `/nonsense` — так само;
    гість на будь-якому з них летить на `/login`.
11. Консоль браузера чиста (особливо `MenuGroupContext is missing` і
    попередження про другий портал у хедері).

### Крок 11 — документи

- **`docs/frontend/app-shell.md`** — новий розділ «Шел `apps/platform-web`»:
  таблиця area, що скопійовано дослівно, що свідомо різне, і чому екстракція в
  `libs/ui` відкладена. Плюс правка §6 (там сказано «у `libs/ui` не переїхало
  нічого… доки platform-web має одну area» — тепер це твердження треба
  переписати) і згадки про дропдаун профілю в `app-rail.tsx` (він давно в
  `account-footer.tsx`).
- **`CLAUDE.md`** — блок `apps/platform-web` в «Архітектурі»: зняти «Tenants —
  плоска таблиця (НЕ createDataGrid)» і «інша UI-бібліотека» (вона вже спільна),
  описати два рівні навігації і склад area; у «Зафіксованих рішеннях» — рядок
  про парність шелів.
- **`docs/frontend/README.md`** — якщо в списку відкритих питань є пункт про
  розбіжність фронтів, закрити його.
- **`docs/multi-tenancy-architecture.md`** — якщо там описано `GET /tenants` як
  «без пагінації», синхронізувати.

---

## 4. Порядок і чому саме такий

Крок 1 перший, бо без нього крок 5 упирається в контракт. Кроки 2–4 разом дають
компільований шел (роутер і шел не збираються окремо: `paths.ts` типізує `Link`,
а роутер рендерить `AppShell`). Кроки 5–8 — сторінки, кожна незалежна, можна
комітити окремо. Кроки 10–11 не переносяться «на потім»: без оновлених доків
наступна ітерація почне з розбіжності між кодом і описом.

---

## 5. Поза скоупом цієї ітерації

- **Area «Playground»** у platform-web. Каталог примітивів уже є в tenant-порталі
  (`/playground/components/*`) і покриває ту саму `libs/ui`; другий екземпляр —
  дубль без споживача. Заводити, лише коли з'явиться platform-специфічний
  компонент.
- **Екстракція шела в `libs/ui`.** Після цієї ітерації буде видно, що справді
  однакове: найімовірніші кандидати — `area-nav.tsx` (потрібен generic по
  `NavPath`), `RAIL_*`-константи, композиція `app-shell.tsx` з інжекцією
  «рейл/колонка/футер/хедерні кнопки». Робити третім ходом, коли з'явиться
  третій споживач або коли файли справді зійдуться побайтово (сценарій UI-0).
- **Друга колонка Tenants як список тенантів** (модель VS Code/Slack: список у
  колонці, деталі в контенті). Природна евлюція, але це редизайн, а не
  вирівнювання; спершу парність.
- **EDA-2** (DLQ, replay, лаг черг) — area Operations готує для цього місце, але
  сам екран поза скоупом.
- **`POST /auth/logout` і refresh для платформи** — окремий безпековий хід
  (`docs/auth-hardening-plan.md`).
- **Presence / сповіщення / activities в platform-web** — інший plane, окрема
  розмова про те, чи платформа взагалі має це бачити.

---

## 6. Граблі, які вистрелять саме тут

1. **Кожне перевизначення геометрії кнопки рейлу треба дублювати з
   `group-data-[collapsible=icon]:`.** `sidebarMenuButtonVariants` містить
   `group-data-[collapsible=icon]:size-8!` і `:p-2!`; голі `size-10!`/`p-0!` їм не
   конкуренти (різні модифікатори → tailwind-merge лишає обидва). Симптом видно
   ЛИШЕ на бренд-плитці й аватарі, іконки його не показують. Копіювати
   `RAIL_ANCHOR_BUTTON` / `RAIL_NAV_BUTTON` цілком, не «спрощувати».
2. **`AreaSidebar` мусить мати `min-w-0` і `w-auto flex-1`.** Без `min-w-0`
   колонка відмовляється стискатися нижче min-content і виїжджає за межу шела,
   а `overflow-hidden` це зрізає — виглядає як «вміст сховався за лінією».
3. **Tooltip у рейлі — `{ children, hidden: isMobile }`.** Реєстровий
   `SidebarMenuButton` показує підказку лише при `state === 'collapsed'`, а
   `useSidebar()` віддає стан ЗОВНІШНЬОГО сайдбара — інакше підказки не буде
   ніколи, хоча підписів у рейлі не видно взагалі.
4. **Активний пункт рейлу — `button`, неактивний — `Link`.** Перехід на префікс
   із глибокого шляху (`/operations/queues` → `/operations`) викинув би на Jobs.
   Робити одним `Link` із `preventDefault` не можна: порядок склеювання
   обробників між `useRender` і `Link` не гарантований.
5. **Один `SidebarProvider` на обидві колонки.** Другий = другий cookie і
   зламаний Cmd+B.
6. **`DropdownMenuLabel` вимагає `DropdownMenuGroup`.** У Base UI це
   `MenuPrimitive.GroupLabel`, без групи — рантайм-помилка `MenuGroupContext is
missing`. Компілятор її не бачить: кожен перенесений дропдаун ВІДКРИВАТИ руками.
7. **`PageHeader` і `PageBreadcrumbs` — рівно один на екран.** Слот у хедері
   один; два портали промалюються ПОРУЧ, і провайдер лише кричить у консоль.
8. **`Crumb.to` типізований як `string`** — крихти компілятор НЕ перевіряє. Після
   переїзду `/jobs` → `/operations/jobs` правити вручну (на відміну від `Link to`
   і `useParams({ from })`, які падають самі).
9. **Boolean-фільтри в URL і query API їдуть РЯДКОМ `'true'/'false'`.** Не
   переюзати transform-схему контрактів у route-схемі — вона дає `boolean`, а це
   wire-формат.
10. **`ScrollArea`: висота через flex, не `h-full`/`absolute inset-0`.** Корінь
    `flex flex-col`, viewport `min-h-0 flex-1`. `h-full` мовчки стає
    `height: auto` під предком з `max-height`. Обгортка
    `ScrollAreaPrimitive.Content` обов'язкова — без неї смуга залипає при зміні
    висоти вмісту без зміни розміру viewport.
11. **Chrome морозить `ResizeObserver` і не доставляє drag-жести у ФОНОВІЙ
    вкладці.** Перед пошуком регресії в скролі чи перетягуванні —
    `document.visibilityState`.
12. **`pnpm db:*` і `api:test:e2e` не ганяти з піднятим dev-стеком** — вичерпання
    пулу конекшенів дає випадкові падіння в СУСІДНІХ сьютах.
