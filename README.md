# SaaS Skeleton

Фундамент для мультитенантних CRM/ERP-систем: NestJS + React монорепозиторій із наскрізними
типізованими контрактами (Zod → OpenAPI → TanStack Query hooks). Скелетон призначений для
форків під конкретні продукти. Архітектурні рішення — у [docs/architecture-proposal.md](docs/architecture-proposal.md),
план фаз — у [docs/roadmap.md](docs/roadmap.md), інструкції для Claude Code — у [CLAUDE.md](CLAUDE.md).

## Стек

| Шар         | Технології                                                                             |
| ----------- | -------------------------------------------------------------------------------------- |
| Backend     | NestJS 11, Prisma 7 (adapter-pg), PostgreSQL 17, nestjs-zod v5, Pino                   |
| Contracts   | Zod 4 — єдине джерело правди типів API (`libs/contracts`)                              |
| API-конвеєр | `@nestjs/swagger` → `openapi.json` → orval → typed TanStack Query hooks                |
| Frontend    | React 19, Vite 7, TanStack Router + Query v5, Zustand, Tailwind CSS 4, react-hook-form |
| Auth        | JWT (15m) + refresh rotation (`tokenId:secret`, argon2) + theft detection              |
| Monorepo    | pnpm workspaces + Turborepo, ESLint 9 (strict type-checked), Prettier, Husky           |

## Швидкий старт

```bash
cp .env.example .env
pnpm install
pnpm docker:up            # PostgreSQL 17 у Docker
pnpm db:generate          # Prisma client
pnpm db:migrate:dev       # міграції
pnpm db:seed              # admin@example.com / Admin12345
pnpm api:dev              # API на http://localhost:3001 (Swagger: /api/docs)
pnpm web:dev              # Web на http://localhost:5173 (проксі /api → 3001)
```

## Структура

```
apps/
  api/        # NestJS REST API: auth, users, health; Swagger на /api/docs
  web/        # React SPA: login/register, dashboard, users CRUD
libs/
  contracts/  # Zod-схеми + z.infer типи (залежить лише від zod)
  database/   # Prisma schema, migrations, seed, PrismaService/PrismaModule
docker/       # docker-compose: postgres
docs/         # архітектурна пропозиція та рішення
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
pnpm api:test:e2e # Jest + supertest проти реальної БД (40 тестів)
```

CI (GitHub Actions): lint → typecheck → build → міграції → e2e з PostgreSQL-сервісом.

## Фаза 2 (заплановано)

Черги на pg-boss (окремий `apps/worker`), RBAC/permissions, organizations (мультитенантність),
refresh-токени в httpOnly cookie, справжня reuse-detection ротованих токенів. Деталі — у docs.
