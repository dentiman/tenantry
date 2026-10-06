# Реєстри, що накопичують фічі

Стан на **2026-10-05**. Доповнення до `docs/modules.md`: там граф модулів і те, що бачить
`pnpm modules:check` (імпорти). Тут — звʼязки, яких він **не бачить**: спільні файли нижчих
модулів, у які фічі дописують свої типи, тексти чи логіку.

Метод аудиту: прохід по всіх файлах `apps/` і `libs/` з пошуком згадок фіч (`calendar`, `chat`,
`ai`, `customers`) у файлах, що за `modules.config.ts` належать іншим модулям; кожен збіг
перевірено вручну (більшість — коментарі з посиланням на docs).

## 1. Правило: проводка лишається, визначення переїжджають

Кожен центральний файл оцінюється чотирма питаннями:

1. Що в ньому — **визначення фічі** (payload-схеми, тексти, бізнес-дефолти, логіка) чи
   **проводка** (посилання на визначення + операційні налаштування)?
2. Чи є огляд «усе в одному місці» **свідомою цінністю** (налагодження, рев'ю безпеки, порядок
   меню)?
3. Скільки чужих файлів правитиме кожна **нова фіча**?
4. Фічу видалили, рядок лишився — **голосно** (компіляція / старт) чи **тихо** (мертві дані)?

Проводку лишаємо центральною — це маніфест, і його огляд цінний. Визначення фіч, що потрапили в
центральний файл, переносимо до власника; центральний файл стає root-ом, який їх збирає
(`docs/modules.md` §5). Слот — окремий інструмент: для **компонента** фічі в чужому екрані.

У кожного розширюваного механізму три ролі:

| Роль           | Хто                                | Що тримає                                               |
| -------------- | ---------------------------------- | ------------------------------------------------------- |
| **Механізм**   | платформний модуль (notifications) | форму визначення, хелпер `define…`, рантайм, generic UI |
| **Визначення** | фіча (calendar)                    | свої типи, payload-схеми, тексти, дефолти               |
| **Збірка**     | composition root                   | перелік визначень фіч — рядок на фічу                   |

**Іменування.** Суфікс файлу визначень = механізм, який його читає, і збігається з функцією
`define…` у ньому: `calendar.notifications.ts` (`defineNotificationTypes`),
`calendar.activities.ts` (`defineActivityTypes`), `calendar.socket-events.ts`
(`defineSocketEvent`). Не `realtime`: слово «event» у репо зайняте тричі (`CalendarEvent`,
messaging, сокет), а `socket-events` одразу каже про транспорт — те, що летить у браузер.

## 2. Що переносимо

### R1. Типи сповіщень і активностей — **зроблено 2026-10-05**

Найбільший реєстр і росте з кожною фічею: payload-схеми, дефолти, категорії й тексти фіч лежать
у модулях `notifications` / `activities`, а фронтенд дублює перелік типів руками
(`KNOWN_TYPES`).

**Контракти — сповіщення** (`libs/contracts/src/notification/notification.schema.ts`:
`NOTIFICATION_TYPES` + `…_PAYLOAD_SCHEMAS` + `…_TYPE_META`):

| Звідки                                                                         | Куди                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `user.created`, `user.password_changed`, `user.welcome`                        | `libs/contracts/src/user/user.notifications.ts`         |
| `auth.new_device`, `auth.session_reuse_detected`                               | `libs/contracts/src/auth/auth.notifications.ts`         |
| `customer.assigned`                                                            | `libs/contracts/src/customer/customer.notifications.ts` |
| `calendar_event.*` (5 типів) + категорія `calendar`                            | `libs/contracts/src/calendar/calendar.notifications.ts` |
| `defineNotificationTypes`, тип визначення, категорії `organization`/`security` | лишається в `notification/`                             |
| збірка → `NOTIFICATION_TYPES`, схеми, meta, категорії                          | root `libs/contracts/src/notification-types.ts`         |

**Контракти — активності** (`libs/contracts/src/activity/activity.schema.ts`, `ACTIVITY_TYPES`):

| Звідки                                           | Куди                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| `user.*` (6 типів)                               | `libs/contracts/src/user/user.activities.ts`         |
| `email.sent`                                     | `libs/contracts/src/auth/auth.activities.ts`         |
| `customer.*` (5 типів)                           | `libs/contracts/src/customer/customer.activities.ts` |
| `settings.updated`, `settings.numbering_shifted` | `libs/contracts/src/settings/settings.activities.ts` |
| `calendar_event.*` (8 типів)                     | `libs/contracts/src/calendar/calendar.activities.ts` |
| `defineActivityTypes`                            | лишається в `activity/`                              |
| збірка → `ACTIVITY_TYPES`                        | root `libs/contracts/src/activity-types.ts`          |

**Тексти** — у namespace модуля, що володіє типом (`apps/web/src/locales/en/`):

| Звідки (`libs/i18n/…/notifications.json`, `activities.json`)                                                                    | Куди                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `type.calendar_event.*`, `settings.label.calendar_event.*`, `settings.category.calendar`, `activities:calendar_event.*`         | `calendar.json` → `notifications.*`, `activity.*`  |
| `type.customer.*`, `settings.label.customer.*`, `activities:customer.*`                                                         | `customers.json` → `notifications.*`, `activity.*` |
| тексти центрів (заголовки, фільтри, кнопки), платформні типи (`user.*`, `auth.*`, `settings.*`, `email.*`), `system`, `unknown` | лишаються                                          |

Тексти платформних типів лишаються в спільних файлах: notifications і activities — теж
платформа, а розносити їх по `users.json` / `auth.json` означало б тягнути тексти інбокса в
неймспейси екранів логіну без жодного виграшу для форку. Переносяться лише тексти фіч рівнів
`core` і `feature`.

Разом із цим — тексти **екранів** фіч, що лежать у чужому неймспейсі: `settings.json` →
`calendar.*` (сторінка `/settings/calendar`) і `ai.*` (`/settings/ai`) переїжджають у
`calendar.json` / `ai.json`. Підписи пунктів меню (`nav.*`, `layout.json`) лишаються біля меню.

**Рантайм:**

| Звідки                                                                                 | Що стає                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `notification-message.tsx`: `KNOWN_TYPES`, вибір subject-а                             | читає визначення типу (неймспейс текстів, ключ subject-а); `KNOWN_TYPES` зникає |
| `activity-message.tsx`: `KNOWN_TYPES`, `if (customer.owner_changed && owner === null)` | те саме; спецвипадок — поле визначення                                          |
| `notification-preferences.tsx`                                                         | категорії й підписи — з реєстру                                                 |
| recorder-и в `libs/shared` (валідація payload-а)                                       | логіка та сама, схеми — з root-а                                                |

Ризик: `NotificationType` стає виведеним із root-а — union має лишитися точним, інакше
`satisfies Record<NotificationType, …>` перестане ловити забутий тип.

### R2. Події сокета — **зроблено 2026-10-05**

`REALTIME_EVENTS` як перелік — корисний огляд протоколу, лишається (у root). Переїжджають схеми
й методи емітерів, що знають фічі:

| Звідки                                                                           | Куди                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `realtime.schema.ts` / `.types.ts`: `calendarEventChanged` + схеми               | `libs/contracts/src/calendar/calendar.socket-events.ts`                      |
| те саме: `aiMessageDelta`, `aiMessageCompleted`, `aiConversationChanged` + схеми | `libs/contracts/src/ai/ai.socket-events.ts`                                  |
| `presence.*`, `auth.*`, `realtime.resync-required`, `notification.*`             | лишаються в `realtime/`                                                      |
| `defineSocketEvent(name, schema)`                                                | `libs/contracts/src/realtime/` (механізм)                                    |
| збірка `REALTIME_EVENTS` = платформні + фіч                                      | root `libs/contracts/src/socket-events.ts`                                   |
| `realtime.emitter.ts`: `calendarEventChanged()`, `aiConversationChanged()`       | generic `toUser(tenantId, userId, event, payload)`; виклики — у сервісах фіч |
| `worker-realtime.emitter.ts`: `aiDelta()`, `aiCompleted()`                       | те саме                                                                      |

### R6. Дефолтний канал чату при появі тенанта — **зроблено 2026-10-05**

Логіку чату пишуть три місця: `platform-api` `tenants.service.create()` (канал, членство адміна,
системні записи — прямо в таблиці чату, порушення `docs/backend-conventions.md` §1), сід і
`DefaultChannelService.ensureMembership` в api.

| Звідки                                                                             | Куди                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| створення каналу й членства з `tenants.service.create()`, сіду, `ensureMembership` | один провізіонер `libs/shared/src/chat/default-channel.ts` (модуль chat): `ensureDefaultChannel`, `joinDefaultChannel` |
| _(нове)_ `TenantLifecycleHooks` (in-tx, як `UserLifecycleHooks`)                   | `apps/platform-api/src/tenants/tenant-lifecycle.hooks.ts`                |
| _(нове)_ реєстрація хука                                                           | модуль chat у control plane `apps/platform-api/src/chat/`                |
| сід                                                                                | кличе той самий провізіонер                                              |

### R3. Маршрути й вкладені лейаути — **зроблено 2026-10-06**

Зроблено разом із переходом фронтенду на `features/<модуль>/`: визначення маршрутів — у
`features/<модуль>/<модуль>.routes.tsx` (оболонка — `app-shell/app.routes.tsx`, гейти — 
`features/auth/auth.guards.ts`), `router.tsx` лише збирає дерево. Перша фіча-вкладка за цим
патерном — «Events» календаря на картці клієнта (`customerEventsRoute`, слот `customerDetailTabs`).

**Як працює ієрархія.** Маршрут = компонент; дочірній маршрут рендериться в `<Outlet/>` батька
(той самий механізм, що `<router-outlet>` в Angular). Маршрут без `component` прозорий — лише
групує URL і тримає `beforeLoad` / `staticData`. Сусіди замінюють одне одного, діти вкладаються.
Іменованих outlet-ів у TanStack Router немає: те, що сторінка кладе поза центральну область
(хедер, права панель), іде порталами — `PageHeaderSlot`, `ContextPanelPortal`.

**Правило розкладки.**

1. **Маршрути модуля — у його теці**: `features/<модуль>/<модуль>.routes.tsx` — визначення
   (`createRoute`, `validateSearch`, `beforeLoad`, `staticData`, search-схеми й їхні типи).
2. **Дочірній маршрут імпортує батьківський з модуля нижче** — це звичайне ребро вниз за графом.
   Маршрут фічі може висіти під чужим лейаутом: `settingsCalendarRoute` (календар) — під
   `settingsRoute` (settings); білінг — під карткою клієнта.
3. **Збирає дерево лише root `router.tsx`**: `addChildren` по всіх модулях — рядок на модуль.
   Модуль нижче не знає, хто до нього причепився: про вкладку фічі на його екрані він дізнається
   зі слота, а про маршрут — нічого.
4. Типи (`Link to`, `useParams({ from })`, `useSearch`) TanStack Router виводить із зібраного
   дерева — так само, як зараз в одному файлі: імпорт батьківського маршруту дає точний тип
   батька. Фабрика `routes(parent)` потрібна лише там, де імпорт батька дав би цикл.

**Приклад — фіча на картці клієнта** (білінг — майбутній; так само вже зроблена вкладка «Events» календаря):

```
appRoute (AppShell)
└─ /workspace
   └─ customers/$customerId     CustomerDetailLayout: шапка + вкладки + <Outlet/>   ← customers
      ├─ /                      огляд                                             ← customers
      ├─ contacts               контакти                                          ← customers
      └─ billing                CustomerBilling + <Outlet/>                       ← billing
         ├─ /                   рахунки клієнта                                   ← billing
         └─ invoices/$invoiceId рахунок усередині картки клієнта                  ← billing
```

```tsx
// features/customers/customers.routes.tsx — модуль нижче, про білінг не знає
export const customerDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers/$customerId',
  component: CustomerDetailLayout, // <CustomerHeader/> <SlotOutlet slot={customerDetailTabs}/> <Outlet/>
});
// features/customers/customer-detail-slots.ts
export const customerDetailTabs = defineSlot<{ customerId: string }>('customers.detail-tabs');

// features/billing/billing.routes.tsx — фіча, ребро billing → customers
export const customerBillingRoute = createRoute({
  getParentRoute: () => customerDetailRoute,
  path: 'billing',
  component: CustomerBilling,
});

// router.tsx — composition root
customerDetailRoute.addChildren([customerOverviewRoute, customerContactsRoute, customerBillingRoute]);
// slot-fills.ts
fillSlot(customerDetailTabs, 'billing', BillingTab);
```

Прибрати фічу з форку = прибрати її рядок у `router.tsx` і `slot-fills.ts`; вкладка зникає, URL
перестає існувати, а забуте типізоване посилання ламає компіляцію.

## 3. Свідомо лишаємо центральними

| Що                                                             | Чому                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/messaging/topology.ts`                        | задуманий маніфест черг: усі споживачі, налаштування й cron в одному місці; продюсер мусить знати споживачів у момент `publish`; розсинхрон валить воркер. Визначення повідомлень уже у власників (`*.messages.ts`) |
| ліміти запитів (`throttle.config.ts`, `RATE_LIMITS`)           | рев'ю безпеки бачить усі пороги разом; AI — рядок конфігу, не логіка                                                                                                                                                |
| `areas.tsx`, меню settings, `entity-routes.ts`, `paths.ts`     | меню й мапи: порядок — рішення UX; шляхи типізовані — забута фіча ламає компіляцію                                                                                                                                  |
| нумерація (`NUMBER_SERIES_NAMES = ['customer']`)               | закрита таблиця конфігу з одним рядком; повернутися, коли серій стане 3+                                                                                                                                            |
| сід як один скрипт                                             | розбивати нема сенсу; після R6 кличе спільний провізіонер чату                                                                                                                                                      |
| `aiAllowed` на тенанті (control plane)                         | платформне керування фічею (AI-5). Коли зʼявиться друга фіча з дозволом на тенант — загальні entitlements тенанта («тенант × фіча»), а не слот під кожну                                                            |
| Prisma back-relations у `Tenant` / `User`                      | Prisma вимагає обидві сторони звʼязку (`docs/modules.md` §6)                                                                                                                                                        |
| `User.timeZone`                                                | загальна властивість людини (формат дат, листи), не календарні дані                                                                                                                                                 |
| `app.module.ts`, `worker.module.ts`, barrel-и, `i18n/index.ts` | чисті переліки — роль root-а                                                                                                                                                                                        |
| `guide`, `playground`                                          | демо-фічі верхнього рівня: показувати все — їхня робота                                                                                                                                                             |

## 4. Порядок

1. **R1** — сповіщення й активності + тексти екранів фіч.
2. **R2** — події сокета.
3. **R6** — провізіонер дефолтного каналу.
4. **R3 Маршрути** — зроблено 2026-10-06 разом із переходом фронтенду на `features/`.

Кожен крок — окремий коміт; `pnpm lint`, `pnpm typecheck` і `bash scripts/ci-verify.sh` зелені;
після кроку рядок переїжджає в `docs/modules.md` §7 «закрито».
