# Мультитенантність — зафіксовані рішення та план впровадження

> Зафіксовано: 2026-07-15. Переглядає два рішення, зафіксовані 2026-07-11:
> «Postgres RLS — не вмикаємо» → **RLS стає основою ізоляції**, і «tenant = Organization +
> Membership» → **User належить рівно одному tenant-у** (§9). Перегляд ініційований користувачем.
> Пов'язані доки: [multi-tenancy-architecture.md](multi-tenancy-architecture.md) — довідник
> ПОТОЧНОГО стану (як воно працює зараз, без історії рішень; починати звідти, якщо не цікавить
> «чому саме так»), [architecture-proposal.md](architecture-proposal.md) (§3 — початкові варіанти,
> тепер уточнені тут), [roadmap.md](roadmap.md) (місце в загальному плані),
> [file-storage.md](file-storage.md) (ключі S3 під tenant-префікс).

## Головний принцип: мультитенантність невидима для бізнес-коду

Це вимога №1, з якої випливають усі рішення нижче. Доменний розробник, який пише
`customers` чи `tickets`, **не бачить tenant-а взагалі**: не пише `where`, не передає `tenantId`
у `create`, не думає про контекст. Мультитенантність живе в інфраструктурі (CLS + Prisma
extension + RLS + DB-default) і не протікає в сервіси, контролери й контракти.

```ts
// ❌ Так НЕ пишемо ніде в доменному коді
prisma.customer.findMany({ where: { tenantId: ctx.tenantId, status } });
prisma.customer.create({ data: { ...dto, tenantId: ctx.tenantId } });

// ✅ Так виглядає доменний код у MT-світі — ідентично single-tenant
prisma.customer.findMany({ where: { status } });   // RLS відсіче чужі рядки
prisma.customer.create({ data: dto });              // tenant_id підставить DB-default
```

Наслідок для code review: **поява `tenantId` у доменному сервісі — це запах**. Легальні місця,
де він згадується явно: інфраструктура (`libs/database` extension, `libs/shared` jobs),
auth (видача JWT), platform-api (control plane) і maintenance-джоби.

## Зафіксовані рішення (НЕ переглядати без запиту користувача)

| Питання                     | Рішення                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Модель ізоляції             | **Shared schema + `tenant_id` + Postgres RLS**. Schema-per-tenant і database-per-tenant відхилені (міграції ×N, вибух конекшенів, Prisma їх погано тримає)                                  |
| Роль RLS                    | **Основний enforcement**, не «додатковий рівень». Покриває ORM, `$queryRaw`, забуті join-и, майбутні звіти — усе, що йде в базу                                                             |
| Фільтрація в коді           | **Немає.** Extension НЕ домішує `where: { tenantId }` — він виставляє тільки RLS-контекст (`set_config`). Дубль фільтра відхилено: він розходиться з політикою при помилці й нічого не додає |
| Заповнення `tenant_id`      | **DB-default** `DEFAULT current_setting('app.tenant_id')::uuid` — база заповнює сама з сесійного контексту. Доменний код tenant-agnostic і на запис                                        |
| Передача контексту          | `nestjs-cls` (AsyncLocalStorage) → `set_config('app.tenant_id', ..., true)` **transaction-local**. Session-level `SET` заборонений (пул конекшенів → витік між запитами)                    |
| Джерело tenantId            | **Після автентифікації — тільки підписаний JWT** (або константа з env у single-tenant), ніколи з body/params/хедера. **До автентифікації** (login/refresh) — недовірена підказка лише *звужує пошук*: slug у Login-payload / Host; `JWT.tenantId` завжди береться з **рядка юзера в БД**, невірний slug = той самий 401, що й невірний пароль (без оракула існування тенанта) |
| Модель tenant-а             | **User належить рівно одному tenant-у** (`users.tenant_id NOT NULL`, `@@unique([tenantId, email])`). Membership/Invitations відхилені — див. §9                                            |
| Топологія                   | **Два plane-и**: `apps/api` (tenant, data plane) + `apps/platform-api` (control plane). Окремі identity, JWT-ключі, DB-ролі. Крос-tenant коду в tenant-api не існує фізично                 |
| Single- vs multi-tenant     | **Одна кодова база, single-tenant = N=1.** Колонка `tenant_id` є завжди; схема не форкається; код не гілкується на `if (multiTenant)` — це деплой-конфіг                                    |
| Fail-closed                 | Немає контексту → **нуль рядків** на читанні, **помилка** на записі. RLS-вимикача («пропускати все, якщо контекст порожній») немає — це fail-open і витік з однієї помилки в умові          |
| Довідники                   | Три рівні таблиць (§8): tenant-scoped (RLS), глобальні (GRANT SELECT, без RLS), глобальні+розширювані (nullable `tenant_id`)                                                                |
| Моніторинг черг (`/jobs`)   | **Тільки в control plane** (2026-07-15). `pgboss.*` — поза RLS; фільтр по `data->>'tenantId'` у tenant-api відхилено (віддає тенанту деталі реалізації черги, тримається на формі payload, системні джоби все одно випадають). Якщо тенанту колись треба видимість своїх операцій — **доменний вигляд** (`imports`/`exports` зі своїм `status` під RLS), не сирий монітор |
| Перший admin тенанта        | **Переглянуто 2026-07-16: invite-флоу ВІДКЛАДЕНО** (→ MT-4/беклог). Тимчасово — оператор задає початковий пароль при створенні тенанта (уніфіковано з рішенням «Create user: адмін задає початковий») або сідиться програмний тестовий юзер. Invite-механіка (одноразовий токен за патерном `refresh_tokens`, `passwordHash = null`, «оператор не знає пароля») лишається цільовим станом — дизайн у migration-доку, MT-4 |
| Реєстрація (`POST /auth/register`) | **Прибирається зовсім** (2026-07-16, MT-1). Self-serve реєстрації в tenant-api немає: юзерів створює tenant-адмін (create user), тенантів — platform-api. Публічний register під MT означав би «будь-хто зі slug-ом реєструється в чужу організацію» |
| Refresh під MT              | Формат токена — **`tenantId:tokenId:secret`** (2026-07-16): тенант на `/auth/refresh` резолвиться з самого токена (для фронта рядок opaque — нічого не зберігає і не змінює). `refresh_tokens` лишається під RLS; звірка — контекст із префікса, далі argon2 як зараз |
| `tenant.isActive` при вході | **Login перевіряє і `user.isActive`, і `tenant.isActive`** (2026-07-16, MT-1): suspend тенанта відмовляє вхід усім його юзерам. Той самий 401 без деталізації |
| Резолюція slug → tenantId   | **`SECURITY DEFINER` функція `resolve_tenant(slug) RETURNS uuid`** (2026-07-16, MT-2): `saas_app` має тільки `EXECUTE`, прямого `SELECT` на `tenants` поза власним рядком немає → перелічити тенантів неможливо. Окрему lookup-таблицю без RLS і BYPASSRLS-клієнт у резолвері відхилено |
| Фронт: вибір тенанта        | Тимчасово (2026-07-16) — **ручне опційне поле slug на формі логіну** (i18n-ключ, у N=1 порожнє). Цільово — піддомени (MT-4). Це єдиний легальний виняток «фронт знає про MT» — прапорець показу поля |
| `Tenant.slug`         | **Уже в MT-1** (2026-07-15) — одна колонка зараз замість міграції з бекфілом унікальних slug-ів для реальних тенантів на MT-4 (піддомени)                                                    |
| Назва сутності tenant-а     | **`Tenant` / таблиця `tenants`** (2026-07-16, перейменовано з `Organization`): «організація» — доменне слово, яке споживач скелетона може захотіти для власної бізнес-сутності; інфраструктурна сутність не мусить його займати |
| Пакування MT                | **`TenancyModule.forRoot({ resolver })` у `libs/database/src/tenant/`** (2026-07-15). Підключабельність дає **межа модуля** (динамічний модуль + інтерфейс `TenantResolver`), а не розташування теки → окрему `libs/tenancy` не заводимо (extension Prisma-залежний; нова ліба = податок трьох місць, правило №1 CLAUDE.md). Режим застосунку = вибір резолвера в корені: `JwtTenantResolver` (MT) / `StaticTenantResolver` (N=1) / без резолвера (worker). platform-api модуль **не імпортує** — див. §6 |

## 1. Топологія: data plane / control plane

**Data plane** — `apps/api` + `apps/web` (те, що вже є). Юзер логіниться *в межах свого tenant-а*;
поняття «інший tenant» на цьому рівні не існує ні в контрактах, ні в коді.

**Control plane** — `apps/platform-api` + `apps/platform-web` (обидва зроблені, MT-3):
створення/suspend тенантів, моніторинг черг, надалі — білінг тенантів, керування
глобальними довідниками.

| | Data plane (`apps/api`) | Control plane (`apps/platform-api`) |
| --- | --- | --- |
| Identity | `users` (tenant-scoped) | `platform_users` — окрема таблиця, окремий login-флоу |
| JWT | свій secret / пара ключів | **інший** secret / пара ключів |
| DB-роль | `saas_app` (RLS діє) | `saas_platform` (`BYPASSRLS`) |
| Мережа | публічний інтернет | обмежений доступ (VPN/allowlist) |
| Крос-tenant операції | коду не існує | єдине місце, де вони є |

Це сильніше за «одну API з роллю SUPERADMIN»: компрометація tenant-api (вкрадений токен, SSRF,
injection) **не дає шляху до крос-tenant операцій — відповідного коду в процесі немає**.

Спільне між plane-ами: `libs/database` (схема), `libs/shared`. `libs/contracts` варто розділити
на `contracts/tenant` і `contracts/platform`, щоб OpenAPI/orval-конвеєри були незалежні.

## 2. Чому саме RLS як основа

| Модель | Ізоляція | Міграції | Пул | Вердикт |
| --- | --- | --- | --- | --- |
| Shared schema + `tenant_id`, фільтр лише в коді | Слабка — одна забута `where` = витік | 1× | 1 | ❌ ніколи як єдиний шар |
| **Shared schema + `tenant_id` + RLS** | Сильна, на рівні БД | 1× | 1 | ✅ **обрано** |
| Schema-per-tenant | Середня | ×N | 1 (жонглювання `search_path`) | ❌ |
| Database-per-tenant | Максимальна | ×N | ×N (вибух конекшенів) | ❌ (хіба enterprise-форк) |

Вирішальний аргумент саме для нашої кодобази: фільтрація в Prisma-extension **не покриває
`$queryRaw`** — а він у нас уже є (jobs-модуль читає `pgboss.job`) і буде далі (звіти, аналітика).
RLS працює на рівні планувальника Postgres і покриває **все**, що доходить до бази.

## 3. Ролі Postgres (критично)

RLS **не діє на власника таблиці** і на ролі з `BYPASSRLS`/superuser. Тому мінімум три ролі:

```sql
-- 1. Власник схеми: ТІЛЬКИ міграції (prisma migrate). RLS на нього не діє — і не треба.
CREATE ROLE saas_migrator LOGIN PASSWORD '...';

-- 2. Runtime tenant-api і worker: НЕ власник, без BYPASSRLS → RLS діє. DDL-прав немає.
CREATE ROLE saas_app LOGIN PASSWORD '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO saas_app;

-- 3. Control plane + maintenance-джоби: бачить усе, але НЕ superuser.
CREATE ROLE saas_platform LOGIN PASSWORD '...' BYPASSRLS;
```

Env: `DATABASE_URL` (api/worker) → `saas_app`; `MIGRATE_DATABASE_URL` → `saas_migrator`;
`PLATFORM_DATABASE_URL` → `saas_platform`. Додатково `FORCE ROW LEVEL SECURITY` на кожній
tenant-таблиці — страховка на випадок, якщо runtime колись піде під власником.

## 4. Політики

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON customers
  FOR ALL
  USING      (tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));
```

Три неочевидні деталі:

- **`current_setting(..., true)`** — `missing_ok`: без контексту повертає NULL → порівняння false
  → **нуль рядків (fail-closed)**, а не помилка і не «всі рядки». `nullif(..., '')` — бо після
  `RESET` setting стає порожнім рядком, який падає на касті до `uuid`.
- **Обгортка `(SELECT ...)`** — планувальник обчислює setting один раз (InitPlan), а не на кожен
  рядок. На великих таблицях це різниця в рази.
- **`WITH CHECK` обов'язковий** — без нього INSERT/UPDATE може *записати* рядок у чужий tenant,
  хоч і не зможе його прочитати.

Prisma migrate політик не знає — пишемо їх руками у SQL-міграції (наші міграції і так plain SQL).
CI-чек: кожна таблиця з колонкою `tenant_id` має `rowsecurity = true` і політику (запит до
`pg_policies` / `pg_tables`) — ловить «завели таблицю, забули політику».

## 5. Механіка контексту: JWT → CLS → set_config → DEFAULT

Повний ланцюг, у якому `tenant_id` доходить від токена до рядка в таблиці, **ні разу не пройшовши
через доменний код**:

```
1. Login       → JWT { sub, tenantId, role }          (підписаний; клієнт підробити не може)
2. Guard       → JwtAuthGuard валідує, дістає tenantId
3. CLS         → cls.set('tenantId', ...)             (AsyncLocalStorage, per-request)
4. Extension   → SELECT set_config('app.tenant_id', $1, true)   ← перший стейтмент транзакції
5. Postgres    → RLS фільтрує читання / перевіряє запис
                 DB-default заповнює tenant_id на INSERT
```

```ts
// libs/database: tenant-scoped клієнт
export function forTenant(prisma: PrismaService, cls: ClsService) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const tenantId = cls.get('tenantId');
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
```

```sql
-- міграція: база сама заповнює tenant_id з сесійного контексту
ALTER TABLE customers ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id')::uuid;
```

Тут `current_setting` **без** `missing_ok` — свідомо: без контексту INSERT має впасти
(fail-closed на запис), тоді як на читанні той самий брак контексту дає нуль рядків.

**Чому конкурентність це не ламає.** `cls.get()` читає не глобал, а store, прив'язаний до
поточного async-контексту: кожен запит виконується всередині власного `als.run()`, і вся
асинхронна робота в ньому успадковує саме цей store через `async_hooks`. Коли запит A чекає на
БД, event loop виконує B; коли A відновлюється — контекст A відновлюється разом із ним.
Другий рубіж: `set_config(..., true)` transaction-local на конкретному конекшені з пулу —
скидається на COMMIT. Витік стається не від навантаження, а від (а) зберігання tenantId на
shared-об'єкті замість CLS, (б) `cls.set()` поза активним `cls.run()` (порядок enhancer-ів:
контекст піднімати найраніше — `ClsMiddleware`, tenantId писати в JWT-guard), (в) розриву
async-ланцюжка у власних пулах колбеків. Усе це ловиться конкурентним e2e-тестом (§12).

### Інтерактивні транзакції — окремий випадок

Extension обгортає **окремі операції**. Коли сервіс сам відкриває `prisma.$transaction(async tx => ...)`
(зокрема наш `JobDispatcher.send({ tx })` через `fromPrisma`), обгортка не спрацює — batch
усередині tx неможливий. Правило: **першим стейтментом кожної інтерактивної транзакції — `set_config`**.
Загорнути в хелпер і заборонити голий `$transaction` у доменних модулях ESLint-правилом
(`no-restricted-syntax`):

```ts
async withTenantTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const tenantId = this.cls.get('tenantId');
  return this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
```

Кандидат на майбутнє, коли транзакцій стане багато: `@nestjs-cls/transactional` + prisma-адаптер
(транзакція живе в CLS, `set_config` в одному місці).

## 6. Модуль тенантності: публічний API і збірка застосунків

§5 описує, *як працює* механіка. Цей розділ — *як вона пакується* і як із неї збираються
застосунки. Мета — щоб доменний модуль (users, customers) був **фізично переносний** між
мультитенантним і single-tenant застосунком без жодної зміни в коді.

### Що робить модуль підключабельним

Підключабельність дає **не тека, а межа модуля**: динамічний `TenancyModule.forRoot()` +
інтерфейс резолвера. Резолвер — єдина точка, де вирішується «звідки взяти tenantId»:

```ts
// libs/database/src/tenant/tenant-resolver.ts
export abstract class TenantResolver {
  abstract resolve(req: Request): string | undefined;
}

class JwtTenantResolver       extends TenantResolver { /* клейм JWT + звірка з Host */ }
class StaticTenantResolver    extends TenantResolver { /* константа з env — режим N=1 */ }
class SubdomainTenantResolver extends TenantResolver { /* Host → slug → tenant (MT-4) */ }
```

Решта механіки від резолвера не залежить: CLS, `set_config`, extension, `withTenantTx`
працюють однаково незалежно від того, звідки приїхав tenantId.

### Склад модуля

| Компонент | Призначення | Кому потрібен |
| --- | --- | --- |
| `TenantContextService` | обгортка над CLS: `getTenantId()`, `runWith(id, fn)` | усім (ядро) |
| `TenantResolver` | стратегія «звідки tenantId» — **тільки HTTP** | apps/api |
| `TenantResolutionMiddleware` | кличе резолвер → піднімає CLS (**і для `@Public()` роутів**) | apps/api |
| Prisma extension `forTenant` | `set_config` першим стейтментом транзакції | усім, хто пише в БД |
| `withTenantTx` | інтерактивні транзакції (§5) | усім, хто пише в БД |

Воркеру резолвер **не потрібен**: tenantId приїжджає в payload, і реєстратор джоб кличе
`runWith(payload.tenantId, ...)` напряму. Тому `resolver` у `forRoot()` — опційний параметр.

### Збірка застосунків

Мультитенантність згадується **рівно один раз — у корені застосунку**. Доменні модулі в обох
випадках однакові байт-у-байт:

```ts
// apps/api — мультитенантний
@Module({
  imports: [
    TenancyModule.forRoot({ resolver: JwtTenantResolver }),
    UsersModule,      // ← незмінний
    CustomersModule,  // ← незмінний
  ],
})

// форк-інстанс — single-tenant, інший процес Node
@Module({
  imports: [
    TenancyModule.forRoot({ resolver: StaticTenantResolver }),  // TENANT_ID з env
    UsersModule,      // ← ТОЙ САМИЙ код
  ],
})
```

| Застосунок | `TenancyModule` | Резолвер | Клієнт БД |
| --- | --- | --- | --- |
| `apps/api` (MT) | `forRoot({ resolver })` | `JwtTenantResolver` → `SubdomainTenantResolver` на MT-4 | `PrismaService` (`saas_app`) |
| Форк single-tenant | `forRoot({ resolver })` | `StaticTenantResolver` (env) | `PrismaService` (`saas_app`) |
| `apps/worker` | `forRoot()` без резолвера | — (tenantId із payload) | `PrismaService` + `SystemPrismaService` для cron |
| `apps/platform-api` | **не імпортує взагалі** | — | `SystemPrismaService` (`saas_platform`, BYPASSRLS) |

Останній рядок — найважливіший: у platform-api модуля тенантності **немає в графі залежностей**.
Разом із дзеркальним фактом «у tenant-api немає крос-tenant коду» це робить розділення plane-ів
(§1) структурним, а не декларативним.

### Контракт доменного модуля

| | Доменний модуль (users, customers, billing…) |
| --- | --- |
| **МОЖЕ** | інжектити `PrismaService`; писати запити без `where: { tenantId }`; створювати рядки без `tenantId` у `data`; **використовувати транзакції на кілька таблиць — через `withTenantTx`** |
| **НЕ МОЖЕ** | імпортувати `TenantContextService`; згадувати `tenantId`; інжектити `SystemPrismaService`; кликати `prisma.$transaction` **голим** |

> ⚠️ **«Не можна голий `$transaction`» ≠ «не можна транзакції».** Транзакції доменному коду
> повністю доступні — обмеження стосується **тільки імені обгортки**. `withTenantTx` — це той
> самий інтерактивний `$transaction`, у якому першим стейтментом уже виконано `set_config`:
>
> ```ts
> // ✅ Оплата: кілька таблиць, атомарно, tenantId не згадується
> await this.withTenantTx(async (tx) => {
>   await tx.invoice.update({ where: { id }, data: { status: 'PAID' } });
>   await tx.payment.create({ data: { invoiceId: id, amount } });
>   await tx.ledgerEntry.create({ data: { invoiceId: id, debit: amount } });
> });
> ```
>
> Код усередині ідентичний тому, що був би з голим `$transaction`. **Причина обгортки** (§5):
> extension обгортає *окремі операції* власною batch-транзакцією і не може вставити `set_config`
> в інтерактивну транзакцію, яку відкрив ти — це була б транзакція в транзакції. Без `set_config`
> RLS у такій транзакції побачить порожній контекст: `update` не знайде рядка, `create` впаде на
> DB-default. Наслідок помилки — **гучна поломка, не витік**; ESLint-заборона голого
> `$transaction` існує, щоб її не можна було написати випадково.
>
> ⚠️ Приклад вище ілюструє **тільки tenant-механіку** — не копіювати як зразок реального платежу.
> Виклик зовнішнього провайдера **не має бути всередині транзакції БД**: мережевий виклик тримає
> рядки заблокованими, а якщо провайдер списав гроші й транзакція потім упала — `ROLLBACK` цього
> вже не полагодить. Робочий патерн: намір (`PENDING`) в одній транзакції → вихід із неї → виклик
> провайдера → результат (`PAID`/`FAILED` + ledger) у другій, плюс idempotency-key проти
> подвійного списання при retry. Це дизайн billing-модуля (фаза 4 roadmap), до tenant-контексту
> ортогональний — обидві транзакції однаково йдуть через `withTenantTx`.

Це і є перевірюваний критерій із §0: якщо доменний модуль порушує «не може» — він перестає бути
переносним, і мультитенантність протекла.

### Чого прибрати НЕ можна (чесні межі)

Портативність існує на рівні **композиції застосунку**, не на рівні схеми:

1. **Колонка `tenant_id` лишається завжди** — це рішення «single-tenant = N=1, не форк схеми» (§11).
2. **`TenancyModule` обов'язковий.** Не підключити його не можна: без `set_config` DB-default
   `current_setting('app.tenant_id')::uuid` впаде на INSERT, а RLS дасть нуль рядків на SELECT.
   Це не баг, а той самий fail-closed. Модуль можна зробити **тривіальним**
   (`StaticTenantResolver`), але не відсутнім.
3. Тому точне формулювання — не «підключимо users до застосунку без мультитенантності», а
   **«…до застосунку, де тенант один і статичний»**. Функціонально це те саме; концептуально —
   N=1, а не «MT вимкнено».

### Де фізично лежить: `libs/database/src/tenant/`, а не окрема ліба

Нової `libs/tenancy` **не заводимо**. Причини: (а) підключабельність дає межа модуля
(`forRoot` + резолвер), а не розташування теки; (б) extension намертво прив'язаний до Prisma —
концептуально це шар доступу до даних; (в) нова ліба коштує три місця з правила №1 CLAUDE.md
(`tsconfig.base.json` + `apps/*/tsconfig.json` + `webpack.config.js`), і платити цей податок
за нульовий виграш немає сенсу.

Це той самий хід, що вже зроблено свідомо з i18n: worker не тягне `libs/i18n` «заради самого
факту спільності». Якщо шар колись розростеться (наприклад, з'явиться tenant-логіка поза БД) —
переїзд теки механічний.

## 7. Черги і worker

**CLS не перетинає межу процесу.** Черга — серіалізаційна межа; tenantId їде через неї
**в payload**, а на тому боці контекст **відновлюється заново** з payload. Патерн дзеркальний
до HTTP: там tenantId із JWT → CLS, тут із payload → CLS.

```
API (CLS=tenantId з JWT)
   → dispatcher домішує tenantId у payload
   → pgboss.job (payload durable; НЕ під RLS — інфра-схема)
   ─────── межа процесу, CLS зникає ───────
Worker: @JobHandler-обгортка робить cls.run + set tenantId З PAYLOAD
   → withTenantTx / inbox роблять set_config із CLS
   → RLS + DB-default → запис у правильний tenant
```

Два рівні захисту від «забули tenantId»:

1. **Базова схема `defineJob` вимагає tenantId** — tenant-джобу без нього не оголосити:
   ```ts
   const tenantJob = (name, schema, opts) =>
     defineJob(name, z.object({ tenantId: z.uuid() }).extend(schema.shape), opts);
   ```
2. **`JobDispatcher.send` домішує tenantId із CLS сам** — виклик лишається чистим:
   ```ts
   dispatcher.send(GenerateInvoiceJob, { customerId });   // tenantId додасться сам
   ```

На боці worker контекст піднімає **інфраструктура**, не хендлер:

```ts
// обгортка навколо виклику хендлера (JobWorkerRegistrar)
await this.cls.run(async () => {
  this.cls.set('tenantId', job.data.tenantId);
  await handler.handle(job);
});
```

### Пастка: `JobInboxService.runOnce`

[libs/shared/src/jobs/job-inbox.service.ts](../libs/shared/src/jobs/job-inbox.service.ts) відкриває
**власну** транзакцію (вставка в `processed_jobs` + `fn` атомарно). Отже, вона теж мусить починатися
з `set_config` — інакше бізнес-записи всередині `fn` не побачать tenant-контексту і DB-default
не спрацює. `processed_jobs` при цьому лишається інфра-таблицею **без** `tenant_id` і без RLS
(маркер ідемпотентності глобальний) — `set_config` тут потрібен виключно заради `fn`.

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${this.cls.get('tenantId')}, true)`;
  await tx.processedJob.create({ data: { id: job.id, jobName: job.name } });
  await fn(tx);
});
```

### Системні (крос-tenant) джоби

Cron на кшталт `files.cleanup-orphans` за природою не належить одному tenant-у: tenantId у payload
немає, tenant-CLS не піднімається, БД — через окремий **системний PrismaClient під `saas_platform`
(`BYPASSRLS`)**, тільки для maintenance. Щоб їх не сплутати з tenant-джобами — прапорець у
`defineJob` (`{ scope: 'system' }`), і `@JobHandler`-інфраструктура вирішує, піднімати контекст чи ні.
Так «забути tenantId» стає неможливим для tenant-джоби і **свідомим** для системної.

## 8. Таксономія таблиць

| Рівень | Приклади | `tenant_id` | Механізм ізоляції |
| --- | --- | --- | --- |
| **1. Tenant-scoped** | `customers`, `tickets`, `users`, `files` | `NOT NULL` + DB-default | RLS (`USING` + `WITH CHECK`), FORCE |
| **2. Глобальні довідники** | `countries`, `cities`, `currencies` | немає | **GRANT**: `saas_app` — тільки `SELECT`; запис — `saas_platform` |
| **3. Глобальні + розширювані** | каталоги з дефолтами й tenant-додатками | `NULL`able | RLS: читання `tenant_id IS NULL OR = ctx`; запис — тільки свій |
| **Інфра** | `pgboss.*`, `processed_jobs` | немає | поза схемою ізоляції; tenantId — у payload джоби |

**Рівень 2** — розмежування через table privileges, не політики: менше рухомих частин, довідник
фізично read-only для будь-якого tenant-а. Керується з `platform-api`.

**Рівень 3** — «спільне + власні доповнення»:

```sql
CREATE POLICY ref_read ON product_categories
  FOR SELECT
  USING (tenant_id IS NULL
         OR tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));

CREATE POLICY ref_own_write ON product_categories
  FOR ALL
  USING      (tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid));
```

`WITH CHECK` не дасть tenant-у створити глобальний (`NULL`) або чужий рядок: спільні дані він
читає, але зіпсувати не може. Глобальні рядки заводить `platform-api`.

**`tenants`** — сам список тенантів: tenant-api бачить тільки «свій» рядок
(політика `id = ctx`), platform-api — всі.

**`files`** отримує `tenant_id` + RLS; ключі в бакеті — `{tenantId}/{yyyy}/{mm}/{uuid}.ext`
(коментар «префікс під майбутній tenantId» у схемі це вже передбачив). Бакет один; ізоляція —
через authz в API перед presign. Bucket-per-tenant не робимо.

## 9. Модель даних

### User належить рівно одному tenant-у (перегляд рішення від 2026-07-11)

Було зафіксовано «tenant = Organization + Membership { userId, organizationId, role }» (гнучкіше:
одна людина в кількох організаціях). **Переглянуто на користь `users.tenant_id NOT NULL`**:

| | Варіант A: User у одному tenant-і ✅ | Варіант B: глобальний User + Membership |
| --- | --- | --- |
| Ізоляція | структурна — «зв'язок з іншим tenant-ом» неможливий | логічна — `users` глобальна, поза tenant-RLS |
| JWT | `{ sub, tenantId, role }` | + вибір org при логіні, переключення = новий refresh-флоу |
| RLS на `users` | звичайна tenant-таблиця | неможлива (глобальна) — виняток у моделі |
| Ціна | та сама людина у двох тенантах = два акаунти | складніший auth і політики |

Для CRM/ERP «два акаунти для двох клієнтів» — норма й навіть бажано. `Tenant` лишається
(це сам tenant + його налаштування), а Membership/Invitations у data plane стають непотрібними:
**запрошення = створення юзера в tenant-і**.

### Композитні FK (FK обходять RLS!)

Перевірки referential integrity виконуються з правами власника таблиці і **політик не бачать** —
тобто `ticket.customer_id` теоретично може вказати на кастомера чужого tenant-а, і FK це пропустить.
Тому FK несуть tenant_id:

```prisma
model Customer {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  @@unique([tenantId, id])   // опора для композитних FK
  @@unique([tenantId, email]) // унікальність — у межах tenant-а, не глобальна
}

model Ticket {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  customer   Customer @relation(fields: [tenantId, customerId], references: [tenantId, id])
}
```

### Індекси

**Кожен доменний індекс починається з `tenant_id`**: `@@index([tenantId, status, createdAt])`.
RLS-предикат тоді стає range-scan по префіксу індексу, і оверхед практично нульовий.
Наявний `files @@index([status, createdAt])` доведеться перебудувати.

## 10. Налаштування tenant-а (single-row дані)

RLS дає тут бонус: контекст скоупить до одного tenant-а, тому «singleton» — це просто **єдиний
видимий рядок**, і `tenantId` навіть указувати не треба:

```ts
await prisma.organizationSettings.findFirst();   // ТА САМА одна строка поточного tenant-а
```

| Тип налаштування | Де зберігати |
| --- | --- |
| Структурні, типізовані, 1:1 з tenant-ом (назва, дефолтна локаль, ліміти) | **колонки на `Tenant`** — він *і є* tenant, один рядок = один tenant |
| Гнучкі, рідко-запитувані, еволюційні (UI-преференси, feature-flags) | **`Json`-колонка** `Tenant.settings` — погано для всього, що фільтруєш/джойниш |
| Налаштувань багато й вони логічно окремі | **1:1 таблиця `TenantSettings { tenantId @unique }`** — читання `findFirst()`, запис `upsert` |
| Користувацькі, довільні ключі | key-value `(tenantId, key, value)` — **не робити**, поки ключі задає розробник (втрата типів задарма) |

Старт: колонки на `Tenant` + `Json` для гнучкого хвоста. Виносити в окрему таблицю — коли
налаштувань стане реально багато.

## 11. Single-tenant і multi-tenant — одна кодова база

**«Немає тенантів» ≠ «немає колонки `tenant_id`».** Форк схеми = дві гілки міграцій = біль назавжди.
Правильна модель: колонка є **завжди**, single-tenant — це просто **N=1**.

| | Multi-tenant | Single-tenant |
| --- | --- | --- |
| Рядків `Tenant` | N | 1 (сідиться, id у env) |
| Звідки tenantId у контекст | з JWT після логіну | константа з env |
| `apps/platform-api` | задеплоєний | не деплоїться взагалі |
| RLS | увімкнено | увімкнено (тривіально матчить один id) |
| Схема БД, доменний код | **ідентичні** | **ідентичні** |

Правило, яке це тримає: **код ніколи не гілкується на `if (multiTenant)`** — він завжди йде через
tenant-контекст. Різниця стає суто операційною (скільки рядків `Tenant` + чи задеплоєний
control plane). Бонус: клієнта можна почати на single-tenant інсталяції й пізніше «підняти»
в multi-tenant кластер без зміни коду.

**RLS вимикачем не робити.** Політика «пропускати все, якщо контекст порожній» — fail-open;
одна помилка в умові = витік. Fail-closed + «завжди один tenant» простіше й безпечніше.

## 12. Тестування ізоляції (без цього RLS — театр)

1. **e2e «два тенанти»**: сід створює tenant A і B з даними; тест логіниться в A і перевіряє,
   що list/get/update/delete по ID сутностей B дають **404/порожньо, а не 403** (не палимо
   існування чужих ID).
2. **Конкурентний e2e** — ловить витік CLS: N одночасних запитів різних тенантів, кожен бачить
   тільки своє. З `await`-затримкою в сервісі, щоб гарантовано було чергування.
   ```ts
   await Promise.all(tenants.map((t) =>
     request(app).get('/customers').set('Authorization', `Bearer ${t.token}`)
       .expect(200)
       .expect((res) => expect(res.body.items.every((c) => c.tenantId === t.id)).toBe(true)),
   ));
   ```
3. **RLS smoke на рівні SQL**: голим `pg` під роллю `saas_app` **без** `set_config` зробити
   `SELECT count(*)` по кожній tenant-таблиці → очікувати `0`. Ловить «забули політику на новій
   таблиці».
4. **CI-чек по `pg_policies`**: кожна таблиця з колонкою `tenant_id` має `rowsecurity = true`
   і політику.

## 13. Підводні камені (звести в CLAUDE.md при реалізації)

1. **RLS не діє на власника таблиці** і на `BYPASSRLS`/superuser → runtime мусить бути окремою
   роллю-невласником + `FORCE ROW LEVEL SECURITY`.
2. **Session-level `SET` = витік через пул.** Тільки `set_config(..., true)` (transaction-local).
3. **FK обходять RLS** → композитні FK `(tenant_id, id)` + `@@unique([tenantId, id])`.
4. **`WITH CHECK` без `USING`** (або навпаки) — половина захисту: читання закрите, запис у чужий
   tenant відкритий.
5. **`current_setting` без `missing_ok`** у політиці кидає помилку замість fail-closed;
   без `nullif(..., '')` падає каст після `RESET`.
6. **`current_setting` без `(SELECT ...)`** — виклик на кожен рядок, деградація на великих таблицях.
7. **Інтерактивні транзакції** (`$transaction(async tx => ...)`, `JobDispatcher.send({ tx })`,
   `JobInboxService.runOnce`) обходять extension → `set_config` вручну першим стейтментом.
8. **Prisma migrate не знає про політики** — SQL руками + CI-чек по `pg_policies`.
9. **Індекси без префікса `tenant_id`** зводять виграш RLS нанівець.
10. **CLS не перетинає межу процесу** — через чергу tenantId їде в payload, не в контексті.

## Фази впровадження

> **Детальний план переходу — [multi-tenancy-migration.md](multi-tenancy-migration.md)**: кроки,
> SQL, конкретні файли, DoD, ризики й відкат по кожній фазі, плюс дві поломки, які перехід мусить
> вирішити свідомо (`auth.service` шукає юзера по email; `/jobs` читає `pgboss.job` поза RLS).
> Нижче — тільки зміст фаз; за «як саме робити» йти в той док.

Місце в roadmap: замінює «Фазу 3 — організації та RBAC». Еталонний домен для обкатки — `customers`
(він і так наступний у беклозі). RBAC (`@RequirePermissions`) робиться **після** MT-2, поверх
готового tenant-контексту. Порядок MT-0 → MT-1 → MT-2 жорсткий.

### ✅ MT-0 — ролі Postgres — завершено 2026-07-16

DB-ролі (`saas_migrator` / `saas_app` / `saas_platform`) + розділення env-URL-ів
(`DATABASE_URL` / `MIGRATE_DATABASE_URL` / `PLATFORM_DATABASE_URL`); docker-compose, CI і e2e
навчити їх створювати. Окремий малий PR — нічого не ламає, легко відкотити.

DoD: міграції йдуть під migrator, api/worker — під `saas_app`, e2e зелені.

### ✅ MT-1 — фундамент без RLS (схема + контекст) — завершено 2026-07-16

1. `libs/database`: модель `Tenant` (= tenant + налаштування колонками + `Json settings`);
   `tenant_id NOT NULL` на `users`, `refresh_tokens`, `files`, `attachments` (expand → backfill
   → contract); `@@unique([tenantId, email])` замість глобального `@unique` на email; композитні
   FK; індекси з префіксом `tenantId`; сід дефолтного tenant-а (well-known id).
2. `nestjs-cls`: `ClsMiddleware` (найраніше) → `TenantResolutionMiddleware` (env-константа
   в N=1, slug-поле — MT-3, піддомени — MT-4; **потрібен і для `@Public()` роутів**, бо login
   не має JWT) → `JwtAuthGuard` пише `tenantId` у CLS і звіряє з резолвленим; `tenantId`
   у JWT-клеймах; `tenantId` у кожен лог-запис (закриває пункт із фази 3 roadmap про
   correlationId — робити разом).
3. Auth-зміни 2026-07-16: **видалення `POST /auth/register` зовсім** (self-serve реєстрації
   немає; юзерів створює tenant-адмін, тенантів — platform-api); login перевіряє
   `tenant.isActive`; refresh-токен → **`tenantId:tokenId:secret`** (резолюція тенанта на
   refresh — із самого токена); опційне поле `tenant` (slug) у Login-контракті (споживається
   з MT-3).
4. Prisma extension `forTenant` (поки тільки `set_config`, RLS ще вимкнено) + хелпер `withTenantTx`
   + `SystemPrismaService` (BYPASSRLS, для maintenance) + ESLint-заборона голого `$transaction`
   у доменних модулях.
5. Черги: `defineTenantJob` з обов'язковим `tenantId`, авто-домішування в `JobDispatcher.send`,
   `cls.run` у `JobWorkerRegistrar`, `set_config` у `JobInboxService.runOnce`, `scope: 'system'`
   для cron-джоб + системний `BYPASSRLS`-клієнт для них.
6. Storage: ключі `{tenantId}/{yyyy}/{mm}/{uuid}.ext`.

DoD: усе працює як раніше (N=1), e2e зелені (єдина зміна — видалені register-тести), `tenantId` видно в логах
і в payload джоб, `grep tenantId` по доменних сервісах — порожній.

### ✅ MT-2 — увімкнення RLS — завершено 2026-07-16

1. SQL-міграція: `ENABLE`/`FORCE ROW LEVEL SECURITY` + політики `tenant_isolation` на всі
   tenant-таблиці; DB-default `current_setting('app.tenant_id')::uuid` на колонки `tenant_id`.
2. Прибрати з доменного коду будь-які згадки `tenantId` (якщо просочилися) — перевірка принципу
   з §0 grep-ом.
3. Тести ізоляції: два тенанти, конкурентний, SQL-smoke, CI-чек `pg_policies` (§12).
4. Auth-флоу під RLS: `SECURITY DEFINER resolve_tenant(slug)` (курка-яйце — §9; поки один
   tenant, резолюція закривається константою з env; slug-логін — MT-3, піддомени — MT-4).

DoD: SQL-smoke під `saas_app` без контексту дає 0 рядків по всіх tenant-таблицях; крос-tenant
e2e дає 404; жодного `tenantId` у доменних сервісах.

### ✅ MT-3 — control plane — завершено 2026-07-17

1. `apps/platform-api`: окремий NestJS, `platform_users`, свій JWT-secret, роль `saas_platform`,
   свій OpenAPI-конвеєр (`contracts/platform`).
2. **Переїзд `/jobs`** із tenant-api (`pgboss.*` поза RLS → крос-tenant витік). **Гейт: зробити
   ДО кроку 3** — другий тенант не має з'явитися раніше, ніж моніторинг залишить tenant-api.
3. CRUD тенантів: `Tenant` + перший admin-user (початковий пароль задає оператор —
   invite відкладено на MT-4 рішенням 2026-07-16) + сід дефолтів в одній транзакції;
   suspend/resume.
3а. `SlugTenantResolver` у tenant-api: поле `tenant` (slug) з Login → `resolve_tenant(slug)`,
   порожнє → env-fallback; фронт — ручне опційне поле slug (тимчасово, до піддоменів).
4. Глобальні довідники (рівень 2 з §8): моделі + GRANT-и + керування з platform-api.
5. Агреговані метрики по тенантах (read-only).

DoD: tenant створюється з platform-api й одразу працює в data plane; перший admin входить із
паролем від оператора; логін по slug-у працює; tenant-api фізично не має жодного
крос-tenant роута; `/jobs` у tenant-api відсутній.

### MT-4 — відкладене

- **Піддомени** (`acme.app.com` → slug → tenant): цільова резолюція tenant-а при логіні,
  ізоляція cookie.
- **Invite-флоу першого admin-а** (відкладено з MT-3 рішенням 2026-07-16; дизайн — migration-док
  §3.1): «оператор ніколи не знає пароля тенанта»; кандидат — вирівняти на invite і create user.
- **Рівень 3 довідників** (глобальні + tenant-розширювані) — коли з'явиться перший реальний
  каталог такого типу.
- **Білінг тенантів** у control plane (поверх `PaymentProvider` з фази 4 roadmap).

> `apps/platform-web` (UI control plane) виявився не MT-4, а частиною MT-3 — зроблено й
> перевірено разом із рештою фази 2026-07-17 (клон каркасу `apps/web`; деталі, включно
> з exports-граблею vite/rollup для subpath-імпортів — migration-док, розділ одразу після
> «Граблі MT-3»).
