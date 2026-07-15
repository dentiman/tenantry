# SaaS Skeleton — архітектурна пропозиція

> Дата: 2026-07-11. Основа для мультитенантної CRM/ERP-системи з білінгом,
> кастомерами, тікетами та розподіленою обробкою черг і завдань.
> Зафіксовано рішення: backend — NestJS, frontend — React (TanStack Query + Zustand).
> Базується на аналізі проєкту `fibo-admin` (~6 міс. тому) та сучасних практик 2026 року.

---

## 1. Що беремо з fibo-admin, а що робимо інакше

### Беремо (перевірені патерни)

| Патерн                                                                       | Де у fibo-admin                     | Коментар                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Shared Zod-контракти як єдине джерело правди                                 | `libs/contracts`                    | Zod-схеми + `z.infer<>`, жодних ручних типів API. Ключовий патерн, переносимо як є                                            |
| Шарування DTO → Service → Mapper → Controller                                | `apps/api/src/users`                | Mapper запобігає витоку полів (`passwordHash`). Розширимо до use-case шару                                                    |
| JWT + refresh rotation + theft detection                                     | `apps/api/src/auth/auth.service.ts` | Формат `tokenId:secret`, argon2-хеш у БД, повторне використання ротованого токена → відкликання всіх сесій. Сильна реалізація |
| Глобальний guard за замовчуванням + `@Public()`                              | `auth/guards/jwt-auth.guard.ts`     | Secure-by-default                                                                                                             |
| Pino-логування з редакцією чутливих полів                                    | `apps/api/src/common/logger`        | Переносимо разом з ротацією файлів                                                                                            |
| `PrismaExceptionFilter` (P2025→404, P2002→409)                               | `common/filters`                    | Переносимо                                                                                                                    |
| Ізоляція Prisma в окрему лібу                                                | `libs/prisma`                       | Переносимо як `libs/database`                                                                                                 |
| Формат відповідей: flat entity / `{ items, total, page, limit, totalPages }` | конвенція                           | Переносимо                                                                                                                    |

### Робимо інакше (прогалини fibo-admin і застарілі рішення)

| Прогалина                                                          | Рішення в новому скелетоні                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Немає мультитенантності взагалі                                    | Tenant-контекст на AsyncLocalStorage + `tenantId` в кожній таблиці + Postgres RLS (див. §3) |
| Немає RBAC — будь-який залогінений юзер має повний CRUD            | Ролі на рівні membership в організації + permissions guard (див. §5)                        |
| Немає черг, воркерів, cron                                         | BullMQ + окремий app `worker` (див. §4)                                                     |
| Токени в localStorage (XSS-ризик)                                  | Access-токен у пам'яті, refresh — httpOnly cookie                                           |
| Немає OpenAPI/Swagger (лише Postman)                               | `@nestjs/swagger` + zod → OpenAPI → генерація typed React Query hooks (orval)               |
| Немає CI                                                           | GitHub Actions з першого дня: lint, typecheck, build, e2e                                   |
| Angular 21 на фронті                                               | React 19 + Vite (рішення зафіксовано)                                                       |
| Розбіжності доки ↔ код (порти, версія zod, «planned» для готового) | Правило: доки оновлюються в тому ж PR, що й код                                             |

---

## 2. Монорепозиторій

**Рекомендація: pnpm workspace + Turborepo** (кешування білдів/тестів, граф залежностей). fibo-admin використовує чистий pnpm — з двома аппами цього досить, але з 3+ аппами і 5+ лібами Turborepo окупається одразу. Nx — потужніший, але важчий і нав'язує свої генератори; для форк-friendly скелетона Turborepo простіший.

```
apps/
  api/        # NestJS REST API (HTTP-шар)
  worker/     # NestJS standalone app: BullMQ processors, cron
  web/        # React 19 + Vite
libs/
  contracts/  # Zod-схеми + типи (залежить лише від zod)
  database/   # Prisma schema, migrations, PrismaService, tenant-extension
  shared/     # утиліти, спільні для api/worker (не тягнути у web)
docker/       # compose: postgres, redis, mailpit
docs/
```

Ключовий принцип: `api` і `worker` — два entry-points над спільними доменними модулями. Доменна логіка живе в модулях, які імпортуються обома аппами, тому job-processor викликає той самий service, що й контролер.

---

## 3. Мультитенантність — варіанти

> **Ревізія 2026-07-15.** Напрямок (модель A) підтверджено, але дві деталі нижче переглянуті
> на запит користувача — актуальне джерело правди: [multi-tenancy-plan.md](multi-tenancy-plan.md).
> Коротко, що змінилося: (1) **RLS — не «опційно», а основний enforcement**; (2) **рівень 2
> (авто-`where: { tenantId }`) скасовано** — extension виставляє тільки RLS-контекст
> (`set_config`), дубль фільтра в коді нічого не додає й розходиться з політикою при помилці;
> (3) **Membership скасовано** — `users.tenant_id NOT NULL`, User належить рівно одному tenant-у;
> (4) додано розділення **data plane / control plane** (окремий `apps/platform-api`).

| Модель                                    | Плюси                                                                 | Мінуси                                                                           | Вердикт                    |
| ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| **A. Shared schema + `tenantId` (+ RLS)** | Дешева, проста міграція, необмежена к-сть тенантів, простий онбординг | Ізоляція лише логічна; ризик помилки розробника                                  | ✅ **Рекомендація**        |
| B. Schema-per-tenant                      | Сильніша ізоляція, простий export тенанта                             | Міграції ×N схем, погано масштабується >сотень тенантів, Prisma підтримує погано | Ні для скелетона           |
| C. Database-per-tenant                    | Максимальна ізоляція, compliance                                      | Дорого в операціях, connection pooling, provisioning                             | Лише для enterprise-форків |

**Рекомендована реалізація (A) — три рівні захисту:**

1. **Tenant-контекст**: `nestjs-cls` (AsyncLocalStorage). Middleware/guard резолвить тенанта з JWT-клейму `orgId` (основний шлях) або субдомена і кладе в CLS. Worker бере `tenantId` з payload джоби і так само встановлює контекст.
2. **ORM-рівень**: Prisma Client Extension, який автоматично додає `where: { tenantId }` до всіх запитів tenant-scoped моделей і підставляє `tenantId` при create. Розробник фізично не може забути фільтр.
3. **БД-рівень (defense-in-depth)**: Postgres Row-Level Security. Транзакція починається з `SET LOCAL app.tenant_id = ...`; політики RLS відсікають чужі рядки навіть якщо рівень 2 обійшли. У скелетоні — опційно, але заготовити міграції.

**Модель даних тенантства** (важливо для CRM/ERP): tenant = `Organization`. Користувач може належати до кількох організацій через `Membership { userId, organizationId, role }`. Це гнучкіше, ніж жорстке `user.tenantId`, і одразу дає інвайти, зміну ролей та переключення організацій у UI.

---

## 4. Черги та розподілені завдання

> **Рішення (2026-07-11): pg-boss поверх PostgreSQL.** Реалізація відкладена на фазу 2 — фаза 1 без черг.

| Технологія             | Плюси                                                                                                                                                                                                        | Мінуси                                                                                                               | Вердикт                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **pg-boss (Postgres)** | Нуль додаткової інфраструктури; **транзакційна постановка джоби разом із бізнес-змінами** (outbox не потрібен); retries/backoff, cron, пріоритети, DLQ, singleton keys; джоби в тих самих бекапах, що й дані | Пропускна здатність — сотні–тисячі джоб/сек (polling, навантаження на основну БД); немає flows і UI рівня Bull Board | ✅ **Обрано** — навантаження CRM/ERP (нотифікації, webhooks, експорти) покриває з запасом |
| BullMQ (Redis)         | `@nestjs/bullmq`, найбагатший функціонал (flows, rate-limit, Bull Board), десятки тисяч джоб/сек                                                                                                             | +Redis в інфрі; постановка джоби поза транзакцією БД → потрібен transactional outbox                                 | Задокументована альтернатива для high-throughput форків                                   |
| RabbitMQ / Kafka       | Справжній брокер / event streaming                                                                                                                                                                           | Overkill для скелетона                                                                                               | Ні                                                                                        |

**Структура (фаза 2):**

- `apps/worker` — окремий NestJS-процес лише з handlers (масштабується незалежно від API).
- Черга схована за власним інтерфейсом (`JobDispatcher` / `@JobHandler()` у `libs/shared`) — доменний код не знає про pg-boss, форк може замінити на BullMQ.
- Cron — через pg-boss schedule (безпечно при кількох репліках).
- Внутрішні події між модулями — `EventEmitter2` (in-process); контракт подій у `libs/contracts`.

**Ідемпотентність (at-least-once → handler зобов'язаний бути повторно-безпечним):**

1. Дедуплікація при постановці: pg-boss `singletonKey` (BullMQ — детермінований `jobId`).
2. Природна ідемпотентність через стан: `updateMany({ where: { id, status: 'PENDING' } })`, `count === 0` → вже оброблено.
3. Transactional inbox: `processed_jobs(key UNIQUE)` + `ON CONFLICT DO NOTHING` у одній транзакції з бізнес-ефектом.
4. Зовнішні виклики — з idempotency key провайдера (Stripe `Idempotency-Key`); вхідні webhooks — `event_id UNIQUE`.
5. Retries з backoff → після N невдач — dead letter queue.

---

## 5. Авторизація — порівняння варіантів

Вимоги мультитенантного CRM/ERP: організації + інвайти, ролі per-organization, RBAC/permissions, у перспективі — SSO (SAML/OIDC) для enterprise-клієнтів, 2FA.

| Варіант                                          | Плюси                                                                                                                                   | Мінуси                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A. Власна реалізація (еволюція fibo-патерну)** | Патерн уже перевірений (rotation + theft detection); повний контроль; нуль зовнішніх залежностей і lock-in; ідеально для форк-скелетона | Треба самим писати orgs/invites/RBAC, 2FA; SSO — велика робота, коли знадобиться                                             |
| B. better-auth                                   | Сучасний TS-стек, плагіни organizations/2FA/SSO з коробки, self-hosted                                                                  | Інтеграція з NestJS другорядна (framework-agnostic/Express-first); нав'язує свою схему БД; молодий проєкт для фундаменту ERP |
| C. Keycloak / Zitadel / Ory                      | Enterprise SSO, SAML/OIDC per tenant, багатий admin                                                                                     | Важка інфраструктура (окремий сервіс + БД), UX кастомізація болюча, overkill на старті                                       |
| D. Clerk / Auth0 / WorkOS                        | Найшвидший старт, готові org-фічі                                                                                                       | Vendor lock-in, ціна росте з MAU, дані користувачів у третьої сторони — погано для форк-шаблона                              |

**Рекомендація: варіант A** — переносимо auth-модуль fibo-admin і розширюємо:

1. **Organizations + Memberships + Invitations** — таблиці та CRUD у скелетоні.
2. **JWT payload**: `{ sub, email, orgId, role }` — токен видається в контексті активної організації; переключення організації = новий токен (refresh-флоу).
3. **RBAC**: enum-ролі membership (`OWNER | ADMIN | MEMBER`) + мапа `role → permissions[]` у `libs/contracts` + `@RequirePermissions()` decorator + guard. Permissions-строки (`tickets:write`, `billing:manage`) — щоб форки додавали свої без зміни ядра.
4. **Зберігання токенів**: refresh — httpOnly + Secure + SameSite cookie (замість localStorage у fibo), access — тільки в пам'яті фронтенда.
5. **Чиста межа**: `AuthModule` ізольований так, щоб форк міг замінити його на Keycloak/OIDC-адаптер, коли доросте до enterprise SSO. Для цього — власний інтерфейс `TokenIssuer`/`IdentityProvider` замість розсипаних викликів `JwtService`.

---

## 6. ORM і база даних

**Рекомендація: Prisma 7 + PostgreSQL 17** (як у fibo-admin — довести до продовження, а не міняти):

- Prisma 7 з driver adapters (`@prisma/adapter-pg`) — вже без rust-движка, швидший і легший.
- Client Extension для tenant-скоупінгу (див. §3) — головна причина лишитись на Prisma: розширення добре лягає на цей патерн.
- Альтернатива Drizzle: легша, ближче до SQL, але міграційний тулінг і DX для великої доменної моделі ERP поки слабші; виграш не виправдовує відмову від готових патернів fibo.
- Міграції: Prisma Migrate; сід-дані для dev (`db:seed`) з демо-організацією.

---

## 7. API-контракти та фронтенд

**Backend → frontend конвеєр:**

1. Zod-схеми в `libs/contracts` (патерн fibo, оновити до Zod 4).
2. `nestjs-zod` → глобальний `ZodValidationPipe` + генерація OpenAPI через `@nestjs/swagger` (у fibo Swagger немає — додаємо).
3. **orval** генерує з OpenAPI типізовані TanStack Query hooks — фронт не пише fetch-код руками.

**Frontend-стек:**

| Шар          | Вибір                                                                                                                                          | Коментар                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Збірка       | Vite 7 + React 19                                                                                                                              |                                                                                                                                                           |
| Server state | TanStack Query v5                                                                                                                              | Весь API-стан тут, не в Zustand                                                                                                                           |
| Client state | Zustand                                                                                                                                        | Тільки UI-стан: сайдбар, активна організація, фільтри. Малий за визначенням                                                                               |
| Routing      | TanStack Router                                                                                                                                | Type-safe routes + search params (фільтри списків CRM у URL — критично для ERP); альтернатива React Router 7 — простіший, але без type-safe search params |
| UI           | shadcn/ui + Tailwind CSS 4                                                                                                                     | Компоненти в коді проєкту — ідеально для форк-шаблона (без залежності від зовнішнього UI-kit, на відміну від fibo з `@fibo-ui/*`)                         |
| Форми        | react-hook-form + zod resolver                                                                                                                 | Ті самі схеми з `libs/contracts`                                                                                                                          |
| Auth-флоу    | access у пам'яті, silent refresh через httpOnly cookie, single-flight refresh (портуємо ідею interceptor-черги з fibo на axios/fetch-обгортку) |                                                                                                                                                           |

---

## 8. Доменні модулі скелетона

Мінімальний набір, що демонструє всі патерни (кожен модуль = еталон для форків):

- **`organizations`** — тенанти, memberships, інвайти, переключення. Ядро мультитенантності.
- **`customers`** — еталонний CRUD: список з пагінацією/фільтрами/сортуванням, деталі, форма. Зразок для всіх майбутніх CRM-сутностей.
- **`tickets`** — сутність зі статусним workflow (open → in_progress → resolved), коментарі, призначення. Демонструє доменні події + нотифікації через чергу.
- **`billing`** — плани, підписки, інвойси. Provider-agnostic інтерфейс `PaymentProvider` + Stripe-адаптер + обробка webhooks через чергу (idempotency по event id). Скелетон працює і з fake-провайдером без Stripe-акаунта.
- **`notifications`** — email через чергу (dev: Mailpit у docker), шаблони.
- **`audit-log`** — запис чутливих операцій через events; для ERP це обов'язково, і додати пізніше значно дорожче.

## 9. Cross-cutting та інфраструктура

- **Валідація**: Zod 4 всюди (backend pipe, frontend forms).
- **Логування**: Pino + nestjs-pino, редакція чутливих полів (порт із fibo), `tenantId`/`requestId` у кожному лог-записі через CLS.
- **Health/observability**: `@nestjs/terminus` (`/health` для api і worker), OpenTelemetry SDK — заготовка (traces у dev — у консоль), Sentry — опційний hook.
- **Config**: `@nestjs/config` + zod-валідація env при старті (fail-fast на відсутніх змінних; у fibo цього немає).
- **Docker compose**: postgres:17-alpine, redis:7-alpine, mailpit. Один `docker-compose.yml` + профілі.
- **CI (GitHub Actions)**: lint → typecheck → build → unit → e2e (testcontainers або compose) на кожен PR. Turborepo remote cache — опційно.
- **Тести**: Vitest всюди (замість Jest у api — уніфікація), e2e для api через supertest + реальний Postgres.

---

## 10. Зафіксовані рішення (2026-07-11)

1. ~~**Postgres RLS — не вмикаємо.**~~ **Переглянуто 2026-07-15** (запит користувача): RLS —
   **основний enforcement** ізоляції, вмикається у фазі MT-2. Див. [multi-tenancy-plan.md](multi-tenancy-plan.md).
   Формулювання «повернемось разом із мультитенантністю» відпрацювало саме так, як планувалося.
2. **Мультитенантність — відкладена** (актуально досі: поточний стан скелетона — single-tenant).
   **Уточнено 2026-07-15**: single-tenant тепер не «інша архітектура», а **N=1** тієї самої —
   колонка `tenant_id` є завжди, схема й доменний код у обох режимах ідентичні. План — фази
   MT-1…MT-4 у [multi-tenancy-plan.md](multi-tenancy-plan.md).
3. **Авторизація — портуємо з fibo-admin як є** (JWT + refresh rotation + theft detection, глобальний guard + `@Public()`). Розширення (organizations, RBAC) — пізніше.
4. **Перший етап реалізації: авторизація + користувачі** (auth + users модулі end-to-end).
5. **ORM — Prisma 7 + PostgreSQL 17** (порівняння з Drizzle проведено: вирішили перенести перевірений database-шар fibo-admin; Drizzle — лише якби стартували з нуля під serverless/SQL-важку аналітику).
6. **API-конвеєр підтверджено**: Zod-контракти → nestjs-zod/Swagger → OpenAPI → orval → typed TanStack Query hooks.
7. **Черги — pg-boss** (Postgres, транзакційна постановка, без outbox); BullMQ — альтернатива для high-throughput форків. **Реалізація — у фазі 2**, фаза 1 без черг.
8. **Обсяг фази 1**: монорепо-каркас + docker + CI, `libs/contracts`, `libs/database`, API (auth порт із fibo-admin + users), OpenAPI → orval, React-фронтенд з auth-флоу та users CRUD.

## 10a. Відкриті питання

1. **Zod 4 vs 3**: контракти писати одразу на Zod 4 (fibo на 3.25) — рекомендую 4, але треба перевірити сумісність `nestjs-zod`.
2. **Stripe**: чи є вже акаунт/провайдер, чи скелетон стартує лише з fake-провайдером?
3. **Мова доків проєкту**: українська/російська/англійська?

## 11. Статус реалізації фази 1 (2026-07-11) — ✅ виконано

Реалізовано: монорепо (pnpm + Turborepo), docker (postgres 17), `libs/contracts` (Zod 4),
`libs/database` (Prisma 7 + seed), `apps/api` (auth порт із fibo-admin + users CRUD + Swagger
`/api/docs` + Pino + PrismaExceptionFilter), конвеєр OpenAPI → orval, `apps/web` (React 19 +
Vite + TanStack Router/Query + Zustand + Tailwind 4: login/register/dashboard/users), CI.
Перевірено: 40 jest e2e-тестів, lint/typecheck чисті, живий флоу через dev-проксі.

**Відхилення від fibo-admin та знахідки:**

1. **nestjs-zod v4 → v5**: `patchNestJsSwagger` застарів, у v5 — `cleanupOpenApiDoc` + `.Output`-DTO.
2. **Zod 3 → 4** (питання закрито): `.Output` DTO вимагають Zod 4; нормалізацію email робимо
   `z.string().trim().toLowerCase().pipe(z.email())` — у Zod 4 формат перевіряється до transform-ів.
3. **Дати в контрактах — ISO-рядки** (`z.iso.datetime()`), бо `z.coerce.date()` непредставний
   у JSON Schema; мапери конвертують `Date → toISOString()`. Контракт = wire-формат.
4. **Збірка API — webpack** (як fibo): tsc не переписує path aliases у emitted JS;
   OpenAPI-генерація — окремо через ts-node (`openapi:generate`).
5. **Логи** — `join(process.cwd(), 'logs')` замість `__dirname`-магії (ламалась поза webpack).
6. **Нюанс безпеки (у фазу 2)**: theft detection у fibo спрацьовує лише на валідний `tokenId`
   з невірним секретом; повторне використання ротованого токена дає 401, але НЕ відкликає інші
   сесії (рядок видалено). Для справжньої reuse-detection треба позначати токени
   (`revokedAt`), а не видаляти.

## 12. Порядок реалізації (пропозиція)

1. Каркас монорепо (pnpm + Turborepo), docker compose, CI, лінтери — «нульовий» PR.
2. `libs/database` + `libs/contracts`, базові моделі (User, Organization, Membership, RefreshToken).
3. Auth (порт із fibo + httpOnly cookies) + organizations/invites + RBAC guard.
4. Tenant-контекст (nestjs-cls) + Prisma tenant-extension + тести на ізоляцію.
5. `apps/worker` + BullMQ + outbox + notifications (email).
6. Frontend-каркас: Vite + Router + Query + auth-флоу + layout.
7. Еталонний модуль `customers` end-to-end (API + черга + UI).
8. `tickets` (workflow + події), потім `billing` (fake-провайдер → Stripe).
