# Мультитенантність — план переходу (MT-0…MT-4)

> Зафіксовано: 2026-07-15. Це **план переходу**: що саме, у якому порядку і в яких файлах
> міняється, щоб довести поточний single-tenant скелетон до мультитенантного.
> **Рішення й обґрунтування — у [multi-tenancy-plan.md](multi-tenancy-plan.md)** (навіщо RLS,
> чому User в одному tenant-і, таксономія таблиць, підводні камені). Тут — механіка: кроки,
> SQL, файли, DoD, ризики й відкат. Дублювання свідомо немає: якщо питання «чому» — той док,
> «як і в якому порядку» — цей, «як воно виглядає готовим, без історії» —
> [multi-tenancy-architecture.md](multi-tenancy-architecture.md).
>
> Стан кодобази, від якого писався план: коміт `78310b7`, міграцій — 4, e2e — 61.

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
| — | — | **нова `tenants`** (= tenant + налаштування) | особлива (`id = ctx`) |

**Точки дотику в коді** (усе, що доведеться відкрити):

| Файл | Що змінюється | Фаза |
| --- | --- | --- |
| [libs/database/prisma/schema.prisma](../libs/database/prisma/schema.prisma) | `Tenant`, `tenant_id`, композитні FK, індекси | MT-1 |
| [libs/database/src/prisma.service.ts](../libs/database/src/prisma.service.ts) | + `SystemPrismaService` (BYPASSRLS) | MT-1 |
| `libs/database/src/tenant/` (нова тека) | `TenancyModule.forRoot()`, `TenantContextService`, `TenantResolver` + реалізації, middleware, `forTenant`, `withTenantTx` | MT-1 |
| [apps/api/src/app.module.ts](../apps/api/src/app.module.ts) | `TenancyModule.forRoot({ resolver: JwtTenantResolver })` — **єдина згадка MT у застосунку** | MT-1 |
| [apps/worker/src/worker.module.ts](../apps/worker/src/worker.module.ts) | `TenancyModule.forRoot()` (без резолвера) | MT-1 |
| `apps/api/src/users/`, `apps/api/src/files/` | ФАКТ MT-1: дві вимушені механічні правки без tenant-логіки — `findUnique({email})`→`findFirst` (unique став композитним) і `buildKey`→`storage.buildObjectKey` (префікс живе в інфрі); grep tenantId по сервісах — чистий | MT-1 ✓ |
| [libs/database/prisma/seed.ts](../libs/database/prisma/seed.ts) | сід дефолтного tenant-а перед admin-юзером | MT-1 |
| [apps/api/src/auth/auth.service.ts](../apps/api/src/auth/auth.service.ts) | `findUnique({email})` → композит; `tenantId` у JWT; **видалення `register()`**; `tenant.isActive` у login; refresh `tenantId:tokenId:secret` | MT-1 ⚠️ |
| [apps/api/src/auth/auth.controller.ts](../apps/api/src/auth/auth.controller.ts) + `dto/register.dto.ts` + contracts `RegisterSchema` + web (register-сторінка/роут) | **видалення register зовсім** (рішення 2026-07-16) → `openapi:generate` + `web:codegen` | MT-1 |
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
`findUnique({ where: { email } })` перестає компілюватися. І глибша проблема: **login —
`@Public()` роут, tenant-контексту з JWT там ще немає** (курка-яйце: щоб знайти юзера, треба
знати tenant; щоб знати tenant з токена, треба знайти юзера). (`register` цієї проблеми не має,
бо **видаляється зовсім** — рішення 2026-07-16, див. 1.2.)

**Рішення (зафіксовано 2026-07-16) — тенант до автентифікації резолвиться з недовіреної
підказки, яка лише звужує пошук:**

```
login:    опційне поле `tenant` (slug) у Login-payload → resolve_tenant(slug) → tenantId
             └─ N=1 (StaticTenantResolver): slug ігнорується, константа SAAS_DEFAULT_TENANT_ID з env
             └─ MT-4: піддомен (Host → slug) замість поля
refresh:  tenantId — префікс самого токена: `tenantId:tokenId:secret` (2026-07-16);
             для фронта рядок opaque — нічого не зберігає і не міняє
        → cls.set('tenantId', ...)  ← ще до JwtAuthGuard, для ВСІХ роутів
```

Це безпечно, бо slug/префікс **не дає доступу** — тільки обирає, де шукати: далі все одно
argon2-звірка креденшелів у цьому tenant-і, а `JWT.tenantId` береться **з рядка юзера в БД**,
не з запиту. Невірний slug → той самий 401, що й невірний пароль (без оракула «тенант існує»).
Slug → tenantId перетворює `SECURITY DEFINER` функція `resolve_tenant(slug)` (MT-2) — бо
`tenants` під RLS, і читати її по slug-у до автентифікації інакше неможливо.

Далі `auth.service` шукає юзера **у вже відомому tenant-і**:

```ts
const user = await this.prisma.user.findFirst({ where: { email: data.email } });
// під RLS (MT-2) це поверне юзера ТІЛЬКИ поточного tenant-а; до MT-2 — композитний findUnique
```

І `JwtAuthGuard` додатково **звіряє** `payload.tenantId` з резолвленим — інакше токен
tenant-а A, надісланий у контекст B, ліг би в контекст B:

```ts
if (payload.tenantId !== this.cls.get('tenantId')) throw new UnauthorizedException();
```

`cleanup-expired-tokens` (системна джоба) працює під BYPASSRLS — їй резолюція не потрібна.

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
> Якщо в dev хтось заведе другу `Tenant` руками до MT-3 — `/jobs` покаже чужі джоби.

Пізніше, якщо тенантам таки знадобиться видимість своїх асинхронних операцій, правильна відповідь —
**доменний вигляд** (таблиця `imports`/`exports` зі своїм `status` під RLS), а не сирий монітор черги.

---

## ✅ MT-0 — ролі Postgres (інфраструктура) — завершено 2026-07-16

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

## ✅ MT-1 — схема + tenant-контекст (RLS ще ВИМКНЕНО) — завершено 2026-07-16

**Мета:** ввести tenant-контекст наскрізно (HTTP + черги) при N=1, нічого не змінивши для
користувача. Найбільша фаза; RLS свідомо не чіпаємо — спершу доводимо, що контекст доїжджає.

### 1.1 Схема і міграція

`libs/database/prisma/schema.prisma`:

```prisma
model Tenant {
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

  @@map("tenants")
}

model User {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  email    String                      // @unique ЗНЯТО
  // ...решта без змін
  organization Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

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
-- 1. tenants + дефолтний tenant (well-known UUID — той самий у seed і env)
CREATE TABLE "tenants" (...);
INSERT INTO "tenants" (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'Default Tenant');

-- 2. expand: колонка nullable
ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;

-- 3. backfill: усі наявні рядки → дефолтний tenant
UPDATE "users" SET "tenant_id" = '00000000-0000-4000-8000-000000000001';

-- 4. contract: NOT NULL + FK + індекси
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT ... FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
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

### 1.2а Auth-зміни (рішення 2026-07-16)

- **Видалення `POST /auth/register` зовсім**: `auth.controller.ts` (роут) + `register.dto.ts` +
  `AuthService.register()` + `RegisterSchema` у contracts + web: сторінка/роут register,
  лінк з login, orval-хук; auth e2e: register-тести видаляються (лічильник e2e зміниться —
  єдина легальна зміна тестів у MT-1). Диспатч `users.user-registered` лишається тільки
  в адмінському create user (fan-out еталон не втрачається).
- **Login перевіряє `tenant.isActive`** додатково до `user.isActive`: suspend тенанта = відмова
  входу всім його юзерам, той самий 401 без деталізації причини.
- **Refresh-токен → формат `tenantId:tokenId:secret`**: `generateTokens()` додає префікс,
  `refresh()` парсить три частини, кладе tenantId у CLS-контекст (через `TenantContextService`),
  далі звірка argon2 як зараз. Фронту байдуже — рядок opaque. Наявні dev-токени старого формату
  просто дадуть 401 → перелогін (прийнятно для dev; прод-міграція токенів не потрібна —
  вони короткоживучі).
- Опційне поле `tenant` (slug) у `LoginSchema` — **додається в контракт уже в MT-1** (щоб не
  перегенеровувати конвеєр двічі), але резолвером споживається лише з MT-3
  (`SlugTenantResolver`); `StaticTenantResolver` його ігнорує. Фронт: ручне опційне поле на
  формі логіну (тимчасово, до піддоменів MT-4).
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
  (диспатч `users.user-registered` з адмінського create user — єдиний, що лишається після
  видалення register) не міняються — tenantId додається сам.
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
- e2e зелені; єдина легальна зміна тестів — **видалення register-тестів** (auth e2e), решта
  без змін — поведінка при N=1 ідентична.
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

### Граблі, спіймані при виконанні MT-1 (2026-07-16)

1. **Zod 4 `z.uuid()` — строгий RFC-шаблон** (version-ніббл `[1-8]`, variant `[89ab]`):
   «зручний» well-known id `00000000-0000-0000-0000-000000000001` ним НЕ валідний —
   `defineTenantJob` мовчки (через некритичний catch диспатчу) не ставив джоби.
   Виправлено на **`00000000-0000-4000-8000-000000000001`** (v4-подібний) скрізь.
2. **pg-boss на свіжій БД** іде install-шляхом `CREATE SCHEMA IF NOT EXISTS pgboss`,
   а Postgres перевіряє ACL **до** перевірки існування схеми → `saas_app` потребує
   `GRANT CREATE ON DATABASE` (додано в 01-roles.sql і ensure-roles.ts). На БД, де pgboss
   уже мав таблиці (MT-0-верифікація), це не проявлялося.
3. **`@default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)"))`**
   на `tenantId` — ключ до невидимості: без нього Prisma-типи вимагають tenantId у кожному
   `create`, і доменний код перестає бути tenant-agnostic на рівні компіляції.
4. **Extension НЕ застосовується до інтерактивних транзакцій і до операцій усередині `tx`** —
   тому `withTenantTx` на «голому» клієнті (токен `PRISMA_BASE`), а не на extended.
5. e2e: прямі `prisma.user.create(...)` у тестах ідуть ПОЗА request-CLS → DB-default не має
   контексту → тест-хелпер `test-users.ts` передає tenantId явно (тест-код = інфраструктура).

---

## ✅ MT-2 — увімкнення RLS — завершено 2026-07-16

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

`tenants` — особлива політика (tenant бачить лише свій рядок):

```sql
CREATE POLICY own_tenant ON "tenants"
  FOR ALL
  USING ("id" = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));
```

`processed_jobs` — **RLS не вмикати** (§7 плану).

Плюс **`resolve_tenant(slug)`** — вирішує курку-яйце slug-логіну (`tenants` під RLS, а читати
її по slug-у треба до автентифікації):

```sql
CREATE FUNCTION resolve_tenant(p_slug text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$ SELECT id FROM tenants WHERE slug = p_slug AND is_active $$;

REVOKE EXECUTE ON FUNCTION resolve_tenant(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION resolve_tenant(text) TO saas_app;
```

`SECURITY DEFINER` = виконується з правами власника (migrator), тому бачить крізь RLS; віддає
лише `uuid` (`NULL` для неіснуючого/suspended slug-а → далі звичайний 401). `saas_app` не має
прямого `SELECT` на чужі рядки `tenants` → перелічити тенантів неможливо. `SET search_path` —
обов'язковий для SECURITY DEFINER (захист від підміни таблиці через search_path).

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
`pg_policies`-чек у CI; **жодного `tenantId` у доменних сервісах**; наявні 61 e2e зелені.

**Ризики:** «нуль рядків усюди» = контекст не доїжджає (перевіряти `SHOW app.tenant_id`
всередині транзакції). Відкат дешевий: `DROP POLICY` + `DISABLE ROW LEVEL SECURITY` —
дані і код лишаються робочими (MT-1-стан).

### Граблі, спіймані при виконанні MT-2 (2026-07-16)

1. **`tenants` — БЕЗ `FORCE ROW LEVEL SECURITY`** (свідомий виняток): `resolve_tenant(slug)` —
   `SECURITY DEFINER` від власника таблиці (saas_migrator), FORCE діяв би і на власника
   і осліпив би функцію. На 4 доменних таблицях FORCE стоїть.
2. **Сід мусив переїхати під `saas_platform`**: upsert tenant-а під saas_app поза власним
   контекстом падає на WITH CHECK (створити НОВИЙ tenant під RLS неможливо — фіча, не баг).
3. **Прямі prisma-доступи e2e** (deleteMany/findFirst/фікстури) під saas_app поза CLS бачать
   0 рядків → переведені на `SystemPrismaService`; при цьому `setup-env.ts` ЗОБОВ'ЯЗАНИЙ
   перезаписати `PLATFORM_DATABASE_URL` на тестову БД — дефолт дивиться на dev,
   і тести чистили б dev-дані.
4. CI-чек `pg_policies` реалізовано як e2e-тест (`rls.e2e-spec.ts`) — ганяється в CI разом
   з рештою, окремий workflow-крок не потрібен.
5. Обмеження до MT-3: HTTP-конкурентність ДВОХ тенантів недосяжна (StaticTenantResolver
   завжди дає default) — CLS-конкурентність перевірена напряму через `runWith` A/B.

---

## ✅ MT-3 — control plane (`apps/platform-api`) — завершено 2026-07-17

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
5. **CRUD тенантів**: створення = `Tenant` + перший admin-user (**оператор задає початковий
   пароль** — рішення 2026-07-16, уніфіковано з «Create user: адмін задає початковий»;
   invite-флоу відкладено → §3.1) + сід дефолтів (в одній транзакції під BYPASSRLS);
   suspend/resume (`Tenant.isActive` → login у data plane відмовляє).
6. `SlugTenantResolver` у tenant-api (замість `StaticTenantResolver`): поле `tenant` (slug)
   з Login-payload → `resolve_tenant(slug)`; порожнє поле → fallback на env-константу
   (N=1-інсталяції працюють як раніше). Фронт: опційне поле slug на формі логіну.
7. Глобальні довідники (рівень 2, §8 плану): моделі без `tenant_id`, `GRANT SELECT` для
   `saas_app`, запис — тільки `saas_platform`.

### 3.1 Invite-флоу першого admin-а — ВІДКЛАДЕНО (2026-07-16), дизайн збережено під MT-4

> **Рішення 2026-07-16:** у MT-3 перший admin отримує початковий пароль від оператора
> (або сідиться програмний тестовий юзер) — консистентно з чинним «Create user: пароль
> обов'язковий, адмін задає початковий». Invite-флоу нижче — **цільовий стан** (принцип
> «оператор ніколи не знає пароля тенанта»), реалізується на MT-4/беклозі; дизайн зафіксований,
> щоб не проєктувати заново.

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
platform-api (BYPASSRLS): Tenant + User(passwordHash=null) + UserInvitation  ← одна транзакція
   → джоба notifications.user-invited (tenant-scope, tenantId у payload)
worker: лист із лінком https://{slug}.app.com/set-password?token={id}:{secret}
tenant-api: POST /auth/set-password  @Public()  ← tenant із TenantResolutionMiddleware (Host/env)
   → звірка argon2-хеша, expiresAt, usedAt → passwordHash + usedAt=now() в одній транзакції
apps/web: сторінка /set-password (RHF + zodResolver, як інші форми)
```

Таблиця `user_invitations` — рівень 1 (RLS): platform-api пише під BYPASSRLS, tenant-api читає
у своєму контексті. Роут `set-password` публічний, тому tenant там резолвиться з Host/env — той
самий middleware, що вже потрібен для login (див. «Поломка 1»).

> Відкладення invite (2026-07-16) зняло і колишню неузгодженість «два способи завести юзера»:
> тимчасово скрізь один спосіб — початковий пароль задає той, хто створює (оператор → перший
> admin; tenant-адмін → колеги). Коли invite буде реалізовано, переводити на нього можна буде
> обидва рівні одночасно.

**DoD:** tenant створюється з platform-api й одразу працює в data plane; перший admin входить
із паролем, заданим оператором; логін по slug-у працює (`SlugTenantResolver`), порожній slug →
env-fallback; токен platform-api не валідний у tenant-api і навпаки (тест); у tenant-api немає
жодного роута без tenant-скоупу; `/jobs` у tenant-api відсутній.

### Граблі, спіймані при виконанні MT-3 (2026-07-17)

1. **`paths` у app-tsconfig були мертві весь час**: `extends` ЗАМІНЮЄ `paths` цілком, а
   успадкований `baseUrl` резолвиться від tsconfig.base.json (корінь репо) — відносні
   `../../libs/...` вказували поза репо. Компіляція працювала через node_modules-симлінки
   pnpm (main пакета), але SUBPATH (`contracts/platform`, `shared/errors`) так не резолвиться
   → у platform-api власний `baseUrl: "."`; jest додатково потребує `moduleNameMapper`
   для subpath-ів.
2. **Guard-звірка «токен vs резолвлений tenant» мусить бути умовною**: зі SlugTenantResolver
   authenticated-запити не несуть slug → fallback давав default, і легальний токен tenant-а B
   отримував 401. Введено `TenantResolution.authoritative`: Static (N=1) — завжди авторитетна;
   slug — лише коли slug присутній у запиті; піддомени (MT-4) — завжди. Неавторитетний
   fallback не конфліктує з токеном — авторитет у підписаного JWT.
3. **Subpath-імпорт `@saas-skeleton/shared/errors` у platform-api — свідомий**: головний index
   ліби тягне pg-boss/@aws-sdk (webpack externals) — вони не потрібні control plane-у
   і не стоять у його package.json.
4. `AllExceptionsFilter` + `fieldConflictException` переїхали в `libs/shared/src/errors/`
   (спільні для обох plane-ів; у libs/shared додались deps nestjs-zod + contracts).
5. Auth control plane — МІНІМАЛЬНИЙ свідомо: login → access JWT 60m, БЕЗ refresh-механіки
   (операторів мало, перелогін прийнятний; розширюється за патерном tenant-api за потреби).

---

## ✅ `apps/platform-web` — UI control plane — завершено 2026-07-17

Клон каркасу `apps/web` (Vite + TanStack Router/Query + Zustand + HeroUI + react-i18next +
orval), а не нова архітектура — той самий набір бібліотек, свій `vite.config.ts` (порт 5174,
проксі на `:3002`), свій `orval.config.ts` (`input: '../platform-api/openapi.json'`).
`data-grid/`, `form/`, `theme-switcher.tsx`, `api-error.ts`, `page-items.ts`, `format.ts`
скопійовані **без змін** — вони generic, `ApiError`-конверт спільний для обох plane-ів.

**Сторінки:**
- **Tenants** (`/`) — список + `CreateTenantModal` + suspend/resume через `AlertDialog`-підтвердження.
  Свідомо **не** через `createDataGrid`: `GET /tenants` не приймає пагінацію/фільтри (адмінський
  список, сотні рядків не очікуються) — заводити фейкову route-search-схему заради переюзання
  гріда було б зайвою інфраструктурою під неіснуючу потребу.
- **Jobs** (`/jobs`) — перенесено з tenant-web практично 1:1 (той самий `createDataGrid`,
  той самий `JobsSearchSchema` у роуті): контракт джоб не змінювався, переїхав лише хост.

**Auth-стор — свідомий trade-off від tenant-web-патерна**: там access-токен живе тільки в
пам'яті + refresh у localStorage; тут access-токен (60m, без refresh — MVP platform-auth,
§3 вище) зберігається напряму в localStorage, інакше сесія губилася б на кожен F5. Прийнятно
для внутрішнього операторського інструменту; якщо platform-auth колись отримає refresh —
стор варто привести до того самого візерунка, що й tenant-web.

### Грабля: subpath-імпорт `@saas-skeleton/contracts/platform` у Vite/Rollup

`tsc --noEmit` і webpack (apps/api, apps/platform-api) резолвили `@saas-skeleton/contracts/platform`
без проблем — перший через tsconfig `paths`-wildcard, другий через явний webpack alias на
`libs/contracts/src`. Обидва **обходять** `package.json` пакета. Vite/Rollup для workspace-залежності
резолвить через справжню Node-алгоритміку (`exports`/`main` у `package.json`), а в
`libs/contracts/package.json` була лише `"main": "src/index.ts"` — без мапи для subpath-ів
build падав з «Rollup failed to resolve import». Фікс — явний `exports`:
```json
"exports": { ".": "./src/index.ts", "./platform": "./src/platform/index.ts" }
```
Актуально для будь-якого майбутнього subpath (`libs/shared/errors` поки що не імпортується
з жодного vite-застосунку, тому цього фіксу не потребував — але той самий клас проблеми
чекає, якщо колись знадобиться).

**Перевірено живим прогоном:** operator login → `/` показує реальні тенанти з БД (включно
з тими, що лишились із живих прогонів MT-3) → **New tenant** через UI-модалку створює
tenant + admin атомарно, рядок одразу в таблиці → **Suspend** з AlertDialog-підтвердженням
(«Globex Corp» and all its users will be locked out…) → статус і кнопка на льоту → **Resume**
повертає → сесія переживає F5 (init-auth із localStorage) → `/jobs` показує реальні джоби
з попередніх фаз (payload, стан, пагінація, фільтри queue/state) → консоль без помилок.

DoD: `pnpm build` увесь монорепо (6/6 таргетів, включно з platform-web) чистий;
`pnpm lint`/`pnpm typecheck` чисті; ручний e2e-прогін вище пройдено без правок після старту.

## MT-4 — відкладене

- **Піддомени** (`acme.app.com` → slug → tenant): `SubdomainTenantResolver` (Host → slug →
  `resolve_tenant`) замість поля на формі логіну; ізоляція cookie. Хук закладений у MT-1.
- **Invite-флоу першого admin-а** (перенесено з MT-3 рішенням 2026-07-16): дизайн — §3.1,
  включно з `UserInvitation` і `POST /auth/set-password`. Кандидат на той самий крок —
  вирівняти на invite і tenant-рівневий create user.
- **Рівень 3 довідників** (глобальні + tenant-розширювані, nullable `tenant_id`) — коли
  з'явиться перший реальний каталог такого типу.
- **Білінг тенантів** — поверх `PaymentProvider` (фаза 4 roadmap).
- **Міграція файлів** під tenant-префікс для форків із наявними даними.

---

## Зафіксовані рішення по цих трьох питаннях (2026-07-15)

| Питання | Рішення | Наслідок для плану |
| --- | --- | --- |
| `/jobs` під MT | **Моніторинг черг — операторський інструмент, живе тільки в platform-api.** Фільтр по `data->>'tenantId'` у tenant-api відхилено (віддає деталі реалізації, тримається на формі payload, системні джоби все одно випадають) | Переїзд — на **MT-3**, не MT-2: до MT-3 система при N=1 (другого тенанта нема звідки взяти), тож витоку немає й провалу в моніторингу теж. Гейт: перенести **до** CRUD тенантів |
| Пароль першого admin-а | ~~Invite-лінк (2026-07-15)~~ → **переглянуто 2026-07-16: invite ВІДКЛАДЕНО на MT-4**; у MT-3 оператор задає початковий пароль (уніфіковано з «Create user: адмін задає початковий») або сідиться тестовий юзер | Дизайн invite збережено в §3.1 як цільовий стан; неузгодженість «два способи завести юзера» знята — тимчасово скрізь один спосіб |
| `Tenant.slug` | **Так, уже в MT-1** | Одна колонка + unique-індекс зараз замість міграції з бекфілом унікальних slug-ів для реальних тенантів на MT-4. Дефолтний tenant — `'default'` |

**Рішення 2026-07-16 (друга ітерація відкритих питань):** register прибирається зовсім (MT-1);
refresh-токен → `tenantId:tokenId:secret` (MT-1); фронт — тимчасово ручне поле slug на логіні;
login перевіряє `tenant.isActive` (MT-1); slug → tenantId через `SECURITY DEFINER
resolve_tenant()` (MT-2); сутність перейменовано `Organization` → `Tenant`. Повні формулювання —
таблиця рішень у [multi-tenancy-plan.md](multi-tenancy-plan.md).

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
