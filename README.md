# SaaS Skeleton

Фундамент для мультитенантних CRM/ERP-систем: NestJS + React монорепозиторій із наскрізними
типізованими контрактами (Zod → OpenAPI → TanStack Query hooks). Скелетон призначений для
форків під конкретні продукти. Архітектурні рішення — у [docs/architecture-proposal.md](docs/architecture-proposal.md),
план фаз — у [docs/roadmap.md](docs/roadmap.md), інструкції для Claude Code — у [CLAUDE.md](CLAUDE.md).

## Стек

| Шар         | Технології                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend     | NestJS 11, Prisma 7 (adapter-pg), PostgreSQL 17, nestjs-zod v5, Pino                                                                                                        |
| Realtime    | Socket.IO 4 (websocket-only, namespace `/tenant`) + Valkey 8 як Redis Streams adapter і сховище presence-leases                                                              |
| Contracts   | Zod 4 — єдине джерело правди типів API (`libs/contracts`)                                                                                                                   |
| API-конвеєр | `@nestjs/swagger` → `openapi.json` → orval → typed TanStack Query hooks                                                                                                     |
| Frontend    | React 19, Vite 7, TanStack Router + Query v5, Zustand, Tailwind CSS 4, react-hook-form                                                                                      |
| UI          | shadcn/ui на Base UI (стиль `base-nova`), спільний шар `libs/ui`; тема light/dark/system (next-themes)                                                                       |
| Auth        | JWT (15m) + refresh rotation (`tenantId:tokenId:secret`, argon2) + theft detection; два незалежні auth-и (tenant `apps/api` і platform `apps/platform-api`, окремі секрети) |
| Monorepo    | pnpm workspaces + Turborepo, ESLint 9 (strict type-checked), Prettier, Husky                                                                                                |

## Швидкий старт

```bash
cp .env.example .env
pnpm install
pnpm docker:up            # PostgreSQL 17 + Mailpit + Valkey + SeaweedFS у Docker
                          # (свіжий Postgres-volume сам створює ролі БД)
pnpm db:roles             # ТІЛЬКИ якщо Postgres-volume існував до MT-0: ідемпотентно створює
                          # ролі saas_migrator/saas_app/saas_platform і гранти (інакше пропустити)
pnpm db:generate          # Prisma client
pnpm db:migrate:dev       # міграції (йдуть під saas_migrator — MIGRATE_DATABASE_URL з .env)
pnpm db:seed              # дефолтні дані: tenant "default" + admin@example.com/Admin1234567
                          # (tenant-адмін) + platform@example.com/Platform12345 (platform-оператор)
pnpm api:dev              # Tenant API на http://localhost:3001 (Swagger: /api/docs)
pnpm platform:dev         # Control plane API на http://localhost:3002 (Swagger: /api/docs;
                          # окремий JWT-secret, роль saas_platform — BYPASSRLS)
pnpm worker:dev           # Worker: споживачі черги pg-boss + cron (окремий процес)
pnpm web:dev              # Tenant web на http://localhost:5173 (проксі /api і /socket.io → 3001)
pnpm platform:web:dev     # Platform web на http://localhost:5174 (проксі /api → 3002)
```

Почати геть з нуля (стирає всі дані): `pnpm db:reset` — DROP+CREATE бази, ролі, міграції
й сід за одну команду (тільки localhost; деталі — [docs/database-seed.md](docs/database-seed.md)).

Повний довідник **усіх** команд `package.json` з прикладами й поясненням, що робить
кожна — [docs/commands.md](docs/commands.md) (там же — готові JetBrains Run Configurations
для мінімального dev-набору, впорядковані під запуск "з нуля").

## Структура

```
apps/
  api/            # Tenant API (data plane, :3001): auth, users, files, health; RLS-контекст
                  # через TenancyModule; Swagger на /api/docs
  platform-api/   # Control plane API (:3002): platform-auth (окремі platform_users, окремий
                  # JWT-secret), tenants CRUD, jobs-моніторинг; роль saas_platform (BYPASSRLS)
  worker/         # NestJS-процес без HTTP: обробники job-ів pg-boss + cron
  web/            # Tenant SPA (:5173): shell, login, users CRUD, картка юзера, інбокс
  platform-web/   # Control plane SPA (:5174): tenants CRUD, jobs-моніторинг
libs/
  contracts/  # Zod-схеми + z.infer типи (залежить лише від zod; platform-контракти — subpath /platform)
  database/   # Prisma schema, migrations, seed, PrismaService/PrismaModule; src/tenant/ — TenancyModule
              # (nestjs-cls) + tenant-extension для set_config, SystemPrismaService (BYPASSRLS)
  shared/     # Повідомлення: defineEvent/defineCommand, MESSAGE_TOPOLOGY, MessagePublisher,
              # @MessageSubscriber, inbox-ідемпотентність; сховище (StorageService)
  ui/         # Спільний UI-шар обох фронтів: тема, вендорені примітиви shadcn, грід, форми
docker/       # docker-compose: postgres, mailpit, valkey (realtime), seaweedfs
docs/         # архітектурна пропозиція та рішення; docs/multi-tenancy-architecture.md — довідник
              # поточної мультитенантної архітектури; docs/frontend/ — усе про UI-шар
```

## Ключові конвенції (успадковані з fibo-admin)

- **Контракти**: жодних ручних типів API — тільки `z.infer<>` зі схем `libs/contracts`.
- **Шари backend-модуля**: DTO (`createZodDto`) → Service (логіка + Prisma) → Mapper
  (явний мапінг, не витікають `passwordHash` тощо) → Controller (HTTP + Swagger-метадані).
- **Відповіді**: одиночна сутність — плоский об'єкт; список — `{ items, total, page, limit, totalPages }`.
- **Дати в API** — ISO-рядки (wire-формат), конвертація в мапперах.
- **Guard за замовчуванням**: всі роути захищені JWT, відкриті позначаються `@Public()`.

## Кодогенерація фронтенд-клієнта

Після зміни контрактів/контролерів:

```bash
pnpm openapi:generate   # apps/api/openapi.json
pnpm web:codegen        # apps/web/src/api/generated (orval)
```

Згенеровані хуки (`useAuthLogin`, `useUsersFindAll`, …) ходять через
`apps/web/src/api/http-client.ts` — axios-інстанс із Bearer-токеном та single-flight refresh на 401.

## Тести та якість

```bash
pnpm lint         # ESLint (strict type-checked, 0 warnings)
pnpm typecheck    # tsc по всіх пакетах (turbo)
pnpm api:test:e2e      # Jest + supertest проти реальної БД, tenant-api (96 тестів; окрема БД
                       # saas_skeleton_test, створюється і мігрується автоматично — dev-дані
                       # і seed не чіпаються). Realtime-тести ходять до живої Valkey —
                       # ізоляція через окремий REALTIME_KEY_PREFIX, не окреме сховище
pnpm platform:test:e2e # те саме для control plane (11 тестів)
```

CI (GitHub Actions): lint → typecheck → build → міграції → e2e з сервісами PostgreSQL і Valkey.

## Асинхронні повідомлення (EDA-1 — готово)

Асинхронна робота описується двома примітивами в `libs/shared/src/messaging/`:
`defineEvent('users.user-registered.v1', schema)` — факт із 0..N підписниками (версія в імені
обовʼязкова) і `defineCommand('files.generate-thumbnail', schema)` — наказ рівно одному
споживачеві. Хто на що підписаний, видно в одному місці — маніфесті `MESSAGE_TOPOLOGY`.

API інжектить `MessagePublisher` і викликає `publish(tx, def, data)` — **транзакція першим
аргументом**: один виклик кладе job у чергу кожного підписника з маніфесту в тій самій
транзакції, що й доменна зміна. Worker позначає класи `@MessageSubscriber({ definition, id })`;
вони знаходяться автоматично, разом із cron-розкладами, а розсинхрон із маніфестом валить
старт. Ідемпотентність — `MessageInboxService.runOnce(envelope, consumerId, fn)` по ключу
`messageId:consumerId` (таблиця `processed_jobs`). Провалені повідомлення йдуть у спільну `dlq`.

Живі приклади: `auth.cleanup-expired-tokens` (cron-команда), `users.user-registered.v1`
(публікується при створенні юзера адміном → підписник `welcome-email`).
Деталі й обґрунтування — [docs/event-driven-architecture.md](docs/event-driven-architecture.md).

## Realtime і presence

Socket.IO-гейтвей живе в кожній репліці `apps/api` (namespace `/tenant`, той самий HTTP-сервер
і origin, що REST). Транспорт — **тільки WebSocket**: polling вимкнено, тому session affinity
не потрібна взагалі. Multi-node fan-out — `@socket.io/redis-streams-adapter` поверх Valkey;
adapter потрібен навіть на одній репліці, бо `order: start-first` під час деплою тримає два
таски `api` одночасно.

Handshake бере токен із Socket.IO `auth` і перевіряє його **тим самим `AccessTokenService`,
що й HTTP-guard**, потім звіряє `isActive` юзера й тенанта в явному `TenantContextService.runWith`.
Access-токен живе 15 хвилин, а socket — годинами, тому сервер шле `auth.expiring.v1`, а
клієнт відповідає `auth.update.v1` через ТОЙ САМИЙ single-flight `refreshTokens()`, що й
axios-інтерсептор — без перепідключення.

Presence: юзер `online`, якщо є хоч одне живе зʼєднання в цьому тенанті (дві вкладки — один
online user). У памʼяті ноди — рахунок вкладок, у Valkey — lease пари `(user, apiNode)`, що
продовжується heartbeat-ом і прибирається ідемпотентним sweeper-ом без вибору лідера.
Повний стан завжди читається з `GET /api/presence` (`onlineUserIds` + `revision`), а socket
надсилає лише delta `presence.changed.v1`, яку фронт застосовує до кешу TanStack Query за
правилом ревізій (дубль — ігнор, `+1` — застосувати, розрив — resync). Відмова брокера не
чіпає REST: endpoint віддає 503, а UI показує «невідомо» замість брехливого «всі offline».

Демо — online-badge на `/users`. Огляд і зафіксовані рішення — [docs/realtime.md](docs/realtime.md),
механіка (ключі, Lua, конфіг, режими відмов) — [docs/realtime-internals.md](docs/realtime-internals.md).

## In-app сповіщення (готово)

Персональний інбокс поверх того самого realtime-транспорту: дзвінок із бейджем, панель
(непрочитані / усі / архів), налаштування на тип сповіщення. Текст **не зберігається** —
бекенд пише `type` + `payload` з референсами `{kind, id}`, а фронт рендерить через i18next і
сам будує посилання на сутність усередині повідомлення (реєстр `entity-routes.ts`).

Однотипні події схлопуються в одну картку, доки її не прочитали (частковий унікальний індекс
+ `INSERT … ON CONFLICT`), тож «створено 5 юзерів» — один рядок, а не пʼять. Бейдж рахує
**нові з моменту останнього відкриття панелі**, а не всі непрочитані — інакше він назавжди
застряг би на великому числі.

Емісія в браузер — after-commit у процесі, що записав рядок (**не** через pg-boss: черга не є
live-транспортом). Сповіщення, народжені у воркері, доїжджають через headless Socket.IO-сервер
на тому самому Valkey-адаптері. Спливна картка (тост) і рядок у центрі — **один компонент**.

Деталі, зафіксовані рішення і тести — [docs/notifications.md](docs/notifications.md).

## Фронтенд

Обидва фронти на shadcn/ui (Base UI, стиль `base-nova`) зі спільним шаром `libs/ui`: одна тема,
вендорені примітиви реєстру, грід, обгортки форм. Уся документація UI-шару — у
[docs/frontend/](docs/frontend/README.md): правила стека
([ui-stack.md](docs/frontend/ui-stack.md)), звідки брати новий компонент
([ui-registry.md](docs/frontend/ui-registry.md)), історія переходу на shadcn
([ui-migration-history.md](docs/frontend/ui-migration-history.md)) і відкриті питання.

## Скіли Claude Code

У `.claude/skills/` (реєстр — `skills-lock.json`) лежить [archify](https://github.com/tt-a1i/archify) —
скіл, який з текстового опису або з Mermaid генерує самодостатні інтерактивні HTML-діаграми
(architecture / workflow / sequence / dataflow / lifecycle) з експортом у PNG/SVG/WebM;
оновлення — `npx skills update archify`.

## Далі за roadmap

Мультитенантність, realtime і in-app сповіщення вже реалізовані й перевірені — див.
[docs/multi-tenancy-architecture.md](docs/multi-tenancy-architecture.md),
[docs/realtime.md](docs/realtime.md) і [docs/notifications.md](docs/notifications.md).
Лишилось: заплановані сповіщення (нагадування) і email як другий канал, екран DLQ,
RBAC/permissions, refresh-токени в httpOnly cookie, справжня reuse-detection ротованих
токенів, беклог мультитенантності (піддомени, invite-флоу, білінг), доменні модулі
(customers, tickets, billing). Деталі — у docs/roadmap.md.
