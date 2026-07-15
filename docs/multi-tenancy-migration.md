# Мультитенантність — план переходу (MT-0…MT-4)

> Зафіксовано: 2026-07-15. Це **план переходу**: що саме, у якому порядку і в яких файлах
> міняється, щоб довести поточний single-tenant скелетон до мультитенантного.
> **Рішення й обґрунтування — у [multi-tenancy-plan.md](multi-tenancy-plan.md)** (навіщо RLS,
> чому User в одному tenant-і, таксономія таблиць, підводні камені). Тут — механіка: кроки,
> SQL, файли, DoD, ризики й відкат. Дублювання свідомо немає: якщо питання «чому» — той док,
> «як і в якому порядку» — цей.
>
> Стан кодобази, від якого писався план: коміт `78310b7`, міграцій — 4, e2e — 47.

## Інваріанти переходу (не порушувати)

1. **`main` зелений після кожної фази.** Кожна MT-фаза — окремий PR, після якого
   `lint && typecheck && build && api:test:e2e` проходять і застосунок живий.
2. **N=1 на кожному кроці.** Ми не «додаємо мультитенантність», а **вводимо tenant-контекст
   при одному tenant-і**. Поведінка для користувача не змінюється до самого кінця.
3. **RLS вмикається ОСТАННІМ (MT-2)** — тільки після того, як контекст доведено працює.
   Увімкнути політики раніше = отримати «нуль рядків» усюди й дебажити наосліп.
4. **expand → backfill → contract** для кожної колонки: додати nullable → заповнити →
   зробити `NOT NULL`. В одній міграції, але саме в цьому порядку.
5. **Доменний код tenant-agnostic від початку** — див. §0 плану. Якщо крок вимагає написати
   `where: { tenantId }` у сервісі, крок спроєктовано неправильно.

## Стартова точка: що є зараз і що з ним станеться

| Таблиця | Зараз | Після MT | Рівень (§8 плану) |
| --- | --- | --- | --- |
| `users` | глобальний `@unique` на email | `tenant_id NOT NULL`, `@@unique([tenantId, email])` | 1 — RLS |
| `refresh_tokens` | FK `userId` | `tenant_id` + композитний FK | 1 — RLS |
| `files` | `@@index([status, createdAt])` | `tenant_id`, індекс з префіксом, ключі S3 `{tenantId}/…` | 1 — RLS |
| `attachments` | FK `fileId` | `tenant_id` + композитний FK | 1 — RLS |
| `processed_jobs` | інфра | **без змін** (маркер ідемпотентності глобальний) | інфра |
| `pgboss.*` | інфра | **без змін** (tenantId — у payload) | інфра |
| — | — | **нова `organizations`** (= tenant + налаштування) | особлива (`id = ctx`) |

**Точки дотику в коді** (усе, що доведеться відкрити):

| Файл | Що змінюється | Фаза |
| --- | --- | --- |
| [libs/database/prisma/schema.prisma](../libs/database/prisma/schema.prisma) | `Organization`, `tenant_id`, композитні FK, індекси | MT-1 |
| [libs/database/src/prisma.service.ts](../libs/database/src/prisma.service.ts) | + `SystemPrismaService` (BYPASSRLS) | MT-1 |
| `libs/database/src/tenant/` (нова тека) | `TenancyModule.forRoot()`, `TenantContextService`, `TenantResolver` + реалізації, middleware, `forTenant`, `withTenantTx` | MT-1 |
| [apps/api/src/app.module.ts](../apps/api/src/app.module.ts) | `TenancyModule.forRoot({ resolver: JwtTenantResolver })` — **єдина згадка MT у застосунку** | MT-1 |
| [apps/worker/src/worker.module.ts](../apps/worker/src/worker.module.ts) | `TenancyModule.forRoot()` (без резолвера) | MT-1 |
| `apps/api/src/users/`, `apps/api/src/files/` | **не змінюються** — перевірка принципу §0/§6 плану | — |
| [libs/database/prisma/seed.ts](../libs/database/prisma/seed.ts) | сід дефолтного tenant-а перед admin-юзером | MT-1 |
| [apps/api/src/auth/auth.service.ts](../apps/api/src/auth/auth.service.ts) | `findUnique({email})` → композит; `tenantId` у JWT | MT-1 ⚠️ |
| [apps/api/src/auth/guards/jwt-auth.guard.ts](../apps/api/src/auth/guards/jwt-auth.guard.ts) | запис `tenantId` у CLS + звірка з резолвленим | MT-1 |
| [apps/api/src/auth/decorators/current-user.decorator.ts](../apps/api/src/auth/decorators/current-user.decorator.ts) | `JwtPayload` + `tenantId` | MT-1 |
| [apps/api/src/jobs/](../apps/api/src/jobs/) (модуль цілком) | **переїзд у platform-api** (`pgboss.job` поза RLS → витік) | MT-3 ⚠️ |
| [libs/shared/src/jobs/job-definition.ts](../libs/shared/src/jobs/job-definition.ts) | `defineTenantJob` + `scope: 'system'` | MT-1 |
| [libs/shared/src/jobs/pg-boss.dispatcher.ts](../libs/shared/src/jobs/pg-boss.dispatcher.ts) | авто-домішування `tenantId` з CLS | MT-1 |
| [libs/shared/src/jobs/job-worker.registrar.ts](../libs/shared/src/jobs/job-worker.registrar.ts) | `cls.run` + `set tenantId` з payload | MT-1 |
| [libs/shared/src/jobs/job-inbox.service.ts](../libs/shared/src/jobs/job-inbox.service.ts) | `set_config` першим стейтментом транзакції | MT-1 |
| [libs/shared/src/storage/storage.service.ts](../libs/shared/src/storage/storage.service.ts) | ключі з tenant-префіксом | MT-1 |
| [docker/docker-compose.yml](../docker/docker-compose.yml) | init-скрипт ролей | MT-0 |
| [apps/api/test/global-setup.ts](../apps/api/test/global-setup.ts) | ролі в тестовій БД, конект як `saas_app` | MT-0/MT-2 |

## ⚠️ Дві поломки, які треба вирішити свідомо

### 1. `auth.service.ts` — пошук юзера по email ламається

Зараз [auth.service.ts:26](../apps/api/src/auth/auth.service.ts#L26) і
[:67](../apps/api/src/auth/auth.service.ts#L67):

```ts
const user = await this.prisma.user.findUnique({ where: { email: data.email } });
```

Після `@@unique([tenantId, email])` глобального унікального індексу на `email` **немає** →
`findUnique({ where: { email } })` перестає компілюватися. І глибша проблема: **login/register —
`@Public()` роути, tenant-контексту з JWT там ще немає** (курка-яйце: щоб знайти юзера, треба
знати tenant; щоб знати tenant з токена, треба знайти юзера).

**Рішення — `TenantResolutionMiddleware`, що працює ДО auth і для публічних роутів теж.**
Він резолвить tenant з джерела, яке не залежить від юзера:

```
Host/піддомен (цільово: acme.app.com → slug → tenant)
   └─ fallback у N=1: константа SAAS_DEFAULT_TENANT_ID з env
        → cls.set('tenantId', ...)  ← ще до JwtAuthGuard, для ВСІХ роутів
```

Далі `auth.service` шукає юзера **у вже відомому tenant-і**:

```ts
const user = await this.prisma.user.findFirst({ where: { email: data.email } });
// під RLS (MT-2) це поверне юзера ТІЛЬКИ поточного tenant-а; до MT-2 — композитний findUnique
```

І `JwtAuthGuard` додатково **звіряє** `payload.tenantId` з резолвленим із Host — інакше токен
tenant-а A, надісланий на піддомен B, ліг би в контекст B:

```ts
if (payload.tenantId !== this.cls.get('tenantId')) throw new UnauthorizedException();
```

Той самий middleware закриває `refresh` (там теж немає JWT — лише refresh-токен) і
`cleanup-expired-tokens` (системна джоба, BYPASSRLS).

### 2. `/jobs` стає крос-tenant витоком → переїжджає в platform-api (зафіксовано 2026-07-15)

[jobs.service.ts](../apps/api/src/jobs/jobs.service.ts) читає `pgboss.job` **сирим SQL**, а
`pgboss.*` — інфра-схема **поза RLS**. Тобто в мультитенантному режимі tenant-адмін бачив би
джоби **всіх тенантів** — з payload-ами, тобто з чужими email-ами й id. Це саме той клас діри,
заради якого ми беремо RLS, і RLS його **не закриє** (схема не наша).

**Рішення: моніторинг черг — операторський інструмент і живе ТІЛЬКИ в control plane.**
Фільтр по `data->>'tenantId'` у tenant-api відхилено: він віддає тенанту деталі реалізації черги,
тримається на формі payload-у, а системні джоби (без `tenantId`) з нього все одно випадають.

**Коли саме переносити — на MT-3, не на MT-2.** Логіка: крос-tenant витік можливий лише за
наявності ≥2 тенантів, а створити другого тенанта можна **тільки з platform-api**, тобто не
раніше MT-3. До того ми фізично при N=1 і витоку немає. Отже `/jobs` лишається в tenant-api
без змін через MT-1 і MT-2 (і `jobs.e2e-spec.ts` лишається зеленим), а переїжджає **тим самим
PR на MT-3**, який дає можливість завести другого тенанта.

> ⚠️ **Гейт MT-3 (жорсткий):** заборонено створювати другого тенанта, поки `/jobs` не прибрано
> з tenant-api. Порядок усередині MT-3: спершу перенесення моніторингу, потім CRUD тенантів.
> Якщо в dev хтось заведе другу `Organization` руками до MT-3 — `/jobs` покаже чужі джоби.

Пізніше, якщо тенантам таки знадобиться видимість своїх асинхронних операцій, правильна відповідь —
**доменний вигляд** (таблиця `imports`/`exports` зі своїм `status` під RLS), а не сирий монітор черги.

---

## MT-0 — ролі Postgres (інфраструктура)

**Мета:** розділити права ДО того, як з'явиться що захищати. Окремий маленький PR — його легко
відкотити, і він нічого не ламає.

1. `docker/postgres/init/01-roles.sql` (монтується в `/docker-entrypoint-initdb.d/`):
   ```sql
   CREATE ROLE saas_migrator LOGIN PASSWORD 'saas_migrator';
   CREATE ROLE saas_app      LOGIN PASSWORD 'saas_app';
   CREATE ROLE saas_platform LOGIN PASSWORD 'saas_platform' BYPASSRLS;

   -- власник схеми — migrator; app отримує DML, але не DDL
   ALTER SCHEMA public OWNER TO saas_migrator;
   ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO saas_app, saas_platform;
   ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO saas_app, saas_platform;
   GRANT USAGE ON SCHEMA public TO saas_app, saas_platform;
   ```
2. `docker-compose.yml`: змонтувати init-скрипт у сервіс `postgres`.
3. Env: `DATABASE_URL` → `saas_app`; **новий** `MIGRATE_DATABASE_URL` → `saas_migrator`;
   **новий** `PLATFORM_DATABASE_URL` → `saas_platform`. Оновити `.env.example`,
   `.env.production.example`, README.
4. `libs/database/package.json`: скрипти `db:migrate:*` ганяти під `MIGRATE_DATABASE_URL`.
5. [apps/api/test/global-setup.ts](../apps/api/test/global-setup.ts): створювати ролі в тестовій
   БД (вона створюється скриптом, init-скрипт docker на неї не діє) і мігрувати під migrator.
6. CI: той самий крок створення ролей для Postgres-сервісу.

> ⚠️ **Init-скрипти Postgres виконуються ТІЛЬКИ на порожньому volume.** Наявні dev-бази ролей
> не отримають. Шлях для розробників: `pnpm docker:down -v && pnpm docker:up` (втрата dev-даних,
> відновлюється `db:migrate:dev && db:seed`) або разовий ручний прогін `01-roles.sql`.
> Записати в README і в CLAUDE.md.

**DoD:** `docker:up` на чистому volume створює три ролі; міграції йдуть під migrator; api/worker
працюють під `saas_app`; e2e зелені. **Відкат:** revert PR + `docker:down -v`.

---

## MT-1 — схема + tenant-контекст (RLS ще ВИМКНЕНО)

**Мета:** ввести tenant-контекст наскрізно (HTTP + черги) при N=1, нічого не змінивши для
користувача. Найбільша фаза; RLS свідомо не чіпаємо — спершу доводимо, що контекст доїжджає.

### 1.1 Схема і міграція

`libs/database/prisma/schema.prisma`:

```prisma
model Organization {
  id        String   @id @default(uuid())
  slug      String   @unique          // під піддомени (MT-4)
  name      String
  isActive  Boolean  @default(true) @map("is_active")
  locale    String   @default("en")   // дефолт для нових юзерів
  settings  Json     @default("{}")   // гнучкий хвіст (§10 плану)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  users User[]
  files File[]

  @@map("organizations")
}

model User {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  email    String                      // @unique ЗНЯТО
  // ...решта без змін
  organization Organization @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, email])
  @@unique([tenantId, id])            // опора для композитних FK
  @@index([tenantId, createdAt])
  @@map("users")
}
```

Аналогічно `RefreshToken`, `File`, `Attachment` — `tenantId` + композитні FK
(`@relation(fields: [tenantId, userId], references: [tenantId, id])`) + індекси з префіксом
`tenantId`. `ProcessedJob` — **не чіпати**.

SQL-міграція (`cd libs/database && pnpm exec prisma migrate dev --name multi_tenancy_foundation`
— пам'ятай правило CLAUDE.md: **не** через `pnpm ... -- --name`), порядок критичний:

```sql
-- 1. organizations + дефолтний tenant (well-known UUID — той самий у seed і env)
CREATE TABLE "organizations" (...);
INSERT INTO "organizations" (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default Organization');

-- 2. expand: колонка nullable
ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;

-- 3. backfill: усі наявні рядки → дефолтний tenant
UPDATE "users" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';

-- 4. contract: NOT NULL + FK + індекси
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT ... FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id");
DROP INDEX "users_email_key";
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE UNIQUE INDEX "users_tenant_id_id_key"    ON "users"("tenant_id", "id");
-- DEFAULT current_setting(...) НЕ ставимо — це MT-2, разом з RLS
```

`libs/database/prisma/seed.ts`: `upsert` дефолтної організації **перед** admin-юзером; admin
створюється в ній.

### 1.2 Tenant-контекст: `TenancyModule` (nestjs-cls)

> Публічний API модуля, контракт доменного модуля і повна таблиця збірки застосунків —
> **§6 плану**. Тут — що саме створити й куди підключити.

- `pnpm add nestjs-cls` (apps/api + apps/worker).
- **`libs/database/src/tenant/`** — окремої `libs/tenancy` **не заводимо** (§6 плану: підключабельність
  дає межа модуля, а не тека; extension намертво Prisma-залежний; нова ліба = податок трьох місць
  із правила №1 CLAUDE.md):
  - `TenantContextService` — обгортка над `ClsService` (`getTenantId()` / `runWith(id, fn)`);
    воркер і інфраструктура працюють з нею, не з CLS напряму.
  - `TenantResolver` (abstract) + `JwtTenantResolver` + `StaticTenantResolver` (env-константа).
    `SubdomainTenantResolver` — заглушка під MT-4.
  - `TenantResolutionMiddleware` — кличе резолвер, піднімає CLS; **монтується на всі роути,
    включно з `@Public()`** (інакше login/register не резолвляться — «Поломка 1»).
  - `forTenant()` extension (поки **тільки** `set_config`), `withTenantTx()`.
  - **`TenancyModule.forRoot({ resolver? })`** — публічний вхід. `resolver` опційний: apps/api
    передає, apps/worker ні (там tenantId із payload).
- `SystemPrismaService` — окремий провайдер на `PLATFORM_DATABASE_URL` (BYPASSRLS) для
  maintenance/cron. **Не** реєструвати глобально: інжектиться явно, щоб випадково не взяли.
- **Збірка** (єдине місце, де згадується MT):
  ```ts
  // apps/api/src/app.module.ts
  imports: [TenancyModule.forRoot({ resolver: JwtTenantResolver }), UsersModule, FilesModule, ...]
  // apps/worker/src/worker.module.ts
  imports: [TenancyModule.forRoot(), ...]   // без резолвера
  ```
  Порядок у ланцюгу apps/api: `ClsMiddleware` (найраніше, `mount` на всі роути) →
  `TenantResolutionMiddleware` → `JwtAuthGuard` (пише `tenantId` у CLS і **звіряє** з резолвленим).
- `JwtPayload` += `tenantId`; `generateTokens()` кладе його в claim; `tenantId` у кожен
  лог-запис (це і закриває пункт про correlationId з фази 3 roadmap — робити разом).
- `auth.service`: `findUnique({ where: { email } })` → композит (див. «Поломка 1»).
- **Доменні модулі (`users`, `files`) не чіпаємо взагалі** — це і є перевірка §6: якщо якийсь
  довелося відкрити заради tenantId, абстракція протекла.

### 1.3 Черги

- `job-definition.ts`: `defineTenantJob(name, schema, opts)` — базова схема
  `z.object({ tenantId: z.uuid() }).extend(...)`; `JobDefinitionOptions` += `scope?: 'tenant' | 'system'`
  (дефолт `'tenant'`).
- Класифікація наявних джоб:

  | Джоба | Scope | Чому |
  | --- | --- | --- |
  | `users.user-registered` | tenant | створює ефекти в tenant-і |
  | `notifications.welcome-email` | tenant | читає юзера з БД |
  | `files.generate-thumbnail` | tenant | читає/пише `files` |
  | `auth.cleanup-expired-tokens` | **system** | cron, крос-tenant, BYPASSRLS-клієнт |
  | `files.cleanup-orphans` | **system** | cron, крос-tenant, BYPASSRLS-клієнт |

- `pg-boss.dispatcher.ts`: для `scope: 'tenant'` домішувати `tenantId` з `TenantContextService`
  **до** `schema.parse` (інакше parse впаде на відсутньому полі). Виклики в доменному коді
  (`auth.service.ts:48`) не міняються — tenantId додається сам.
- `job-worker.registrar.ts`: у `runJob()` для tenant-джоб обгорнути `handler.handle()` у
  `cls.run` + `set('tenantId', payload.tenantId)`; для system — не піднімати контекст.
  `tenantId` у лог-конверт.
- `job-inbox.service.ts`: `set_config` першим стейтментом транзакції (§7 плану).
- Хендлери (`apps/worker/src/handlers/*`) — **не міняються**, крім двох системних, які
  перемикаються на `SystemPrismaService`.

### 1.4 Storage

`storage.service.ts` / `files.service.ts`: ключі `{tenantId}/{yyyy}/{mm}/{uuid}.ext`
(коментар у схемі це вже передбачив). Наявні файли в dev — не мігруємо (dev-дані одноразові);
для форків з даними — окрема разова джоба, поза цим планом.

### 1.5 ESLint

`no-restricted-syntax`: заборонити `prisma.$transaction(` у `apps/api/src/**` і
`apps/worker/src/handlers/**` (легально — тільки `withTenantTx`); заборонити `tenantId`
в доменних сервісах (кастомне правило або grep у CI — див. DoD).

**DoD:**
- e2e (47) зелені **без змін у тестах** — поведінка при N=1 ідентична.
- `tenantId` присутній у JWT, у кожному лог-записі API і воркера, у payload tenant-джоб
  (перевірити живим прогоном: реєстрація → `pgboss.job.data` містить `tenantId`).
- `grep -rn "tenantId" apps/api/src --include=*.service.ts` → нічого, крім `auth.service.ts`
  (легально: видача JWT).
- **Переносність доменних модулів** (перевірка §6 плану): у diff-і фази теки `users/` і `files/`
  не фігурують; заміна `JwtTenantResolver` → `StaticTenantResolver` в `app.module.ts` — єдине,
  що потрібно для single-tenant збірки.
- RLS **вимкнено** — `pg_policies` порожній.

**Ризики / відкат:** найбільша фаза; ризик — забути `tenantId` у якомусь шляху. Відкат — revert
PR + `migrate resolve --rolled-back`. Дані не втрачаються (backfill ідемпотентний).

---

## MT-2 — увімкнення RLS

**Мета:** перевести ізоляцію з «контекст є, але ні на що не впливає» у справжній enforcement.
Код доменних модулів у цій фазі **не змінюється взагалі** — тільки SQL, `jobs.service.ts` і тести.

### 2.1 Міграція політик

Для кожної таблиці рівня 1 (`users`, `refresh_tokens`, `files`, `attachments`):

```sql
ALTER TABLE "users" ALTER COLUMN "tenant_id"
  SET DEFAULT current_setting('app.tenant_id')::uuid;   -- без missing_ok: запис без контексту падає

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "users"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));
```

`organizations` — особлива політика (tenant бачить лише свій рядок):

```sql
CREATE POLICY own_org ON "organizations"
  FOR ALL
  USING ("id" = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));
```

`processed_jobs` — **RLS не вмикати** (§7 плану).

### 2.2 Код

- Прибрати з доменного коду `tenantId` у `create`, якщо десь просочився (DB-default тепер сам).
- `/jobs` **не чіпаємо** — при N=1 витоку немає, переїзд у platform-api заплановано на MT-3
  (див. «Поломка 2»). `jobs.e2e-spec.ts` лишається зеленим без змін.

### 2.3 Тести ізоляції (§12 плану — це і є суть фази)

- `test/tenant-isolation.e2e-spec.ts`: сід A і B; логін в A → get/update/delete сутностей B
  дають **404/порожньо**, не 403.
- `test/tenant-concurrency.e2e-spec.ts`: N одночасних запитів різних тенантів + штучна затримка
  в сервісі → кожен бачить лише своє (ловить витік CLS).
- `test/rls-smoke.e2e-spec.ts`: голий `pg` під `saas_app` **без** `set_config` → `count(*) = 0`
  по кожній tenant-таблиці. Ловить «завели таблицю, забули політику».
- CI-чек `pg_policies`: кожна таблиця з колонкою `tenant_id` має `rowsecurity = true` + політику.
- ⚠️ e2e мусять конектитись як **`saas_app`**, інакше RLS не діє й тести брешуть
  (`test-database.ts` + `global-setup.ts`).

**DoD:** rls-smoke дає 0 по всіх tenant-таблицях; крос-tenant e2e дає 404; конкурентний зелений;
`pg_policies`-чек у CI; **жодного `tenantId` у доменних сервісах**; наявні 47 e2e зелені.

**Ризики:** «нуль рядків усюди» = контекст не доїжджає (перевіряти `SHOW app.tenant_id`
всередині транзакції). Відкат дешевий: `DROP POLICY` + `DISABLE ROW LEVEL SECURITY` —
дані і код лишаються робочими (MT-1-стан).

---

## MT-3 — control plane (`apps/platform-api`)

**Мета:** винести крос-tenant операції в окремий процес, щоб у tenant-api їх фізично не існувало.

> ⚠️ **Порядок усередині фази жорсткий: спершу крок 4 (перенесення `/jobs`), і тільки потім
> крок 5 (CRUD тенантів).** Другий тенант у системі не має з'явитися раніше, ніж моніторинг
> черг залишить tenant-api — див. «Поломка 2».

1. `apps/platform-api` — NestJS за зразком `apps/api` (webpack, `configureApp()` перевикористати
   з `app.setup.ts`), роль `saas_platform`, **окремий JWT-secret**, свій `openapi.json` + orval.
2. `libs/contracts` → розділити на `contracts/tenant` і `contracts/platform` (незалежні
   OpenAPI-конвеєри). ⚠️ Нові шляхи = правило №1 CLAUDE.md (`tsconfig.base.json` +
   `apps/*/tsconfig.json` + `webpack.config.js`).
3. `platform_users` — окрема identity-таблиця, окремий login-флоу. **Не** перевикористовувати
   `users`.
4. **Перенесення моніторингу черг** (гейт для кроку 5): модуль `apps/api/src/jobs/` цілком →
   `platform-api` (там `pgboss.job` читається без фільтра — це легально, control plane і має
   бачити все); прибрати `/jobs` з `apps/web` (роут, i18n-namespace `jobs.json`, orval-хуки);
   `jobs.e2e-spec.ts` переїжджає в e2e platform-api.
5. **CRUD тенантів**: створення = `Organization` + перший admin-user + invite-токен + сід
   дефолтів (в одній транзакції під BYPASSRLS); suspend/resume (`Organization.isActive` → login
   у data plane відмовляє). Деталі invite-флоу — §3.1 нижче.
6. Глобальні довідники (рівень 2, §8 плану): моделі без `tenant_id`, `GRANT SELECT` для
   `saas_app`, запис — тільки `saas_platform`.

### 3.1 Invite-флоу першого admin-а (зафіксовано 2026-07-15)

**Принцип: оператор платформи НІКОЛИ не знає пароля tenant-адміна.** Пароль не генерується
платформою і не їде поштою — юзер задає його сам за одноразовим підписаним лінком.

Схема вже це підтримує: [`User.passwordHash` — nullable](../libs/database/prisma/schema.prisma#L17),
а [`auth.service.login`](../apps/api/src/auth/auth.service.ts#L71) уже відмовляє юзеру без хеша
(`if (!user?.passwordHash)`). Тобто «створений, але ще не активований» юзер — коректний стан
без жодних змін у login.

Токен — **за наявним патерном `refresh_tokens`**: `tokenId:secret`, у БД лише argon2-хеш secret-а
(не винаходимо новий механізм):

```prisma
model UserInvitation {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  userId    String   @map("user_id")
  tokenHash String   @map("token_hash")
  expiresAt DateTime @map("expires_at")   // TTL 72 год
  usedAt    DateTime? @map("used_at")      // одноразовість (НЕ delete — щоб бачити повторні спроби)
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([tenantId, id])
  @@index([tenantId, userId])
  @@map("user_invitations")
}
```

Флоу перетинає обидва plane-и:

```
platform-api (BYPASSRLS): Organization + User(passwordHash=null) + UserInvitation  ← одна транзакція
   → джоба notifications.user-invited (tenant-scope, tenantId у payload)
worker: лист із лінком https://{slug}.app.com/set-password?token={id}:{secret}
tenant-api: POST /auth/set-password  @Public()  ← tenant із TenantResolutionMiddleware (Host/env)
   → звірка argon2-хеша, expiresAt, usedAt → passwordHash + usedAt=now() в одній транзакції
apps/web: сторінка /set-password (RHF + zodResolver, як інші форми)
```

Таблиця `user_invitations` — рівень 1 (RLS): platform-api пише під BYPASSRLS, tenant-api читає
у своєму контексті. Роут `set-password` публічний, тому tenant там резолвиться з Host/env — той
самий middleware, що вже потрібен для login (див. «Поломка 1»).

> **Неузгодженість, яку треба буде вирівняти.** Зафіксоване рішення «Create user (API): пароль
> обов'язковий — адмін задає початковий» лишається чинним для tenant-рівня, тож у системі
> існуватимуть два способи завести юзера: invite (platform → перший admin) і прямий пароль
> (tenant-адмін → колеги). Побудований тут invite-флоу **повністю перевикористовний** для
> users-модуля. Питання «перевести й tenant-рівень на invite?» — окреме рішення користувача,
> поза MT (кандидат після MT-3).

**DoD:** tenant створюється з platform-api й одразу працює в data plane; перший admin входить
за invite-лінком, **пароль не існує ні в логах, ні в пошті, ні в оператора**; повторне
використання лінка → 400; протермінований → 400; токен platform-api не валідний у tenant-api
і навпаки (тест); у tenant-api немає жодного роута без tenant-скоупу; `/jobs` у tenant-api
відсутній.

---

## MT-4 — відкладене

- **Піддомени** (`acme.app.com` → slug → tenant): `TenantResolutionMiddleware` перемикається
  з env-константи на Host; ізоляція cookie. Хук закладений у MT-1.
- **Рівень 3 довідників** (глобальні + tenant-розширювані, nullable `tenant_id`) — коли
  з'явиться перший реальний каталог такого типу.
- **`apps/platform-web`** — UI control plane (поки достатньо API).
- **Білінг тенантів** — поверх `PaymentProvider` (фаза 4 roadmap).
- **Міграція файлів** під tenant-префікс для форків із наявними даними.

---

## Зафіксовані рішення по цих трьох питаннях (2026-07-15)

| Питання | Рішення | Наслідок для плану |
| --- | --- | --- |
| `/jobs` під MT | **Моніторинг черг — операторський інструмент, живе тільки в platform-api.** Фільтр по `data->>'tenantId'` у tenant-api відхилено (віддає деталі реалізації, тримається на формі payload, системні джоби все одно випадають) | Переїзд — на **MT-3**, не MT-2: до MT-3 система при N=1 (другого тенанта нема звідки взяти), тож витоку немає й провалу в моніторингу теж. Гейт: перенести **до** CRUD тенантів |
| Пароль першого admin-а | **Invite-лінк, юзер задає пароль сам.** Оператор платформи ніколи не знає пароля; пароль не існує у відкритому вигляді ніде | MT-3 §3.1. Токен за патерном `refresh_tokens` (`tokenId:secret` + argon2-хеш). Схема вже готова: `passwordHash` nullable, `login` уже відмовляє юзеру без хеша |
| `Organization.slug` | **Так, уже в MT-1** | Одна колонка + unique-індекс зараз замість міграції з бекфілом унікальних slug-ів для реальних тенантів на MT-4. Дефолтний tenant — `'default'` |

**Похідне питання, яке лишається відкритим** (поза MT, кандидат після MT-3): чи вирівнювати
tenant-рівневий create user на invite-флоу — зараз там чинне рішення «адмін задає початковий
пароль», тож способів завести юзера буде два. Invite-механіка з MT-3 для цього перевикористовна.

## Оцінка обсягу

| Фаза | Обсяг | Ризик | Блокує |
| --- | --- | --- | --- |
| MT-0 | малий (інфра, ~1 PR) | низький | MT-1 |
| MT-1 | **великий** (схема + контекст + черги) | середній | MT-2 |
| MT-2 | середній (SQL + тести) | середній (діагностика «нуль рядків») | RBAC, домени |
| MT-3 | великий (новий застосунок) | низький (ізольований) | — |
| MT-4 | за потребою | низький | — |

Порядок жорсткий: MT-0 → MT-1 → MT-2. MT-3 можна робити паралельно з доменними модулями
після MT-2. RBAC (`@RequirePermissions`) — після MT-2, поверх готового контексту.
Еталонний домен для обкатки принципу «MT невидима для бізнес-коду» — `customers`: він пишеться
вже після MT-2 і має бути написаний **без жодної згадки tenantId**.
