# Мультитенантність — архітектура «як є» (2026-07-18)

> Це **єдиний документ** про мультитенантність у цьому репозиторії — довідник поточного стану,
> що реально існує в коді зараз, як воно працює і чому саме так. Історія переходу (MT-0…MT-3,
> покроковий план, дати) видалена після завершення фаз — вона зробила свою справу; те, що з неї
> лишилось цінним (обґрунтування рішень, дизайн ще не реалізованих шматків), перенесено в
> відповідні розділи нижче й у [MT-4/беклог](#мт-4беклог-свідомо-не-зроблено).
>
> Реалізовано: MT-0…MT-3 (ролі БД → фундамент tenant-контексту → RLS → control plane, разом
> з UI обох plane-ів). Статус фаз — у [roadmap.md](roadmap.md).

## Зміст

1. [Головний принцип](#1-головний-принцип-невидимість)
2. [Топологія: два plane-и, п'ять застосунків](#2-топологія-два-plane-и-пять-застосунків)
3. [Схема БД](#3-схема-бд)
4. [Ролі Postgres](#4-ролі-postgres)
5. [RLS: політики й `resolve_tenant`](#5-rls-політики-й-resolve_tenant)
6. [Механіка контексту: від HTTP-запиту до рядка в БД](#6-механіка-контексту-від-http-запиту-до-рядка-в-бд)
7. [Auth: два незалежні auth-и](#7-auth-два-незалежні-auth-и)
8. [Черги: tenant-scope і system-scope](#8-черги-tenant-scope-і-system-scope)
9. [Storage, логи, контракти](#9-storage-логи-контракти)
10. [Наскрізний приклад: create user до welcome-листа](#10-наскрізний-приклад-create-user-до-welcome-листа)
11. [Контракт для нового доменного модуля](#11-контракт-для-нового-доменного-модуля)
12. [Тестування ізоляції](#12-тестування-ізоляції)
13. [MT-4/беклог (свідомо не зроблено)](#мт-4беклог-свідомо-не-зроблено)

---

## 1. Головний принцип: невидимість

Доменний код (`users`, `customers`, майбутні `tickets`) **не знає про tenant-и**. Не пише
`where: { tenantId }`, не передає `tenantId` у `create`, не інжектить нічого з `tenant/`.
Ізоляцію повністю бере на себе інфраструктура: Postgres RLS фільтрує читання, DB-default
заповнює колонку на запис.

```ts
// Так виглядає РЕАЛЬНИЙ доменний код (apps/api/src/users/users.service.ts) —
// жодної згадки tenantId, попри те що users — tenant-scoped таблиця
async findAll(query: UserQuery) {
  return this.prisma.user.findMany({ where: buildWhere(query), ... }); // без tenantId
}
async create(data: CreateUser) {
  return this.prisma.user.create({ data: { ...rest, passwordHash } }); // без tenantId
}
```

**Перевірюваний критерій**: `grep -rn "tenantId" apps/api/src --include='*.service.ts'` не
знаходить нічого, крім `auth.service.ts` (легальне виключення — видача JWT і резолюція
refresh-токена, це і є auth-специфічна робота). Якщо `tenantId` з'явився в новому доменному
сервісі — це протікання абстракції, а не нормальний код.

## 2. Топологія: два plane-и, п'ять застосунків

| Застосунок          | Роль                      | Порт         | БД-роль                                     | Auth                                 |
| ------------------- | ------------------------- | ------------ | ------------------------------------------- | ------------------------------------ |
| `apps/api`          | Data plane — tenant API   | 3001         | `saas_app` (RLS діє)                        | tenant JWT (`JWT_SECRET`)            |
| `apps/web`          | Data plane — tenant UI    | 5173         | —                                           | той самий tenant JWT                 |
| `apps/worker`       | Data plane — фонові джоби | — (без HTTP) | `saas_app` + `saas_platform` (system-джоби) | —                                    |
| `apps/platform-api` | Control plane — API       | 3002         | `saas_platform` (BYPASSRLS)                 | platform JWT (`PLATFORM_JWT_SECRET`) |
| `apps/platform-web` | Control plane — UI        | 5174         | —                                           | той самий platform JWT               |

**Розділення видно в графі залежностей, не лише в конфігурації.** `apps/platform-api/src/app.module.ts`
фізично не імпортує `TenancyModule` і `PrismaModule` — тільки `SystemPrismaModule`. `apps/api`
не має жодного роута, який читав би дані поза власним tenant-ом. Компрометація одного plane-у
(вкрадений токен, SSRF, injection) не дає шляху до операцій іншого — не тому, що хтось перевіряє
права в рантаймі, а тому, що відповідного коду в процесі просто немає.

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   apps/web (:5173)      │        │  apps/platform-web (:5174)│
│   tenant JWT             │        │  platform JWT              │
└───────────┬──────────────┘        └───────────┬────────────────┘
            │ Bearer tenant-JWT                  │ Bearer platform-JWT
            ▼                                    ▼
┌─────────────────────────┐        ┌──────────────────────────┐
│   apps/api (:3001)       │        │  apps/platform-api (:3002)│
│   роль saas_app           │        │  роль saas_platform        │
│   RLS ДІЄ                 │        │  BYPASSRLS                  │
└───────────┬──────────────┘        └───────────┬────────────────┘
            │                                    │
            └──────────────┬─────────────────────┘
                            ▼
                  ┌───────────────────┐
                  │   Postgres 17       │
                  │   tenants, users,    │
                  │   files, ...          │
                  │   (одна схема,        │
                  │   RLS-політики)        │
                  └──────────┬──────────┘
                             │
                  ┌──────────▼──────────┐
                  │  apps/worker          │
                  │  саме той pg-boss:     │
                  │  saas_app (tenant-джоби)│
                  │  saas_platform (cron)   │
                  └──────────────────────┘
```

**Single-tenant не є окремим режимом.** Немає гілки коду `if (multiTenant)`. Колонка `tenant_id`
є завжди; single-tenant-інсталяція — це просто один рядок у `tenants` і резолвер, що завжди
повертає його id (`StaticTenantResolver`, див. §6). `apps/platform-api`/`apps/platform-web`
у такому разі просто не деплояться.

**Чому shared schema + RLS, а не schema-per-tenant чи database-per-tenant.** Обидві
альтернативи масштабують ізоляцію ціною ×N міграцій і (для database-per-tenant) вибуху
конекшенів на tenant — Prisma-пул це тримає погано. Вирішальний аргумент саме для цієї
кодобази: фільтрація тільки в Prisma-коді (`where: { tenantId }` руками) не покриває
`$queryRaw` — а він уже є (`/jobs` читає `pgboss.job` сирим SQL) і буде далі (звіти,
аналітика). RLS діє на рівні планувальника Postgres і покриває все, що доходить до бази,
незалежно від того, яким шляхом запит туди прийшов.

## 3. Схема БД

Джерело правди: [libs/database/prisma/schema.prisma](../libs/database/prisma/schema.prisma).

| Таблиця          | `tenant_id`       | RLS                         | Що це                                                                 |
| ---------------- | ----------------- | --------------------------- | --------------------------------------------------------------------- |
| `tenants`        | — (це і є tenant) | `own_tenant`, БЕЗ FORCE     | Сам tenant + налаштування (`locale`, `settings: Json`)                |
| `users`          | NOT NULL          | `tenant_isolation`, FORCE   | Email унікальний **у межах tenant-а** (`@@unique([tenantId, email])`) |
| `refresh_tokens` | NOT NULL          | `tenant_isolation`, FORCE   | Композитний FK на `users(tenantId, id)`                               |
| `files`          | NOT NULL          | `tenant_isolation`, FORCE   | Ключ у S3 `{tenantId}/{yyyy}/{mm}/{uuid}.ext`                         |
| `attachments`    | NOT NULL          | `tenant_isolation`, FORCE   | Композитний FK на `files(tenantId, id)`                               |
| `platform_users` | — (глобальна)     | немає (не tenant-таблиця)   | `REVOKE ALL ... FROM saas_app` — tenant-api її не бачить              |
| `processed_jobs` | — (інфра)         | немає                       | Inbox-маркер ідемпотентності, глобальний за задумом                   |
| `pgboss.*`       | — (інфра)         | немає, поза схемою `public` | tenantId живе в JSON-payload, не в колонці                            |

**Заповнення `tenant_id` — DB-default, не код:**

```prisma
tenantId String @default(dbgenerated(
  "nullif(current_setting('app.tenant_id'::text, true), ''::text)"
)) @map("tenant_id")
```

Це ключова деталь: `dbgenerated` робить поле **опційним у Prisma-типах** для `create` — тому
`prisma.user.create({ data: { email, name, passwordHash } })` компілюється без `tenantId`
узагалі. Значення бере сесійна змінна Postgres, яку виставляє інфраструктура (§6).

**Чому `User` належить рівно одному tenant-у, а не глобальний User + Membership.** Розглядалась
модель «глобальний User + `Membership { userId, tenantId, role }`» (одна людина в кількох
організаціях). Відхилено: `users` довелося б лишити поза RLS (глобальна таблиця) — виняток
у моделі саме там, де ізоляція найкритичніша; JWT і refresh ускладнюються вибором/перемиканням
organization; а для CRM/ERP «два акаунти для двох клієнтів» — норма, а не незручність. Поточна
модель (`tenantId NOT NULL`, `@@unique([tenantId, email])`) робить `users` звичайною
tenant-таблицею під тим самим RLS-шаблоном, що й усе інше; «запросити юзера» = створити його
в потрібному tenant-і, окремої сутності Invitation для цього не потрібно (на відміну від
invite **першого admin-а тенанта** — це інший кейс, MT-4/беклог нижче).

**Композитні FK — і чому не всі.** `refresh_tokens.userId` і `attachments.fileId` — композитні
(`(tenantId, id)`), бо перевірки referential integrity в Postgres виконуються з правами
власника таблиці і **обходять RLS**: без композита рядок міг би формально послатись на
батьківський рядок чужого tenant-а. `users.avatarFileId` і `files.uploadedById` — **навмисно
не композитні**: `onDelete: SetNull` з композитним FK Prisma не підтримує (не може занулити
лише частину складеного ключа), а захист тут усе одно є — RLS на обох таблицях блокує читання
чужого рядка незалежно від того, на що формально показує FK.

## 4. Ролі Postgres

Джерело: [docker/postgres/init/01-roles.sql](../docker/postgres/init/01-roles.sql) (свіжий volume) /
[libs/database/scripts/ensure-roles.ts](../libs/database/scripts/ensure-roles.ts) (наявна БД, `pnpm db:roles`, ідемпотентно).

| Роль            | `BYPASSRLS` | Власник схеми                    | Хто нею ходить                                                      |
| --------------- | ----------- | -------------------------------- | ------------------------------------------------------------------- |
| `saas_migrator` | ні          | так (+ `CREATEDB` для shadow-DB) | `prisma migrate` (`MIGRATE_DATABASE_URL`)                           |
| `saas_app`      | **ні**      | ні                               | `apps/api`, `apps/worker` (tenant-джоби) — `DATABASE_URL`           |
| `saas_platform` | **так**     | ні                               | `apps/platform-api`, `apps/worker` (cron) — `PLATFORM_DATABASE_URL` |

RLS діє тільки на `saas_app` — це і є той факт, що робить політики enforcement-ом, а не
рекомендацією: навіть якщо доменний сервіс якимось чином отримав би довільний SQL, роль,
під якою він виконується, фізично не бачить чужих рядків.

## 5. RLS: політики й `resolve_tenant`

Джерело: [migration 20260716140000_enable_rls](../libs/database/prisma/migrations/20260716140000_enable_rls/migration.sql).

Політика на кожній tenant-таблиці (буквально, `tenant_isolation` на `users`):

```sql
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
```

Три деталі, які легко пропустити й важливо не чіпати випадково:

- **`current_setting(..., true)`** — `missing_ok=true`: без контексту дає `NULL`, порівняння
  `tenant_id = NULL` дає `false` для кожного рядка → **нуль результатів**, а не помилка й не
  «всі рядки». Це і є fail-closed.
- **`nullif(..., '')`** — після `RESET`/поза транзакцією `current_setting` повертає порожній
  рядок, не `NULL`; без `nullif` каст такого рядка до `uuid` упав би з помилкою замість тихого
  «нуль рядків».
- **Обгортка в `(SELECT ...)`** — це InitPlan: Postgres обчислює значення один раз на запит,
  а не на кожен рядок таблиці. Без неї великі таблиці деградували б лінійно.

**`tenants` — єдина таблиця без `FORCE`.** Причина — `resolve_tenant(slug)`, `SECURITY DEFINER`
від власника (`saas_migrator`):

```sql
CREATE FUNCTION resolve_tenant(p_slug text) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$ SELECT id FROM tenants WHERE slug = p_slug AND is_active $$;

REVOKE EXECUTE ON FUNCTION resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO saas_app;
```

`SECURITY DEFINER` виконується з правами того, хто визначив функцію (власник — обходить RLS
автоматично, бо власника політики не стосуються). `FORCE` на `tenants` змусив би RLS діяти й
на власника — і функція осліпла б, побачивши нуль рядків замість реального tenant-а. Це
розв'язує курку-яйце slug-логіну: щоб знайти tenant за slug-ом, треба прочитати `tenants` до
того, як tenant-контекст узагалі існує (§7). `saas_app` при цьому не має **прямого** `SELECT`
на `tenants` поза власним рядком — тільки `EXECUTE` на функцію, яка повертає рівно один `id`
або `NULL`. Перелічити тенантів через цю функцію неможливо.

## 6. Механіка контексту: від HTTP-запиту до рядка в БД

Публічний API цілого шару — [`libs/database/src/tenant/`](../libs/database/src/tenant/), а
єдина точка входу — `TenancyModule.forRoot({ resolver? })`. Ланцюг для `apps/api`:

```
1. TenantResolutionMiddleware (монтується на '*' — і на @Public() теж)
     └─ cls.run(() => resolver.resolve(req))
2. SlugTenantResolver.resolve(req)
     └─ req.body.tenant присутній? → SECURITY DEFINER resolve_tenant(slug) → { tenantId, authoritative: true }
     └─ відсутній? → env-fallback DEFAULT_TENANT_ID → { tenantId, authoritative: false }
     └─ tenantContext.set(tenantId) + setResolutionAuthoritative(authoritative)
3. JwtAuthGuard.canActivate() (APP_GUARD, для всіх, крім @Public())
     └─ verifyAsync(token) → payload.tenantId (З РЯДКА БД, зафіксований при видачі)
     └─ якщо isResolutionAuthoritative() І payload.tenantId !== resolved → 401
     └─ tenantContext.set(payload.tenantId)   ← фінальне джерело правди на весь запит
4. PrismaService (tenant-extended клієнт)
     └─ КОЖНА операція: транзакція [ SELECT set_config('app.tenant_id', tenantId, true), query ]
5. Postgres
     └─ RLS-політика читає app.tenant_id із сесії поточної транзакції
     └─ DB-default заповнює tenant_id на INSERT з того самого significant
```

**Чому кроки 1 і 3 не конфліктують.** Крок 1 (резолвер) дає **підказку** — вона потрібна
`login`/`refresh`, у яких іще немає JWT. Крок 3 (guard) дає **джерело правди** для всіх
авторизованих запитів — підписаний токен завжди переможе. Поле `authoritative` вирішує,
коли підказка настільки надійна (slug явно вказано, або резолвер — `StaticTenantResolver`
у N=1), що розбіжність із токеном — це підозріла ситуація (зшитий токен), а не нормальний
authenticated-запит без slug-а в тілі.

**Чому `set_config` — саме `is_local=true` (transaction-local), а не session-level `SET`.**
Prisma-адаптер тримає пул з'єднань; при session-level `SET` значення пережило б транзакцію,
конекшн повернувся б у пул «зарядженим» tenant-ом A, і наступний запит іншого tenant-а
отримав би чужий контекст. `is_local=true` гарантує, що значення зникає на `COMMIT`.

**Чому конкурентні запити різних tenant-ів не плутаються попри спільний пул.** `TenantContextService`
обгортає `nestjs-cls` (`AsyncLocalStorage`) — кожен HTTP-запит виконується у власному async-контексті,
і Node відновлює правильний контекст після кожного `await`, незалежно від того, скільки інших
запитів виконувалось паралельно. CLS ізолює на рівні Node-процесу, `set_config(..., true)` —
на рівні Postgres-транзакції; це два незалежні захисти одного й того самого факту.

**Дві реалізації резолвера зараз:**

| Резолвер                            | Хто використовує            | Поведінка                                                              |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `SlugTenantResolver`                | `apps/api`                  | Поле `tenant` у Login-payload → `resolve_tenant()`; порожнє → fallback |
| `StaticTenantResolver`              | (доступний, не підключений) | Завжди повертає env-константу; для N=1-форків                          |
| — (без резолвера)                   | `apps/worker`               | tenantId приходить у payload джоби, не через HTTP (§8)                 |
| — (`TenancyModule` не імпортується) | `apps/platform-api`         | Немає HTTP-запитів під tenant-контекстом узагалі                       |

**Транзакції в доменному коді — тільки через `TenantTransactions.withTenantTx`.** Prisma
Client Extension (§5) обгортає лише **окремі** операції; голий `prisma.$transaction(fn)`
відкриває власне з'єднання, повз яке extension не проходить — усередині такої транзакції
`app.tenant_id` був би порожнім. ESLint (`no-restricted-syntax` на `$transaction`, файли
`apps/api/src/**` і `apps/worker/src/**`) фізично забороняє написати голий виклик у
tenant-застосунках. `apps/platform-api` під цю заборону **не підпадає** — там усі клієнти
системні (`SystemPrismaService`, BYPASSRLS), `set_config` їм не потрібен, тож
`tenants.service.ts` відкриває звичайний `$transaction` для атомарного `Tenant + перший admin`.

## 7. Auth: два незалежні auth-и

Не спільний auth із прапорцем ролі — **два різні модулі, різні таблиці, різні секрети**.

|                       | Tenant auth (`apps/api/src/auth`)                          | Platform auth (`apps/platform-api/src/auth`)                     |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Identity-таблиця      | `users` (tenant-scoped, RLS)                               | `platform_users` (глобальна, `REVOKE` від `saas_app`)            |
| JWT secret            | `JWT_SECRET`                                               | `PLATFORM_JWT_SECRET` (окремий, без фолбека)                     |
| Access-токен          | 15m, `{ sub, email, role, tenantId }`                      | 60m, `{ sub, email }` (без tenantId — оператор і так над усіма)  |
| Refresh               | **є**: `tenantId:tokenId:secret`, ротація, theft detection | **немає** (MVP — операторів мало, перелогін прийнятний)          |
| Self-serve реєстрація | **немає взагалі** (`POST /auth/register` видалено)         | не застосовується (операторів заводить хтось інший вручну/сідом) |

**Токени двох plane-ів не крос-валідні структурно**, не за домовленістю: `PlatformJwtGuard`
конфігурує `JwtService` окремим секретом — токен, підписаний `JWT_SECRET`, не пройде
`verifyAsync` під `PLATFORM_JWT_SECRET`, і навпаки. Перевірено e2e (`platform.e2e-spec.ts`,
«rejects a TENANT-plane token»).

**Refresh-токен несе tenant у самому собі.** Формат `tenantId:tokenId:secret` вирішує
курку-яйце на `/auth/refresh` — там немає ні JWT (є лише refresh-рядок), ні slug-поля
(це не login). `auth.service.refresh()` парсить перший сегмент і виставляє tenant-контекст
до будь-якого звернення до БД; далі звіряє, що знайдений рядок `refresh_tokens` реально
належить цьому tenant-у (захист від «зшитого» токена — валідний `tokenId:secret` з чужим
префіксом tenant-а).

**Login-флоу — саме той шлях, де підказка (slug) і джерело правди (рядок БД) розходяться
навмисно.** `SlugTenantResolver` лише **звужує пошук** — `auth.service.login()` шукає юзера
`findFirst({ where: { email } })` **у вже резолвленому tenant-і** (без явного `tenantId` в
`where` — RLS уже відфільтрував). Якщо slug невірний або юзера з таким email у цьому tenant-і
нема — та сама відповідь `401 Invalid email or password`, що й для невірного пароля: немає
способу через різницю в помилці визначити, чи tenant узагалі існує.

## 8. Черги: tenant-scope і system-scope

> Оновлено після **EDA-1** (2026-08-04): шар черг переїхав із `libs/shared/src/jobs/` у
> `libs/shared/src/messaging/`. Механіка tenant-контексту не змінилася — змінилося, **де** він
> їде: був службовим полем у payload, став полем конверта. Повний опис шару —
> [event-driven-architecture.md](event-driven-architecture.md).

`pgboss.*` — інфраструктурна схема поза `public`, без RLS. Ізоляція тут — **не БД-рівнева**,
а конвенція, зашита у scope повідомлення
([libs/shared/src/messaging/message-definition.ts](../libs/shared/src/messaging/message-definition.ts)):

```ts
defineEvent('users.user-registered.v1', z.object({ userId: z.uuid(), email: z.email() }));
// → scope: 'tenant' за замовчуванням

defineCommand('files.cleanup-orphans', z.object({}), { scope: 'system' });
// → крос-tenant (cron/maintenance)
```

`tenantId` у Zod-схемі **не оголошується взагалі** — на відміну від старого `defineTenantJob`,
який домішував його в payload. Він переїхав у конверт (`MessageEnvelope.tenantId`, `uuid |
null`), тому доменні дані лишаються суто доменними, а інфраструктурне поле не змішується
з бізнесовим.

**Публікація** (`MessagePublisher.publish`, `apps/api`): для `scope: 'tenant'` publisher бере
`tenantId` з `TenantContextService.requireTenantId()` і кладе в конверт. Немає контексту →
`requireTenantId()` кидає — публікація падає гучно, а не йде «в нікуди» без tenant-а.

**Обробка** (`MessageWorkerRegistrar.runJob`, `apps/worker`) — тут CLS доводиться
**відновлювати**, бо AsyncLocalStorage не перетинає межу процесу:

```ts
if (entry.definition.scope === 'tenant') {
  await this.tenantContext.runWith(envelope.tenantId, () => handler.handle(data, envelope));
} else {
  await this.tenantContext.runWithout(() => handler.handle(data, envelope));
}
```

Підписник про це не знає — усередині нього `PrismaService` поводиться так само, як в API: той
самий tenant-extended клієнт, той самий `set_config` на кожній операції.
`MessageInboxService.runOnce` (exactly-once ефекти) іде через `withTenantTx`, тож бізнес-записи
всередині inbox-транзакції теж отримують tenant-контекст; сам маркер `processed_jobs` —
інфра-таблиця без `tenant_id`. Маркер вставляється як `createMany({ skipDuplicates: true })`
(`ON CONFLICT DO NOTHING`), `count === 0` → `skipped`; помилка `fn` (зокрема бізнесовий `P2002`)
іде назовні разом з відкотом маркера й усіх записів транзакції.

Разом із tenant-контекстом із конверта піднімається і **контекст ланцюга**
(`correlationId`/`causationId`), тому публікація, зроблена всередині підписника, успадковує їх
автоматично — кореляція не рветься на межі процесу так само, як не рветься tenant.

**Три system-повідомлення зараз**: `auth.cleanup-expired-tokens`, `files.cleanup-orphans`,
`maintenance.cleanup-processed-jobs` — усі cron, усі крос-tenant за природою (чистять по всіх
tenant-ах одразу), усі ходять через `SystemPrismaService` (BYPASSRLS) у своїх підписниках — не
через звичайний `PrismaService`.

**`/jobs`-моніторинг живе тільки в `apps/platform-api`.** Read-only endpoint читає
`pgboss.job` сирим SQL (`$queryRaw`) — таблиця поза RLS, тож будь-який фільтр у tenant-api
був би самообманом (доступ до чужих payload все одно існував би на рівні схеми). У
`apps/api` цього модуля немає фізично — `GET /jobs` там дає 404.

## 9. Storage, логи, контракти

**Storage** — ключ об'єкта будує `StorageService.buildObjectKey()` (інфраструктура, не
доменний `files.service`): `{tenantId}/{yyyy}/{mm}/{uuid}.ext`, tenantId береться з
`TenantContextService.requireTenantId()` у момент виклику. Доменний `files.service.createUpload`
викликає `this.storage.buildObjectKey(filename)` і не бачить самого tenantId.

**Логи** — pino `mixin` у `apps/api` й `apps/worker` (не в `apps/platform-api` — там
tenant-контексту принципово немає) читає `TenantContextService` і домішує `tenantId` в
**кожен** лог-запис, коли контекст активний:

```ts
mixin: () => (cls.isActive() ? { tenantId: cls.get('tenantId') } : {});
```

Це не окрема система — той самий CLS, що й скрізь; кореляція «який лог якого tenant-а»
працює безкоштовно.

**Контракти розділені на рівні пакета, не тільки папки.** `@saas-skeleton/contracts` (index)
— спільне для tenant-api й web: `auth`, `user`, `file`, `job`, `error`, `pagination`.
`@saas-skeleton/contracts/platform` — **окремий subpath**, свій `index.ts`, **не реекспортується**
з головного:

```json
// libs/contracts/package.json
"exports": {
  ".": "./src/index.ts",
  "./platform": "./src/platform/index.ts"
}
```

`exports`-мапа існує заради Vite/Rollup: `tsc` і webpack резолвлять subpath через
tsconfig `paths`/явний alias і на `package.json` не дивляться взагалі, але фронтенд-build
`apps/platform-web` іде через справжню Node-алгоритміку резолюції workspace-пакетів — без
явного `exports` падав з «Rollup failed to resolve import». Кожен plane генерує свій
`openapi.json` (`apps/api/openapi.json`, `apps/platform-api/openapi.json`) і свій orval-клієнт
незалежно.

`AllExceptionsFilter` (єдиний `ApiError`-конверт: `{ statusCode, code, message, fieldErrors?, requestId }`)
живе в `libs/shared/src/errors/` і використовується **обома** API — тому обидва фронтенди
можуть переюзати той самий `parseApiError`/`applyServerError` без модифікацій.

## 10. Наскрізний приклад: create user до welcome-листа

Живий шлях, який реально прогнано (worker + api одночасно), а не гіпотетичний:

```
1. Tenant-admin у apps/web викликає POST /api/users { email, name, role, password }
   (Authorization: Bearer <tenant-JWT з tenantId=T>)

2. apps/api: middleware резолвить slug (тут немає — авторизований запит), guard верифікує
   JWT, звіряє (fallback неавторитетний, тому просто бере payload.tenantId=T), tenantContext.set(T)

3. UsersService.create(dto) — БЕЗ tenantId у коді:
   this.prisma.user.create({ data: { email, name, passwordHash } })
   → extension: [set_config('app.tenant_id', 'T', true), INSERT]
   → DB-default заповнює tenant_id='T'; WITH CHECK підтверджує (бо контекст='T')

4. UsersService публікує подію users.user-registered.v1 — у ТІЙ САМІЙ транзакції, що й крок 3:
   messages.publish(tx, userRegisteredEvent, { userId, email }, { actor })
   → MessagePublisher бере tenantId='T' з CLS і кладе в КОНВЕРТ (не в payload):
     { messageId, name, tenantId: 'T', actor, correlationId, causationId: null, data: {...} }
   → topologyFor() дає список підписників → по job-у в чергу кожного
     ('users.user-registered.v1/welcome-email'), усі в цій же транзакції

5. apps/worker (окремий процес — CLS тут ІНШИЙ, попередній контекст не існує):
   MessageWorkerRegistrar.runJob бачить scope='tenant', читає envelope.tenantId='T'
   → tenantContext.runWith('T', () => handler.handle(data, envelope))
     (і паралельно піднімає контекст ланцюга з correlationId/causationId)

6. WelcomeEmailSubscriber усередині runWith('T', ...):
   читає User.findUnique({ id: userId }) — СВІЖИЙ locale/name з БД, під тим самим
   tenant-контекстом T → рендерить і шле лист через MailerService
   → inbox.runOnce(envelope, 'welcome-email', tx => activities.record(tx, 'email.sent', ...))
   → withTenantTx: set_config('app.tenant_id', 'T', true) першим стейтментом → INSERT
     processed_jobs (ключ messageId:welcome-email) + активність у ТІЙ САМІЙ транзакції
```

Проміжного хопа тут більше немає: до EDA-1 крок 4 ставив джобу, її хендлер робив fan-out
руками і ставив другу джобу, і лише вона слала лист. Тепер fan-out відбувається на публікації,
а `UserRegisteredHandler` видалено.

На кожному кроці, де tenant «стрибає» (HTTP → job payload → CLS відновлення), він явно
видимий рівно в одному місці інфраструктурного коду — ніде в доменному `UsersService` чи
хендлерах `tenantId` не згадується напряму (крім домішування диспетчером, яке відбувається
поза доменним викликом).

## 11. Контракт для нового доменного модуля

Коли пишеться новий tenant-scoped модуль (еталон — `customers`, реалізований 2026-09-01,
`docs/customers.md`):

**Дозволено:**

- Інжектити `PrismaService`, писати запити без `where: tenantId`.
- Створювати рядки без `tenantId` у `data` (DB-default заповнить).
- Транзакції на кілька таблиць — через `TenantTransactions.withTenantTx` (не «немає
  транзакцій», а «не голий `$transaction`»).
- Публікувати tenant-повідомлення через `defineEvent`/`defineCommand` (scope за замовчуванням
  `tenant`) + `MessagePublisher.publish(tx, ...)` без `tenantId` у payload — його кладе в конверт
  publisher.

**Заборонено (і чому):**

- Інжектити `TenantContextService`/`SystemPrismaService` у доменний сервіс — обхід ізоляції.
- Писати `where: { tenantId }` явно — дублює RLS, розходиться з нею при помилці, і взагалі
  зайве.
- Голий `prisma.$transaction(fn)` в `apps/api`/`apps/worker` — ESLint блокує компіляцію.

**Для нової tenant-таблиці в Prisma-схемі:**

```prisma
model Customer {
  id       String @id @default(uuid())
  tenantId String @default(dbgenerated(
    "nullif(current_setting('app.tenant_id'::text, true), ''::text)"
  )) @map("tenant_id")
  // ... доменні поля
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, id])          // опора для майбутніх композитних FK з інших таблиць
  @@index([tenantId, /* інші поля сортування/фільтрів */])
}
```

Плюс SQL-міграція (Prisma не генерує RLS сама): `ENABLE`/`FORCE ROW LEVEL SECURITY` +
`CREATE POLICY tenant_isolation ... USING (...) WITH CHECK (...)` — той самий шаблон, що в
§5, скопійований дослівно з іншим ім'ям таблиці.

## 12. Тестування ізоляції

| Файл                                                                          | Що перевіряє                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [rls.e2e-spec.ts](../apps/api/test/rls.e2e-spec.ts)                           | Голий `pg`-клієнт під `saas_app`, без Nest: без контексту — нуль рядків на читанні, помилка на INSERT; `set_config` transaction-local (зникає після COMMIT); `pg_policies`-автоперевірка — кожна таблиця з `tenant_id` має RLS-політику (ловить «завели таблицю, забули політику»)                     |
| [tenant-isolation.e2e-spec.ts](../apps/api/test/tenant-isolation.e2e-spec.ts) | Два реальні tenant-и через HTTP: список A не містить B; get/patch/delete чужого ID → 404 (не 403 — не палимо існування); зшитий/чужий JWT при авторитетній резолюції → 401; CLS-конкурентність (`runWith` A/B паралельно зі штучним чергуванням event loop) не перетікає; slug-login у B бачить лише B |
| [platform.e2e-spec.ts](../apps/platform-api/test/platform.e2e-spec.ts)        | Operator auth, CRUD тенантів (create атомарно з admin-ом, дублікат slug → 409, невалідний slug → 400, suspend/resume), jobs-моніторинг, токен tenant-plane відхиляється platform-guard-ом                                                                                                              |

Разом — 63 tenant e2e + 11 platform e2e, ганяються в CI одним пайплайном (`pnpm api:test:e2e`,
`pnpm platform:test:e2e`), без окремого кроку на RLS — перевірка вшита в звичайний тестраннер.

---

## MT-4/беклог (свідомо не зроблено)

- **Піддомени** (`acme.app.com` → slug → tenant) замість ручного поля на формі логіну.
  Резолвер `SubdomainTenantResolver` ще не написаний; підключення — заміна одного рядка в
  `apps/api/src/app.module.ts` (`TenancyModule.forRoot({ resolver: ... })`), решта механіки
  (CLS, `set_config`, extension) від резолвера не залежить (§6).

- **Invite-флоу першого admin-а тенанта.** Зараз пароль задає оператор при створенні tenant-а
  (`apps/platform-web` форма), consistent з рішенням «Create user: адмін задає початковий
  пароль». Цільовий стан — **оператор ніколи не знає пароля tenant-адміна**: юзер задає його
  сам за одноразовим підписаним лінком. Дизайн (продуманий, не реалізований):

  - Схема вже це підтримує: `User.passwordHash` — nullable, а `auth.service.login` уже
    відмовляє юзеру без хеша — «створений, але не активований» юзер є коректним станом без
    змін у login.
  - Токен — за наявним патерном `refresh_tokens` (`tokenId:secret`, у БД лише argon2-хеш
    secret-а), нова таблиця `user_invitations` (`tenantId`, `userId`, `tokenHash`, `expiresAt`
    ~72h, `usedAt` — nullable, не delete, щоб бачити повторні спроби), рівень 1 (RLS).
  - Флоу перетинає обидва plane-и: `platform-api` (BYPASSRLS) створює `Tenant` + `User(passwordHash=null)`
    + `UserInvitation` в одній транзакції → джоба `notifications.user-invited` (tenant-scope)
    → worker шле лист із лінком `https://{slug}.app.com/set-password?token={id}:{secret}` →
    tenant-api `POST /auth/set-password` (`@Public()`, tenant резолвиться з Host/env тим самим
    middleware, що й login) звіряє argon2-хеш + `expiresAt`/`usedAt` → ставить `passwordHash`
    і `usedAt=now()` в одній транзакції → `apps/web` сторінка `/set-password` (RHF + zodResolver).

- **Рівень 3 довідників** (глобальні записи + tenant-розширення, nullable `tenant_id`, RLS
  `USING (tenant_id IS NULL OR tenant_id = ctx)` на читання й тільки свій tenant на запис) —
  чекає на перший реальний довідник такого типу (зараз немає жодного домену, якому це
  потрібно). Рівень 2 (чисто глобальні довідники — `GRANT SELECT` для `saas_app`, запис лише
  з `saas_platform`, без RLS) так само ще не має конкретного застосування.
- **Білінг тенантів** у control plane — поверх `PaymentProvider` з фази 4 roadmap.
- **Міграція файлів** під tenant-префікс для форків із наявними даними (dev-дані одноразові,
  тому цього не було потрібно під час самого переходу).
