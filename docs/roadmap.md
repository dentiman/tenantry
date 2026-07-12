# Roadmap

Стан на 2026-07-11. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md).

## ✅ Фаза 1 — фундамент (завершена 2026-07-11)

- Монорепо pnpm + Turborepo; ESLint 9 strict + Prettier + Husky; CI (GitHub Actions з Postgres-сервісом).
- `libs/contracts` (Zod 4), `libs/database` (Prisma 7 + міграція init + seed).
- `apps/api`: auth (порт fibo-admin: JWT + refresh rotation + theft detection) + users CRUD,
  Pino, PrismaExceptionFilter, Swagger `/api/docs`.
- Конвеєр: `openapi:generate` → orval → typed TanStack Query hooks.
- `apps/web`: login/register (RHF + Zod), guards, dashboard, users (пошук/пагінація/create/delete),
  axios із single-flight refresh.
- Перевірено: 40 e2e-тестів, lint/typecheck чисті, живий флоу через dev-проксі.

## Фаза 2 — черги + зміцнення auth

1. ✅ **pg-boss + `apps/worker`** (завершено 2026-07-11). `libs/shared`: `defineJob` (Zod-схема payload-а),
   абстрактний `JobDispatcher` (pg-boss замінюваний), `@JobHandler()` + автореєстрація через DiscoveryService,
   cron через pg-boss schedule, `JobInboxService` (processed_jobs, exactly-once для DB-ефектів),
   транзакційна постановка через `fromPrisma(tx)`. Живі приклади: cron `auth.cleanup-expired-tokens`
   і `users.user-registered` (диспатч з API при реєстрації). Перевірено живим флоу API → worker.
2. **Auth-безпека**: reuse-detection ротованих токенів (`revokedAt` замість delete рядка);
   refresh → httpOnly + Secure + SameSite cookie (прибрати з localStorage).
3. `notifications`-модуль як перший споживач черги (email через Mailpit у dev).
   ⏳ Частково (2026-07-12): fan-out подія → `notifications.welcome-email` +
   `WelcomeEmailHandler`-заглушка; моніторинг черг в адмінці (`/jobs`: список із
   `pgboss.job` + зведення; історія — стандартний 7-денний retention pg-boss,
   рішення користувача). Лишилось: реальна відправка email через Mailpit.

## Фаза 3 — організації та RBAC (початок мультитенантності)

1. Моделі: `Organization`, `Membership { userId, organizationId, role }`, `Invitation`.
2. JWT отримує `orgId`; переключення організації = новий refresh-флоу.
3. RBAC: мапа role → permissions у `libs/contracts`, `@RequirePermissions('tickets:write')` + guard.
4. Tenant-контекст: `nestjs-cls` + Prisma Client Extension (авто-`where: { tenantId }`).
   RLS — свідомо відкладено (рішення користувача); заготовку міграцій можна додати пізніше.

## Фаза 4 — доменні модулі (еталони для форків)

1. `customers` — зразковий CRUD: список із фільтрами/сортуванням у URL (TanStack Router search params).
2. `tickets` — статусний workflow (open → in_progress → resolved), коментарі, події → черга.
3. `billing` — Plan/Subscription/Invoice, інтерфейс `PaymentProvider`, fake-провайдер → Stripe-адаптер,
   webhooks через чергу (ідемпотентність по `event_id UNIQUE`).
4. `audit-log` — запис чутливих операцій через events.

## Фаза 5 — operational maturity

- OpenTelemetry (traces), `@nestjs/terminus` health для api і worker, Sentry (опційно).
- Тести фронтенда (Vitest) для критичних флоу; уніфікація api-тестів на Vitest (зараз Jest).
- Env-валідація через Zod при старті (fail-fast), rate limiting, helmet.
