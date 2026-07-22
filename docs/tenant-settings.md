# Налаштування тенанта (System Settings) — пропозиція

Налаштування, що живуть **на сутності тенанта** й читаються/редагуються з обох plane-ів:
tenant-адмін (data plane, `apps/api` + `apps/web`) і платформа-оператор (control plane,
`apps/platform-api` + `apps/platform-web`). Приклади: імʼя тенанта, валюта, локаль, набір
увімкнених модулів, branding, згодом SMTP.

Статус: **пропозиція** (не реалізовано). Перша вертикаль до реалізації — `general`
(name + currency). Документ фіксує рішення, за якими реалізовуватимемо.

Це **не** RBAC-документ і **не** білінг: план/квоти/entitlements згадані лише як приклад
platform-only полів; їхній дизайн — у беклозі MT-4.

## Головна абстракція: секція — це вигляд, а не сховище

API оперує **секціями** (`general`, `email`, `features`, `branding`…). Сховище — **суміш
типізованих колонок `Tenant` і namespace-ключів у `Tenant.settings Json`**. Сервіс/мапер
збирає DTO секції з того, де фізично лежить кожне поле.

Наслідок, що знімає ризик вибору сховища: **місце зберігання поля — приватна деталь
реалізації**. Wire-контракт `GET/PUT /system-settings/:section` не залежить від того,
колонка це чи json. Поле можна почати в `settings Json` і **підвищити до колонки пізніше**
(коли зʼявиться потреба запитувати/констрейнити) без зміни контракту й коду фронта.

## Зафіксовані рішення

| Питання | Рішення |
| --- | --- |
| Розміщення (tenant-api) | Модуль `apps/api/src/settings/` за шаблоном `users/` (DTO→Service→Mapper→Controller) |
| База роуту | `system-settings` (**kebab**, не `system_settings`) — конвенція репо (`download-url`, `generate-thumbnail`) + UI-лейбл «System Settings» |
| Секція | Сегмент шляху: `GET/PUT /system-settings/general`, `/system-settings/email`, `/system-settings/features` |
| Дієслово збереження | **PUT** (повна заміна секції — ідемпотентно), не POST. GET — читання секції |
| Контракти | `libs/contracts/src/settings/`, реекспорт з `index.ts` (споживає `apps/web` → tenant-plane, не platform-subpath) |
| Сховище | **Гібрид, рішення per-field у момент появи поля.** Кожне нове бізнес-поле/секцію кладемо в колонку чи `settings Json` за евристикою нижче — наперед не вирішуємо. Скалярні/універсальні/потенційно-запитувані → колонки; вкладені/опційні/feature-flag → `settings Json` |
| RBAC | **Поки НЕ вводимо.** `GET/PUT` доступні всім автентифікованим користувачам тенанта. Розділення USER vs ADMIN повернемо разом із загальним RBAC (беклог) |
| Bootstrap | Окремий `GET /system-settings/bootstrap` — read-only курований зріз для SPA (усі ролі) |
| Запис як подія | Зміна секції пише активність `settings.updated` у тій самій `withTenantTx` (Activity Log) |
| Control plane | Оператор редагує ті самі `tenant`-scoped поля через наявний `PATCH /tenants/:id` (`SystemPrismaService`, BYPASSRLS) — окремого settings-ендпоінта на платформі не заводимо |

## Сховище: колонка vs `settings Json`

Рекомендація — **гібрид**, не «все в JSON» і не «все в колонки». Кожне поле вирішується
за евристикою.

**Колонка, коли поле:**
1. запитується/фільтрується/сортується **між тенантами** (платформа: «усі тенанти з
   `currency=EUR`», звіти, білінг);
2. має жорсткий констрейнт — enum / FK / `NOT NULL` / unique / `CHECK`;
3. стабільне й універсальне — є в кожного тенанта, форма поля не змінюється;
4. бере участь у логіці БД — default, generated-колонка, join.

**`settings Json`, коли поле:**
1. згруповане/вкладене — smtp-блок, branding-блок це обʼєкт, а не скаляр;
2. опційне/розріджене або feature-flag-подібне — мапа `boolean`, часто змінюється;
3. БД його ніколи не запитує — застосунок читає секцію цілком;
4. швидко ітерується/експериментальне — не хочемо міграцію на кожен тумблер.

**Чому не все в JSON:**
- немає БД-констрейнтів — валідація лише в застосунку (Zod); сирий SQL/інший райтер покладе сміття;
- слабка типізація в Prisma (`JsonValue` + касти);
- дорогі запити/індекси (GIN/expression) — «знайти тенантів з валютою X» стає хаком;
- **merge-hazard**: конкурентні `PUT` різних секцій затирають сусідні ключі — треба tx / jsonb-merge;
- секрети (smtp-пароль) у plaintext jsonb — погано; шифрувати/зберігати окремо.

**Чому не все в колонки:**
- міграція (expand→backfill→notnull) на кожне дрібне/експериментальне поле;
- широка розріджена таблиця з nullable-колонками під рідкі опції;
- вкладені групи (smtp) погано лягають на скаляри.

**Правило за замовчуванням:** сумніваєшся → клади в `settings Json`, промоуть у колонку за потреби.

Рішення **не приймається наперед для всіх майбутніх полів** — воно ухвалюється per-field у
момент, коли зʼявляється конкретне бізнес-поле чи секція. Секційна абстракція гарантує, що
пізніше перенесення поля JSON→колонка не ламає контракт. Таблиця нижче — лише поточно відомий
набір, а не закритий список.

**Розподіл поточно відомих полів:**

| Поле | Де | Чому |
| --- | --- | --- |
| `name` | колонка (є) | універсальне, показується скрізь |
| `locale` | колонка (є) | дефолт нових юзерів, читає бекенд |
| `currency` | **нова колонка** | закритий enum ISO-4217, потенційно для звітів/білінгу платформи |
| `timezone` (згодом) | колонка | скаляр, універсальне |
| `features`/модулі | `settings.features` | мапа boolean, часто змінюється, БД не запитує |
| `branding` (лого/кольори) | `settings.branding` | вкладений опційний обʼєкт |
| `email`/`smtp` (згодом) | `settings.email` | вкладений обʼєкт; секрети — шифрувати окремо |
| план/квоти/entitlements (platform-only, згодом) | скоріше колонки | білінг/звіти їх запитують |

## Безпека: розмежування даних

Налаштування лежать на рядку `Tenant`; обидва plane-и до нього тягнуться з різною владою.
Розмежування — кілька незалежних шарів (шар RBAC поки **вимкнено**, решта діють):

1. **Межа plane-ів (діє).** Різні JWT-секрети (`JWT_SECRET` vs `PLATFORM_JWT_SECRET`) — токен
   tenant-api не пройде verify у platform-api. Platform-only поля просто **не мають
   data-plane-ендпоінта** — редагуються лише через tenant-CRUD control plane.
2. **RLS `own_tenant` (діє).** Tenant-користувач фізично не прочитає/не змінить чужий рядок
   `tenants` (`id = current_setting('app.tenant_id')`). Сервіс інжектить звичайний
   `PrismaService`, **без ручного tenant-фільтра**; RLS — подвійний запобіжник.
3. **Scope на рівні контракту (діє).** Кожне поле має editability scope: `tenant` (редагують і
   адмін data plane, і оператор), `platform` (тільки оператор), `readonly` (похідні). Data-plane
   схема секції містить **лише `tenant`-scoped поля** — платформенні неможливо прислати, бо їх
   немає в DTO.
4. **RBAC USER vs ADMIN (ВІДКЛАДЕНО).** Наразі `GET/PUT /system-settings/*` доступні будь-якому
   автентифікованому користувачу тенанта. Trade-off: звичайний USER тимчасово може редагувати
   налаштування свого тенанта; чужий тенант і platform-поля лишаються захищені (шари 1–3).
   Guard `@Roles('ADMIN')` (на базі наявного `role` у `JwtPayload`) додамо разом із загальним
   RBAC — тоді ж bootstrap лишиться для всіх, а редактор звузимо до ADMIN.

## RLS та транзакційність на бекенді

- Читання/запис власного рядка: `this.prisma.tenant.update({ where: { id: actor.tenantId }, data })`
  — RLS `own_tenant` скоупить автоматично.
- Json-секція = **read-modify-write у `TenantTransactions.withTenantTx`** (щоб не затерти сусідні
  секції в `settings`), або jsonb-merge `settings || '{...}'`. Голий `$transaction` заборонений
  ESLint-ом (обходить tenant-extension).
- Зміна пише активність `settings.updated` у тій самій транзакції (фід ніколи не бреше).
- Control plane пише через `SystemPrismaService` (BYPASSRLS), як наявний `TenantsService`.

## Bootstrap / «гарячі» налаштування

`GET /system-settings/bootstrap` — read-only курований зріз, доступний **будь-якому
автентифікованому** (не лише адміну), який SPA вантажить один раз на старті й кладе в Zustand:

```jsonc
{ "tenant": { "name": "...", "locale": "en", "currency": "USD", "timezone": null },
  "features": { "billing": true, "tickets": false } }
```

Без секретів. Фронт бере його для форматування валюти, feature-gating UI, дефолтної локалі.
Розмежування: `bootstrap` — дешевий публічно-безпечний снапшот для всіх; `:section` GET/PUT —
редактор. Стор оновлюється після успішного PUT.

## Frontend

- Роут `/settings` → сторінка «System Settings», вкладки по секціях.
- Кожна секція — проста RHF-форма за наявним патерном (`login.tsx` / `create-user-modal.tsx`):
  `zodResolver(GeneralSettingsSchema)` + orval-хуки `useSystemSettings*`, `defaultValues` з GET,
  `applyServerError` на submit, інвалідація ключа після PUT.
- Bootstrap-стор (Zustand) підвантажується при вході; після PUT — інвалідація/оновлення.

## Перша вертикаль (name + currency)

1. **Міграція:** `Tenant.currency String @default("USD")` (як `locale`). RLS не чіпаємо — поле на
   наявному рядку.
2. **Контракти** `libs/contracts/src/settings/`: `GeneralSettingsSchema` (`name`, `currency` —
   ISO-4217, `locale`), `SystemSettingsBootstrapSchema`; реекспорт з `index.ts`.
3. **tenant-api** `settings`-модуль: `GET/PUT /system-settings/general` +
   `GET /system-settings/bootstrap` (обидва — будь-який auth поки що).
4. **control plane:** `UpdateTenantSchema` += `currency` (name/locale/isActive уже є) — оператор
   редагує через наявний `PATCH /tenants/:id`.
5. **web:** сторінка `/settings` з General-формою + bootstrap-стор.
6. `openapi:generate` → `web:codegen`; e2e (RLS-ізоляція налаштувань між тенантами, bootstrap-доступ,
   PUT оновлює й пише активність).
7. Оновити цей документ статусом «реалізовано».

## Беклог

- **RBAC** `@Roles('ADMIN')` на редактор (bootstrap лишається для всіх) — коли писатимемо ролі.
- Секції `email`/`smtp` — з шифруванням секретів (не plaintext jsonb).
- Секція `features`/модулі — джерело для feature-gating на фронті й гейтингу модулів на бекенді.
- `branding` — лого через файлову підсистему (`avatarFileId`-патерн), кольори теми.
- Platform-only поля (план/квоти/entitlements) — дизайн разом із білінгом (MT-4).
- Валідація значень секцій на рівні реєстру типів (аналог payload-валідації Activity Log).
