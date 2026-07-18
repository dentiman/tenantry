# SaaS Skeleton

Фундамент для мультитенантних CRM/ERP-систем: NestJS + React монорепозиторій із наскрізними
типізованими контрактами (Zod → OpenAPI → TanStack Query hooks). Скелетон призначений для
форків під конкретні продукти. Архітектурні рішення — у [docs/architecture-proposal.md](docs/architecture-proposal.md),
план фаз — у [docs/roadmap.md](docs/roadmap.md), інструкції для Claude Code — у [CLAUDE.md](CLAUDE.md).

## Стек

| Шар         | Технології                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend     | NestJS 11, Prisma 7 (adapter-pg), PostgreSQL 17, nestjs-zod v5, Pino                                                                                                        |
| Contracts   | Zod 4 — єдине джерело правди типів API (`libs/contracts`)                                                                                                                   |
| API-конвеєр | `@nestjs/swagger` → `openapi.json` → orval → typed TanStack Query hooks                                                                                                     |
| Frontend    | React 19, Vite 7, TanStack Router + Query v5, Zustand, Tailwind CSS 4, react-hook-form                                                                                      |
| UI          | HeroUI v3 (React Aria) — мінімальний набір компонентів; тема light/dark/system (next-themes)                                                                                |
| Auth        | JWT (15m) + refresh rotation (`tenantId:tokenId:secret`, argon2) + theft detection; два незалежні auth-и (tenant `apps/api` і platform `apps/platform-api`, окремі секрети) |
| Monorepo    | pnpm workspaces + Turborepo, ESLint 9 (strict type-checked), Prettier, Husky                                                                                                |

## Швидкий старт

```bash
cp .env.example .env
pnpm install
pnpm docker:up            # PostgreSQL 17 у Docker (свіжий volume сам створює ролі БД)
pnpm db:roles             # ТІЛЬКИ якщо Postgres-volume існував до MT-0: ідемпотентно створює
                          # ролі saas_migrator/saas_app/saas_platform і гранти (інакше пропустити)
pnpm db:generate          # Prisma client
pnpm db:migrate:dev       # міграції (йдуть під saas_migrator — MIGRATE_DATABASE_URL з .env)
pnpm db:seed              # дефолтні дані: tenant "default" + admin@example.com/Admin12345
                          # (tenant-адмін) + platform@example.com/Platform12345 (platform-оператор)
pnpm api:dev              # Tenant API на http://localhost:3001 (Swagger: /api/docs)
pnpm platform:dev         # Control plane API на http://localhost:3002 (Swagger: /api/docs;
                          # окремий JWT-secret, роль saas_platform — BYPASSRLS)
pnpm worker:dev           # Worker: споживачі черги pg-boss + cron (окремий процес)
pnpm web:dev              # Tenant web на http://localhost:5173 (проксі /api → 3001)
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
  web/            # Tenant SPA (HeroUI v3, :5173): admin-layout, login, users CRUD
  platform-web/   # Control plane SPA (:5174): tenants CRUD, jobs-моніторинг
libs/
  contracts/  # Zod-схеми + z.infer типи (залежить лише від zod; platform-контракти — subpath /platform)
  database/   # Prisma schema, migrations, seed, PrismaService/PrismaModule; src/tenant/ — TenancyModule
              # (nestjs-cls) + tenant-extension для set_config, SystemPrismaService (BYPASSRLS)
  shared/     # Черги: defineJob, JobDispatcher, @JobHandler, inbox-ідемпотентність
docker/       # docker-compose: postgres, mailpit, seaweedfs
docs/         # архітектурна пропозиція та рішення; docs/multi-tenancy-architecture.md — довідник
              # поточної мультитенантної архітектури
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
pnpm api:test:e2e      # Jest + supertest проти реальної БД, tenant-api (63 тести; окрема БД
                       # saas_skeleton_test, створюється і мігрується автоматично — dev-дані
                       # і seed не чіпаються)
pnpm platform:test:e2e # те саме для control plane (11 тестів)
```

CI (GitHub Actions): lint → typecheck → build → міграції → e2e з PostgreSQL-сервісом.

## Черги (фаза 2.1 — готово)

Job = `defineJob(name, zodSchema, { cron?, retry* })` у `libs/shared`. API інжектить `JobDispatcher`
і викликає `send()` (опційно транзакційно через `{ tx }`); worker позначає класи `@JobHandler(def)` —
вони реєструються автоматично, разом із cron-розкладами. Ідемпотентність — `JobInboxService`
(таблиця `processed_jobs`). Живі приклади: `auth.cleanup-expired-tokens` (cron),
`users.user-registered` (диспатч при створенні юзера адміном → welcome-email).

## Далі за roadmap

Мультитенантність (MT-0…MT-3) вже реалізована й перевірена — див.
[docs/multi-tenancy-architecture.md](docs/multi-tenancy-architecture.md). Лишилось: RBAC/permissions,
refresh-токени в httpOnly cookie, справжня reuse-detection ротованих токенів, MT-4/беклог
(піддомени, invite-флоу, білінг), доменні модулі (customers, tickets, billing). Деталі — у
docs/roadmap.md.
