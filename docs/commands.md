# Довідник команд (package.json)

Усі команди проєкту — скрипти `package.json` (`pnpm <script>`), кожен робить рівно одну
річ; жодної окремої системи оркестрації (на кшталт Makefile) в проєкті немає.

Для локального дев-запуску мінімальний потрібний набір продубльовано в
[JetBrains Run Configurations](#jetbrains-run-configurations) — вже впорядкованих так,
щоб піднімати сервіси одне за одним без порушення залежностей.

## Зміст

- [Docker (інфраструктура)](#docker-інфраструктура)
- [Workspace slots](#workspace-slots)
- [База даних (Prisma + ролі)](#база-даних-prisma--ролі)
- [Застосунки — розробка](#застосунки--розробка)
- [Кодогенерація контрактів](#кодогенерація-контрактів)
- [Корпус знань AI-асистента](#корпус-знань-ai-асистента)
- [Якість коду](#якість-коду)
- [Тести](#тести)
- [Логи](#логи)
- [JetBrains Run Configurations](#jetbrains-run-configurations)

---

## Docker (інфраструктура)

Піднімає Postgres 17 із pgvector 0.8.6, Mailpit (SMTP-заглушка для email у dev), Valkey (брокер Socket.IO
і сховище presence-leases) і SeaweedFS (S3-сумісне
сховище файлів). Конфігурація — [docker/docker-compose.yml](../docker/docker-compose.yml).

Для поточної локальної БД обрано видалення старого Alpine-volume та seed без backup/restore;
[операційний порядок](ai-assistant-implementation-plan.md#4-bootstrap-міграції-й-наявні-інсталяції).

### `pnpm docker:up`

```bash
pnpm docker:up
# з .env, без .env.local → docker compose --env-file .env -f docker/docker-compose.yml up -d
# з .env.local (workspace slot) → docker compose --env-file .env.local -f docker/docker-compose.yml up -d
```

Піднімає всі чотири контейнери у фоні (`-d`). Свіжий Postgres-volume сам створює ролі БД
через `docker/postgres/init/01-roles.sql`, а `02-vector.sql` встановлює pgvector
у цільову БД та `template1` — окремий крок `db:roles` після цього
**не потрібен** (детальніше — розділ [«pnpm db:roles»](#pnpm-dbroles) нижче). Якщо в
checkout є `.env.local` (створений `pnpm ws:init`, див. [Workspace slots](#workspace-slots)),
команда автоматично б'є в потрібний слот, а не в базовий стек.
Без `.env.local` явно читається кореневий `.env` (зокрема `REDIS_PORT`);
помилка запуску слота не спричиняє fallback на базовий стек.

### `pnpm docker:down`

```bash
pnpm docker:down
# з .env, без .env.local → docker compose --env-file .env -f docker/docker-compose.yml down
# з .env.local (workspace slot) → docker compose --env-file .env.local -f docker/docker-compose.yml down
```

Зупиняє й видаляє контейнери. Named volume не видаляється — дані Postgres/SeaweedFS
переживають `down`/`up` (щоб прибрати й дані слота — `pnpm ws:down`, нижче).

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

## Workspace slots

Ізольований dev-стек на паралельний git worktree/agent workspace (`docs/workspace-slots.md`):
окремий docker-compose project, зсув портів +100·N, окрема БД, власні секрети — щоб два
checkout-и могли одночасно тримати повний стек (Postgres/Valkey/SeaweedFS/Mailpit +
api/platform-api/worker + web/platform-web), не заважаючи один одному.

### `pnpm ws:init [N]`

```bash
pnpm ws:init      # перший вільний слот (або той самий, що вже в .env.local цього checkout-у)
pnpm ws:init 2    # саме слот 2
```

Генерує `.env.local` (зсув портів, `WORKSPACE_SLOT`, свіжі `JWT_SECRET`/`PLATFORM_JWT_SECRET`),
піднімає `docker compose --env-file .env.local ... up -d`, чекає, поки Postgres слота стане
готовим, і ЗАВЖДИ виконує `pnpm db:reset` (чиста БД навіть при повторному виклику на тому
самому слоті). Друкує адреси (web, platform-web, api/platform Swagger, Mailpit UI). Слот 0 —
базовий checkout без `.env.local`, ним `ws:init` не керує.

«Вільний» тут означає не лише відсутність listener-ів: `ws:init` читає `.env.local` усіх
checkout-ів із `git worktree list` і не віддає вже закріплений слот іншому worktree, навіть
коли той зараз вимкнений. Слот 0 та його порти завжди зарезервовані за основним checkout-ом.
Vite також не шукає наступний вільний порт (`strictPort: true`), а падає при конфлікті.
Згенерований `API_PORT` має пріоритет над generic `PORT`, який може інжектити Claude
preview, тому tenant API non-zero слота не займає `3001`, навіть якщо slot 0 зараз вимкнений.

Далі в цьому checkout — звичайні `pnpm api:dev`/`platform:dev`/`worker:dev`/`web:dev`/
`platform:web:dev`: усі підхоплюють `.env.local` автоматично (`apps/api`, `apps/platform-api`,
`apps/worker` — через `ConfigModule.forRoot({ envFilePath: [...] })`, `apps/web`/
`apps/platform-web` — через `loadEnv` у `vite.config.ts`).

### `pnpm ws:down`

```bash
pnpm ws:down
# → docker compose --env-file .env.local -f docker/docker-compose.yml down -v
```

Гасить і прибирає контейнери й volume-и слота цього checkout-у (`.env.local` не
видаляється — наступний `ws:init` без аргументу повертається на той самий слот).

---

## База даних (Prisma + ролі)

### `pnpm db:generate`

```bash
pnpm db:generate
# → prisma generate (у libs/database)
```

Генерує Prisma Client у `libs/database/src/generated` (у git ігнорується). Потрібно
перезапускати після кожної зміни схеми (`libs/database/prisma/schema/*.prisma` — файл на модуль).

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

Prisma config і DB-скрипти самі завантажують root `.env` + `.env.local`, тому обидві форми
команди використовують `MIGRATE_DATABASE_URL` поточного workspace slot. У non-zero слоті
локальний URL з портом іншого слота відхиляється до підключення; у linked worktree без
`.env.local` спочатку треба виконати `pnpm ws:init` (виняток — офлайнові Prisma
`generate`/`validate`/`format`).

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
`admin@example.com`/`Admin1234567` + platform-оператор
`platform@example.com`/`Platform12345`. Можна ганяти повторно на живій БД без ризику
дублів. Деталі — [docs/database-seed.md](database-seed.md).

### `pnpm db:seed:demo` / `pnpm db:seed:demo:reset`

```bash
pnpm db:seed:demo          # → tsx libs/database/prisma/seed-demo/index.ts
pnpm db:seed:demo:reset    # → ... --reset
```

Демо-датасет для показу клієнтам: три галузеві тенанти (`northwind`, `helix`, `brightside`) із
командою, десятками кастомерів, календарем, чатом, журналом і сповіщеннями. Ідемпотентно;
`:reset` видаляє ці три тенанти каскадом і створює заново (дати календаря знову на «сьогодні»).
Не чіпає `default` і оператора платформи, тож спершу потрібен `pnpm db:seed`. Акаунти, склад
даних і CI-джоби — [docs/demo.md](demo.md).

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

Control plane SPA: два рівні навігації (`docs/frontend/app-shell.md` §9) — Tenants
(`DataGrid` + `CreateTenantModal` + suspend/resume), Operations (`/operations/jobs` +
`/operations/queues`, перенесено з tenant-web після MT-3), User settings.

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

## Корпус знань AI-асистента

Той самий патерн, що `openapi.json`/orval: джерело — Markdown у `docs/ai-knowledge/`,
рантайм читає лише закомічений артефакт
`libs/shared/src/ai/knowledge/generated/knowledge-corpus.json` (деталі —
[ai-assistant-implementation.md](ai-assistant-implementation.md) §14).

### `pnpm ai:knowledge` / `pnpm ai:knowledge:check`

```bash
pnpm ai:knowledge        # → docs/ai-knowledge/*.md → knowledge-corpus.json (+ версія-хеш)
pnpm ai:knowledge:check  # → exit 1, якщо артефакт застарів, front-matter невалідний
                         #   або корпус понад бюджет (100 000 символів)
```

Голий `node` (type stripping Node 24), без залежностей — тому ту саму перевірку ганяє CI
(стадія `check` у `.gitlab-ci.yml`) і перший крок `pnpm lint`. Після будь-якої правки в
`docs/ai-knowledge/` — `pnpm ai:knowledge` і закомітити артефакт разом із Markdown.

---

### `pnpm ai:docs:preview`

Offline-перевірка FMS Markdown: admission, чанки, хеші й токени без БД та API.
[Manifest, команда та виміряний результат](ai-sources/README.md).

### `pnpm ai:docs:ingest` / `pnpm ai:docs:search`

```bash
pnpm ai:docs:ingest --source fms --root <checkout> --manifest docs/ai-sources/fms-pilot.json --tenant default
pnpm ai:docs:search --product fms --tenant default --role ADMIN --query "..." [--limit 5]
```

Операторські CLI (AI-2a.2): ingest пише embeddings у `ai_knowledge_*` обраного tenant-а й
атомарно публікує ревізію (повтор без змін — нуль викликів API); search — питання → top-K
опублікованих чанків. `pnpm ai:docs:eval --tenant default` порівнює режими пошуку й пороги
на `docs/ai-sources/fms-eval.json` (AI-2a.4). Потребують міграцій, `DATABASE_URL` під `saas_app` і ключа embeddings
(`AI_EMBEDDING_*` або `AI_BASE_URL`/`AI_API_KEY`). [Деталі й змінні](ai-sources/README.md).

### `pnpm ai:answers:eval`

```bash
pnpm ai:answers:eval --tenant default --max-cost 0.50 \
  [--questions docs/ai-sources/fms-eval.json] [--configs docs/ai-sources/answer-eval-configs.json] \
  [--judge <model>] [--repeat N] [--output <dir>] [--only q01,q02] [--fake]
```

Eval відповідей (AI-5c): набір питань × файл конфігурацій через той самий конвеєр, що в чаті →
таблиця «якість × ціна відповіді», `summary.md` і `answers.json`. Пише лише журнал витрат
(`kind = eval`); `--max-cost` обовʼязковий, якщо не `--fake`. Потребує ingest продукту в tenant-і й
тарифів моделей. [Формат файлів і як читати звіт](ai-sources/README.md#eval-відповідей-pnpm-aianswerseval-ai-5c).

## Якість коду

### `pnpm lint` / `pnpm lint:fix`

```bash
pnpm lint       # → ai:knowledge --check && deps:check && modules:check --strict && lint:eslint
pnpm lint:eslint  # → eslint <dir> --max-warnings 0 по черзі для apps/*, libs/*, scripts
pnpm lint:fix   # → eslint . --fix
```

ESLint strict-type-checked, нуль попереджень допускається. Першим кроком — перевірка корпусу
знань AI (мілісекунди, без залежностей): забутий `pnpm ai:knowledge` ловиться локально, а не
в CI. ESLint також тримає межі залежностей (`no-restricted-imports`): внутрішні файли чужого
модуля, імпорти між апками, шари бібліотек — `docs/backend-conventions.md` §1–§2.

ESLint запускається **окремим процесом на кожен пакет**, а не один раз на `.`: type-aware
правила (`projectService`) тримають у пам'яті TS-програми всіх пакетів, і прогін на весь
монорепо сягає ~4.4 ГБ RSS — більше за типовий heap Node 2 ГБ (так упала перша джоба `verify`
на раннері, 2026-10-05). Окремий пакет — до ~1.4 ГБ. Час той самий (~50 с).

### `pnpm deps:check`

```bash
pnpm deps:check  # → madge --circular по apps/{api,platform-api,worker}/src і libs/{contracts,database,shared}/src
```

Падає на будь-якому циклі runtime-імпортів (type-only імпорти не рахуються, `.madgerc`).
Секунди; входить у `pnpm lint`.

### `pnpm modules:check`

```bash
pnpm modules:check            # звіт: порушення графа модулів, файли без власника; exit 0
pnpm modules:check --strict   # exit 1 на порушення або файл без власника
pnpm modules:check --edges    # фактичний граф модуль → модуль з кількістю імпортів
```

Порівнює імпорти з графом у `modules.config.ts` (`docs/modules.md`). Резолвить кожен іменований
імпорт до файлу оголошення, тож бачить крізь barrel-и `@saas-skeleton/*`. ~12 с (TypeScript-
програма на кожен застосунок і бібліотеку). Входить у `pnpm lint` з `--strict` (а з ним — у CI
`verify`). Чого не бачить — рядкових звʼязків і Prisma relations — `docs/modules.md` §6.

### `bash scripts/ci-verify.sh`

Повний CI-гейт локально — те саме, що GitLab-джоба `verify`: `pnpm install` → `db:generate` →
`lint` → `typecheck` → `test` → e2e обох API. Postgres і Valkey — одноразові контейнери у
власній docker-мережі, тож dev-стек і workspace-слоти не зачіпаються; потрібен лише Docker.
Перший прогін довгий (холодний pnpm store), далі store береться з тому
`saas-verify-pnpm-store`. Деталі — `docs/deploy-swarm.md` §6.

### `pnpm verify` / `pnpm release:hetzner`

`pnpm verify` — синонім `bash scripts/ci-verify.sh`. `pnpm release:hetzner` — локальний шлях до
деплою на Hetzner (`docs/deploy-hetzner.md` §4): на поточній гілці з чистим деревом проганяє той
самий `verify`, потім fast-forward `git push github HEAD:main` (це запускає розкат). Verify у
GitHub-пайплайн свідомо не входить. `SKIP_VERIFY=1 pnpm release:hetzner` пропускає перевірку.

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

### `pnpm test` / `pnpm web:test`

```bash
pnpm test       # → turbo run test  (зараз єдиний споживач — apps/web)
pnpm web:test   # → pnpm --filter @saas-skeleton/web test  (vitest run)
```

Unit-тести фронту (Vitest, заведено 2026-09-08). Нічого не піднімають: `environment: 'node'`,
жодного DOM і жодної БД — покриті ЧИСТІ функції, передусім календарна арифметика часу
(`docs/calendar.md` §13). Тести лежать поруч із джерелом (`src/**/*.test.ts`); режим
спостереження — `pnpm --filter @saas-skeleton/web test:watch`.

Компонентних тестів немає свідомо (`jsdom` не встановлений): приймання UI лишається
браузерним, а раннер заведений під те, чого оком не перевіриш.

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

**Звідки тести беруть адреси.** Той самий кореневий `.env` (і `.env.local`), що й
`pnpm api:dev`: `test/load-env.ts` вантажить їх першим рядком `setup-env.ts` і
`global-setup.ts`, пріоритет — як у `ConfigModule` (явне оточення → `.env.local` → `.env`),
тож CI зі своїми змінними файлів не потребує. Якщо Valkey на машині висить не на 6379
(`REDIS_PORT` у `.env`), правити треба лише `.env` — `REDIS_PORT` і `REDIS_URL` разом.
`globalSetup` перед міграціями пінгує Valkey і за хибної адреси зупиняє прогін одним
повідомленням з адресою. Та сама схема для `pnpm platform:test:e2e` (ділить ці файли).

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

У dev кожен застосунок пише у свою теку `apps/{api,platform-api,worker}/logs/` з **ротацією за
розміром**: 10 МБ на файл, два попередні поруч (`<дата>-NN-worker.log`) і службовий `*.log.txt`
з історією ротації — тобто ≤ ~30 МБ на файл логу. Без ротації лог воркера (cron щохвилини) за
кілька днів доростав до сотень мегабайтів. Прод api ротує свій файл так само (добово, 30 днів,
gzip); worker і platform-api у проді пишуть лише в stdout.

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
