# Довідник команд (package.json)

Усі команди проєкту — скрипти `package.json` (`pnpm <script>`), кожен робить рівно одну
річ; жодної окремої системи оркестрації (на кшталт Makefile) в проєкті немає.

Для локального дев-запуску мінімальний потрібний набір продубльовано в
[JetBrains Run Configurations](#jetbrains-run-configurations) — вже впорядкованих так,
щоб піднімати сервіси одне за одним без порушення залежностей.

## Зміст

- [Docker (інфраструктура)](#docker-інфраструктура)
- [База даних (Prisma + ролі)](#база-даних-prisma--ролі)
- [Застосунки — розробка](#застосунки--розробка)
- [Кодогенерація контрактів](#кодогенерація-контрактів)
- [Якість коду](#якість-коду)
- [Тести](#тести)
- [Логи](#логи)
- [JetBrains Run Configurations](#jetbrains-run-configurations)

---

## Docker (інфраструктура)

Піднімає Postgres 17, Mailpit (SMTP-заглушка для email у dev), Valkey (брокер Socket.IO
і сховище presence-leases) і SeaweedFS (S3-сумісне
сховище файлів). Конфігурація — [docker/docker-compose.yml](../docker/docker-compose.yml).

### `pnpm docker:up`

```bash
pnpm docker:up
# → docker compose -f docker/docker-compose.yml up -d
```

Піднімає всі три контейнери у фоні (`-d`). Свіжий Postgres-volume сам створює ролі БД
через `docker/postgres/init/01-roles.sql` — окремий крок `db:roles` після цього
**не потрібен** (детальніше — розділ [«pnpm db:roles»](#pnpm-dbroles) нижче).

### `pnpm docker:down`

```bash
pnpm docker:down
# → docker compose -f docker/docker-compose.yml down
```

Зупиняє й видаляє контейнери. Named volume (`saas-skeleton`) не видаляється — дані
Postgres/SeaweedFS переживають `down`/`up`.

### `pnpm docker:prod:up` / `pnpm docker:prod:down`

```bash
pnpm docker:prod:up
# → docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d
```

Той самий принцип, але для self-hosted прод-стеку
([docker/docker-compose.prod.yml](../docker/docker-compose.prod.yml)): дані в замаплених
хостових директоріях `${SAAS_DATA_DIR}/{postgres,seaweedfs}`, теги образів запінені,
порти тільки на `127.0.0.1`, без Mailpit. Потребує `.env.production`
(приклад — `.env.production.example`).

---

## База даних (Prisma + ролі)

### `pnpm db:generate`

```bash
pnpm db:generate
# → prisma generate (у libs/database)
```

Генерує Prisma Client у `libs/database/src/generated` (у git ігнорується). Потрібно
перезапускати після кожної зміни `schema.prisma`.

### `pnpm db:roles`

```bash
pnpm db:roles
# → tsx libs/database/scripts/ensure-roles.ts
```

Ідемпотентно створює три Postgres-ролі кластера (`saas_migrator`, `saas_app`,
`saas_platform`) і видає гранти на конкретній БД (`public`-схема + окремо `pgboss`).
Це **не завантаження даних** — команда не чіпає жодного бізнес-рядка, лише права
доступу. Детальний розбір того, що саме робить скрипт і навіщо — у
[docs/multi-tenancy-architecture.md §4](multi-tenancy-architecture.md) (ролі Postgres).

**Коли реально потрібен окремий запуск:** свіжий Docker-volume вже отримує ці ролі сам
з `docker/postgres/init/01-roles.sql`, тож у теорії `db:roles` там зайвий. На практиці —
команда ідемпотентна (безпечний no-op, якщо ролі вже є), тож у мінімальному dev-наборі
нижче вона все одно є кроком 02, одразу після `docker:up` і до `db:migrate:dev` — без неї
міграції під `MIGRATE_DATABASE_URL` (`saas_migrator`) падають на БД, що ще не проходила
через init-скрипт (наявний volume, CI-сервіс, e2e `globalSetup`, `db:reset` після
`DROP+CREATE DATABASE`).

### `pnpm db:migrate:dev`

```bash
pnpm db:migrate:dev
# → prisma migrate dev (у libs/database, під MIGRATE_DATABASE_URL / saas_migrator)
```

Застосовує/створює міграції в dev-режимі (питає назву нової міграції інтерактивно —
**не** передавати ім'я через `pnpm db:migrate:dev -- --name X`, pnpm дублює `--`, prisma
йде в prompt і висить; для іменованої міграції: `cd libs/database && pnpm exec prisma migrate dev --name X`).

### `pnpm db:migrate:deploy`

```bash
pnpm db:migrate:deploy
# → prisma migrate deploy
```

Некастомний прогін уже наявних міграцій без інтерактивності — використовується в CI,
`db:reset`, e2e `globalSetup`.

### `pnpm db:seed`

```bash
pnpm db:seed
# → tsx libs/database/prisma/seed.ts
```

Ідемпотентний upsert дефолтних даних: tenant `slug=default` + tenant-адмін
`admin@example.com`/`Admin12345` + platform-оператор
`platform@example.com`/`Platform12345`. Можна ганяти повторно на живій БД без ризику
дублів. Деталі — [docs/database-seed.md](database-seed.md).

### `pnpm db:studio`

```bash
pnpm db:studio
# → prisma studio
```

Візуальний браузер даних БД (відкриває вкладку в браузері).

### `pnpm db:reset`

```bash
pnpm db:reset
# → tsx libs/database/scripts/reset-db.ts
```

**ДЕСТРУКТИВНО** (dev-only, відмовляється працювати проти нелокального host): повний
цикл одним викликом — `DROP DATABASE WITH (FORCE)` → `CREATE DATABASE` → `db:roles` →
`db:migrate:deploy` → `db:seed`. Свідомо **не** `prisma migrate reset` — той дропає лише
схему `public`, а `ALTER DEFAULT PRIVILEGES` прив'язаний до OID схеми: новий OID після
перестворення інвалідує грант `saas_app`. Повний розбір —
[docs/database-seed.md](database-seed.md#pnpm-dbreset).

---

## Застосунки — розробка

Кожен застосунок має однакову трійку скриптів: `dev` (watch-режим), `build`
(продакшн-збірка), `start` (запуск зібраного `dist/`).

### `pnpm api:dev` / `pnpm api:build` / `pnpm api:start`

```bash
pnpm api:dev
# → pnpm --filter @saas-skeleton/api dev  (nest start --watch, :3001, Swagger /api/docs)
```

Tenant API (data plane): auth, users, files, health. Guard за замовчуванням захищає всі
роути (`@Public()` — виняток). RLS-контекст через `TenancyModule` — [docs/multi-tenancy-architecture.md](multi-tenancy-architecture.md).

### `pnpm platform:dev` / `pnpm platform:build` / `pnpm platform:start`

```bash
pnpm platform:dev
# → pnpm --filter @saas-skeleton/platform-api dev  (:3002, Swagger /api/docs)
```

Control plane API: `platform-auth` (окрема identity `platform_users`, окремий
`PLATFORM_JWT_SECRET` — токени двох plane-ів НЕ крос-валідні), CRUD тенантів
(create+перший admin атомарно, suspend/resume), моніторинг джобів (`/jobs` — переїхав
сюди з tenant-api, бо `pgboss.*` живе поза RLS). Роль `saas_platform` (BYPASSRLS) —
[docs/multi-tenancy-architecture.md](multi-tenancy-architecture.md).

### `pnpm worker:dev` / `pnpm worker:build` / `pnpm worker:start`

```bash
pnpm worker:dev
# → pnpm --filter @saas-skeleton/worker dev  (NestJS без HTTP, createApplicationContext)
```

Підписники повідомлень `pg-boss` (`@MessageSubscriber`, `apps/worker/src/subscribers/`) +
cron-задачі + реальна відправка email через Mailpit (`MailerService`/nodemailer). Асинхронний
шар — [event-driven-architecture.md](event-driven-architecture.md) і розділ
[«Асинхронні повідомлення»](../CLAUDE.md) у CLAUDE.md (еталон: подія `users.user-registered.v1`
→ fan-out на публікації → підписник `welcome-email`).

Старт воркера **падає**, якщо набір класів `@MessageSubscriber` не збігається з
`MESSAGE_TOPOLOGY` — це гейт, а не помилка конфігурації: оголошений споживач без класу означав
би job-и в нечитаній черзі, клас без оголошення — мертвий код.

### `pnpm web:dev` / `pnpm web:build`

```bash
pnpm web:dev
# → pnpm --filter @saas-skeleton/web dev  (Vite, :5173, проксі /api → :3001)
```

Tenant SPA: admin-layout, login, users CRUD, `/jobs`-моніторинг (до MT-3), DataGrid.

### `pnpm platform:web:dev` / `pnpm platform:web:build`

```bash
pnpm platform:web:dev
# → pnpm --filter @saas-skeleton/platform-web dev  (Vite, :5174, проксі /api → :3002)
```

Control plane SPA: Tenants (плоска таблиця + CreateTenantModal + suspend/resume),
`/jobs` (перенесено з tenant-web 1:1 після MT-3).

---

## Кодогенерація контрактів

Конвеєр типів: Zod-схема (`libs/contracts`) → `createZodDto` → Swagger → `openapi.json` →
orval → типізовані TanStack Query хуки. **Ручних типів API в проєкті немає.**

### `pnpm openapi:generate` / `pnpm platform:openapi:generate`

```bash
pnpm openapi:generate
# → apps/api/openapi.json (ts-node, потрібен .env з JWT_SECRET)

pnpm platform:openapi:generate
# → apps/platform-api/openapi.json
```

### `pnpm web:codegen` / `pnpm platform:web:codegen`

```bash
pnpm web:codegen
# → orval: apps/api/openapi.json → apps/web/src/api/generated

pnpm platform:web:codegen
# → orval: apps/platform-api/openapi.json → apps/platform-web/src/api/generated
```

Після будь-якої зміни контрактів/контролерів завжди прогнати парою: спершу
`*openapi:generate`, потім відповідний `*:codegen` — обидва артефакти комітяться
в репозиторій.

---

## Якість коду

### `pnpm lint` / `pnpm lint:fix`

```bash
pnpm lint       # → eslint . --max-warnings 0
pnpm lint:fix   # → eslint . --fix
```

ESLint strict-type-checked, нуль попереджень допускається.

### `pnpm format` / `pnpm format:check`

```bash
pnpm format        # → prettier --write .
pnpm format:check  # → prettier --check .
```

### `pnpm typecheck`

```bash
pnpm typecheck
# → turbo run typecheck  (tsc по всіх пакетах монорепо, кешовано Turborepo)
```

### `pnpm build`

```bash
pnpm build
# → turbo run build  (усі apps/libs, з урахуванням залежностей між ними)
```

---

## Тести

### `pnpm api:test:e2e`

```bash
pnpm api:test:e2e
# → pnpm --filter @saas-skeleton/api test:e2e  (Jest + supertest)
```

171 e2e-тест tenant-api (rls, tenant-isolation, slug-login, messaging, realtime + last-seen,
notifications, account, customers, numbering, settings) —
**вимагає Postgres і Valkey** (обидва піднімає `pnpm docker:up`).
`globalSetup` сам створює окрему БД `saas_skeleton_test`, ставить ролі (`db:roles`) і
міграції — dev-дані не чіпає. Presence живе не в БД, тому ізоляцію їй дає окремий
префікс ключів на кожен jest-worker (`setup-env.ts`), а не окреме сховище.

### `pnpm platform:test:e2e`

```bash
pnpm platform:test:e2e
# → pnpm --filter @saas-skeleton/platform-api test:e2e
```

11 тестів control plane: operator auth, tenants CRUD, jobs, cross-plane 401.

---

## Логи

### `pnpm logs:tail` / `pnpm logs:clean`

```bash
pnpm logs:tail   # → tail -f apps/api/logs/api-pretty.log
pnpm logs:clean  # → rm -rf apps/api/logs/*.log*
```

Pino-логи пишуться в `join(process.cwd(), 'logs')` — команди `api` треба запускати з cwd
`apps/api` (`pnpm --filter` це гарантує).

---

## JetBrains Run Configurations

`.idea/runConfigurations/` містить готові **спільні** (закомічені в репозиторій) Run
Configurations для PHPStorm/WebStorm — мінімальний набір, який реально потрібен для
локальної розробки, а не повний список усіх скриптів `package.json`. Файли пронумеровані
префіксом `01_`…`10_` саме в тому порядку, в якому їх треба запускати — кожен наступний
крок залежить від того, що вже підняте попереднім:

| #   | Run Configuration          | Скрипт             | Навіщо саме тут                                                                                                                                              |
| --- | -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | `01 pnpm docker:up`        | `docker:up`        | Postgres + Mailpit + Valkey + SeaweedFS — без них усе інше падає на конекшені                                                                                |
| 02  | `02 pnpm db:roles`         | `db:roles`         | ролі `saas_migrator`/`saas_app`/`saas_platform` — без них `db:migrate:dev` (крок 04) падає, бо `MIGRATE_DATABASE_URL` іде під `saas_migrator`, якого ще нема |
| 03  | `03 pnpm db:generate`      | `db:generate`      | Prisma Client — застосунки не збілдяться без згенерованих типів                                                                                              |
| 04  | `04 pnpm db:migrate:dev`   | `db:migrate:dev`   | схема БД — застосунки впадуть на першому запиті без таблиць                                                                                                  |
| 05  | `05 pnpm db:seed`          | `db:seed`          | дефолтний tenant + admin/platform-юзери для логіну                                                                                                           |
| 06  | `06 pnpm api:dev`          | `api:dev`          | Tenant API :3001 — потрібен ДО web (проксі туди)                                                                                                             |
| 07  | `07 pnpm platform:dev`     | `platform:dev`     | Control plane API :3002 — потрібен ДО platform-web                                                                                                           |
| 08  | `08 pnpm worker:dev`       | `worker:dev`       | обробник черги — потрібен, щоб джоби (welcome-email тощо) не зависали в pending                                                                              |
| 09  | `09 pnpm web:dev`          | `web:dev`          | Tenant SPA :5173 (проксі `/api` → :3001, вимагає `api:dev` живим)                                                                                            |
| 10  | `10 pnpm platform:web:dev` | `platform:web:dev` | Platform SPA :5174 (проксі `/api` → :3002, вимагає `platform:dev` живим)                                                                                     |

Кроки 01–05 — одноразовий сетап (запускаються послідовно й завершуються самі); 06–10 —
довгоживучі процеси (запускаються й лишаються висіти, кожен у своїй вкладці Run tool
window). Зупиняти — просто закрити відповідну вкладку/натиснути стоп на потрібному
процесі; специфічної команди "down" немає.

`db:roles` тут — ідемпотентна команда (безпечно перезапускати, навіть якщо ролі вже є),
тож тримати її в послідовності "про всяк випадок" не шкодить навіть на середовищах, де
свіжий Docker-volume вже створив ролі сам через `docker/postgres/init/01-roles.sql` —
детальніше в розділі [«pnpm db:roles»](#pnpm-dbroles) вище.

Після відкриття проєкту в PHPStorm/WebStorm вони одразу з'являються в дропдауні **Run**
(іконка ▷ вгорі IDE) — не треба нічого імпортувати чи налаштовувати вручну.

**Важливо про `.gitignore`:** корінь репозиторію ігнорує `.idea/*` цілком (workspace-файли,
`.iml`, локальні налаштування — вони персональні для кожного розробника), крім явного
винятку `!.idea/runConfigurations/**` — тому оновлення цієї теки самі бачаться в `git status`
і підлягають рев'ю як звичайний код.

Якщо потрібен ще якийсь скрипт із повного списку вище (наприклад, `db:studio` чи
`api:test:e2e`) — додати `.xml` вручну за тим самим шаблоном (тип `js.build_tools.npm`,
`package-manager` = `pnpm`), просто без номерного префікса (він зарезервований під
послідовність запуску "з нуля").
