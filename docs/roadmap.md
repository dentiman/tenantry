# Roadmap

Стан на 2026-07-12. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md).

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
3. ✅ **`notifications`-модуль** — перший споживач черги (email через Mailpit у dev). Fan-out
   подія → `notifications.welcome-email`; моніторинг черг в адмінці (`/jobs`: список із
   `pgboss.job` + зведення; історія — стандартний 7-денний retention pg-boss, рішення
   користувача). Реальна відправка через Mailpit — завершено разом з I18N-3 (2026-07-12,
   деталі нижче): `WelcomeEmailHandler` більше не заглушка.

## Фаза 3 — мультитенантність та RBAC

> **Переглянуто 2026-07-15, реалізовано MT-0…MT-3.** Архітектура — [multi-tenancy-architecture.md](multi-tenancy-architecture.md)
> (єдиний довідник: як воно працює, обґрунтування рішень, MT-4/беклог). Два рішення від 2026-07-11
> переглянуті на запит користувача: **RLS з «не вмикаємо» став основою ізоляції**, а
> «Organization + Membership» — **`users.tenant_id NOT NULL`** (User належить одному tenant-у).
> Головний принцип: мультитенантність **невидима для бізнес-коду** — ні `where: { tenantId }`,
> ні передачі tenantId у `create`; усе робить інфраструктура (CLS + extension + RLS + DB-default).

1. ✅ **MT-0** (2026-07-16) — DB-ролі (`saas_migrator`/`saas_app`/`saas_platform`) + розділення
   env-URL-ів. ✅ **MT-1** (2026-07-16) — фундамент без RLS: `Tenant`, `tenant_id` на
   tenant-таблицях, `TenancyModule` (nestjs-cls + extension `set_config`, не `where`),
   `withTenantTx`; черги — tenantId у payload + `cls.run` у воркері; register видалено;
   refresh `tenantId:tokenId:secret`. Деталі і спіймані граблі — CLAUDE.md шапка + migration-док.
2. ✅ **MT-2** (2026-07-16) — RLS увімкнено: політики `USING`+`WITH CHECK` (+FORCE, крім
   `tenants` — там SECURITY DEFINER `resolve_tenant`), тести ізоляції (два тенанти /
   CLS-конкурентний / SQL-smoke fail-closed / авточек `pg_policies` у e2e). 67 e2e зелені,
   живий фан-аут під RLS. Доменний код не змінювався.
3. ✅ **MT-3** (2026-07-17) — control plane: `apps/platform-api` (:3002, `platform_users`,
   окремий `PLATFORM_JWT_SECRET`, роль `saas_platform`); гейт дотримано — `/jobs` переїхав
   ПЕРЕД CRUD тенантів (з tenant-api і web видалено); CRUD тенантів (create+перший admin
   атомарно, suspend/resume); slug-login end-to-end (`SlugTenantResolver` + поле на формі).
   63+11 e2e, живий прогін: create tenant → slug-login → ізоляція. Глобальні довідники —
   відкладено до першого реального довідника (та сама логіка, що рівень 3).
   ✅ **`apps/platform-web`** (2026-07-17) — клон каркасу `apps/web` (Vite/TanStack/HeroUI/orval):
   сторінки Tenants (CRUD + suspend/resume через AlertDialog) і Jobs (моніторинг, той самий
   `createDataGrid`, що був у tenant-web). Живий прогін у браузері: login → create tenant
   з форми → suspend/resume → сесія переживає F5 → jobs-таблиця з реальними даними.
4. **RBAC** (після MT-2, поверх готового tenant-контексту): мапа role → permissions
   у `libs/contracts`, `@RequirePermissions('tickets:write')` + guard.
5. Наскрізний correlationId у чергах (зафіксовано 2026-07-12, робити разом із nestjs-cls
   у MT-1): зараз `req.id` з pino-http НЕ доїжджає до воркера — payload містить лише
   бізнес-дані, кореляція рветься на межі черги. План: `JobDispatcher.send` бере requestId
   з cls-контексту і кладе службовим полем поруч із payload (pg-boss окремого metadata
   не має), `JobWorkerRegistrar` знімає його в `JobContext` + child-логер — логи воркера
   зв'язуються з API-запитом. Лог-конверт довкола хендлера (started/completed/failed)
   уже зроблено у фазі 2. Див. також Observability у фазі 5.

Single-tenant форки скелетона це не ускладнює: колонка `tenant_id` є завжди, single-tenant —
це просто **N=1** (один рядок `Tenant`, id з env, control plane не деплоїться). Схема БД
і доменний код у обох режимах ідентичні; `if (multiTenant)` у коді немає.

## Фаза i18n — мультиязичність (зафіксовано 2026-07-12; виконати ДО фази 4)

Кросс-катинг фаза, можна паралельно з фазою 3. Повний план і зафіксовані рішення —
[i18n-plan.md](i18n-plan.md). Коротко: бекенд — коди, текст рендерить споживач;
i18next (web + worker); JSON у репо (`libs/i18n` + `apps/*/locales`); стартово тільки `en`.

1. ✅ **I18N-1** (завершено 2026-07-12). `libs/i18n` (спільні `common`/`errors`/`validation`,
   стаби errors/validation — заповнить I18N-2) + `apps/web/src/i18n` (react-i18next, детекція
   localStorage `saas_locale` → `navigator.language` → `en`, типізація ключів через
   `typeof import()` в `resources.d.ts`). Фічеві namespace-и `apps/web/src/locales/en/`
   (auth/users/jobs/dashboard/layout). Усі рядки адмінки винесені в ключі, включно з
   job-станами й ролями користувача (мапінг enum → переклад, не сирий рядок) і `Trans`
   для тексту з розміткою (підтвердження видалення користувача). `Intl.DateTimeFormat`-хелпери
   (`lib/format.ts`) замінили прямі `toLocaleDateString`/`toLocaleString`. Перевірено живим
   флоу (логін → dashboard/users/jobs, діалог видалення), lint/typecheck/build чисті.
2. ✅ **I18N-2** (завершено 2026-07-12). `FieldErrorSchema` + опційні `code`/`params`
   (`libs/contracts`); `AllExceptionsFilter` кладе Zod issue `code` у fieldErrors
   VALIDATION_ERROR, `code: 'already_exists'` для P2002; `fieldConflictException(field, msg, code?)`
   з тим самим дефолтом. `errors.json` (`libs/i18n`) заповнено: `codes.*` (усі 8 ApiErrorCode),
   `toast.*` (заголовки), `fieldErrors.*` (Zod issue codes + `already_exists`), `network`/`generic`
   (фронтові синтезовані повідомлення). Веб: `z.config(zodEn())` локалізує вбудовані Zod-повідомлення
   (`apps/web/src/i18n`); `parseApiError` перекладає network/generic на джерелі; toast (`error-toast.ts`)
   перекладає заголовок і опис по `code`; `applyServerError` перекладає `fieldError.code`
   з fallback на англійський `message`, коли ключа немає (відкрита множина кодів). Кастомних
   Zod-повідомлень у contracts немає — п. 3 з i18n-plan.md (переписати на ключі) виявився зайвим.
   Перевірено: 47 e2e зелені (виправлено точне порівняння fieldErrors під новий `code`),
   lint/typecheck/build чисті, живий флоу — дубль email у create-user-modal показує перекладене
   «Already exists» під полем (мережа підтверджує `code: 'already_exists'` у відповіді).
3. ✅ **I18N-3** (завершено 2026-07-12). `users.locale TEXT DEFAULT 'en'` (Prisma-міграція
   `add_user_locale`); `UserLocaleSchema = z.enum(['en'])` у `libs/contracts` (свідомо ОКРЕМА
   від `SUPPORTED_LOCALES` з `libs/i18n` — contracts лишається залежним лише від zod; I18N-4
   додає нову мову в обидва місця) — `UserSchema.locale` (response), `CreateUserSchema.locale`
   (опційний, дефолт `'en'`; `UpdateUserSchema` успадковує); `users.mapper.ts` віддає поле.
   `apps/worker`: плейн `i18next` (без react-i18next) з локальним `src/locales/en/notifications.json`
   — НЕ через `libs/i18n` (нема поки що спільного контенту з web, наскрізна залежність була б
   передчасною абстракцією). `MailerService` (nodemailer) + Mailpit-сервіс у `docker-compose.yml`
   (SMTP 1025, UI 8025, дефолти в `MailerService` через `ConfigService`, override — `SMTP_HOST`/
   `SMTP_PORT`/`SMTP_FROM`). `WelcomeEmailHandler` читає `locale`+`name` свіжими з БД по `userId`
   (не з job payload), рендерить subject/body через `i18n.t(..., { lng: locale })`, шле реальний
   лист — заглушка та коментар «природно ідемпотентна» прибрані (тепер at-least-once side effect,
   задокументовано в коді чому це прийнятно для welcome-листа).
   **Свідомо НЕ зроблено** (щоб не городити мертвий код): фронтова пріоритетність
   `profile.locale` над `localStorage` і будь-яка UI-форма вибору locale — з `SUPPORTED_LOCALES
   = ['en']` це неспостережувана поведінка (locale завжди `'en'`); реальний сенс з'явиться
   разом з мовним перемикачем в I18N-4. `RegisterSchema` теж без `locale` — немає відправника.
   Перевірено: 47 e2e зелені, lint/typecheck/build (усіх 7 пакетів) чисті, живий флоу —
   реєстрація через API → `users.user-registered` → `notifications.welcome-email` → лист у
   Mailpit («Welcome to SaaS Skeleton!», тіло з `{{name}}`-інтерполяцією з `notifications.json`,
   HTML не задвоєно екранований).
4. **I18N-4** (відкладено): друга мова, language switcher, TMS (Tolgee — кандидат).

## Фаза 4 — доменні модулі (еталони для форків)

1. `customers` — зразковий CRUD: список із фільтрами/сортуванням у URL (TanStack Router search params).
2. `tickets` — статусний workflow (open → in_progress → resolved), коментарі, події → черга.
3. `billing` — Plan/Subscription/Invoice, інтерфейс `PaymentProvider`, fake-провайдер → Stripe-адаптер,
   webhooks через чергу (ідемпотентність по `event_id UNIQUE`).
4. `audit-log` — запис чутливих операцій через events.

## Фаза 5 — operational maturity

- **Observability (зафіксовано 2026-07-12, імплементація — після вибору способу деплою).**
  Два незалежні інструменти, не конкуренти:
  - **Error tracking — Sentry** (або self-hosted GlitchTip, SDK-сумісний): групування 5xx за stack
    trace, алерти, прив'язка до релізів. Deployment-агностичний — умовна ініціалізація по
    `SENTRY_DSN` у `main.ts` api і worker + `Sentry.captureException` у гілці ≥500
    `AllExceptionsFilter` (tag `requestId`). Можна підключати будь-коли, не чекаючи деплою.
  - **Агрегація логів — Grafana Loki + Alloy**: збирає stdout усіх контейнерів, пошук у Grafana
    (у т.ч. по `requestId` із Sentry-issue — зв'язка через наявний requestId у кожному записі;
    для логів воркера кореляція з'явиться після correlationId у чергах — фаза 3, п. 5).
    Залежить від деплою: Docker Compose на VM → Alloy-контейнер у compose; Kubernetes → DaemonSet.
    Код готовий без змін — JSON у stdout уже є.
  - **Підготовчий фікс логера**: прод-режим — тільки stdout; `rotating-file-stream` у `cwd/logs` —
    антипатерн у контейнері (ефемерна FS, колектор не бачить), зробити opt-in через env
    (`LOG_FILE`) для сценарію «гола VM без оркестрації».
- OpenTelemetry (traces; латентність базово вже в логах — `responseTime` від pino-http),
  `@nestjs/terminus` health для api і worker.
- Тести фронтенда (Vitest) для критичних флоу; уніфікація api-тестів на Vitest (зараз Jest).
- Env-валідація через Zod при старті (fail-fast), rate limiting, helmet.
