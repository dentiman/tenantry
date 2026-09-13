---

description: "Task list for Auth Hardening (AUTH-0 … AUTH-4)"
---

# Tasks: Auth Hardening (AUTH-0 … AUTH-4)

**Input**: Design documents from `specs/001-auth-hardening/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api.md](./contracts/http-api.md), [contracts/events-and-config.md](./contracts/events-and-config.md), [quickstart.md](./quickstart.md)

**Tests**: ВКЛЮЧЕНІ. Конституція, принцип XII: модуль не готовий без e2e золотого шляху, крайових випадків і перевірки RLS. Фронтових тестів у репо немає, тому кожна фаза з UI закінчується живим прогоном за quickstart.md.

**Organization**: фази 3–7 = user stories US1…US5 = заходи 1…5 плану `docs/auth-hardening-plan.md`. **Порядок фаз обов'язковий** (див. Dependencies).

**Правила, що діють у кожній задачі** (не повторюються в описах):
- Міграції створювати тільки так: `cd libs/database && pnpm exec prisma migrate dev --name <name>`. НЕ через `pnpm db:migrate:dev -- --name`.
- Транзакції лише `TenantTransactions.withTenantTx`. `ActivityRecorder.record(tx, …)` і `NotificationRecorder.notify(tx, …)` приймають `tx` першим аргументом.
- Кожна нова tenant-таблиця отримує в міграції `ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation` за шаблоном `docs/auth-hardening-plan.md` §1.3.
- Мапери явні: `tokenHash`, `prevTokenHash`, `totpSecretEncrypted`, `codeHash` у response-схемах не існують.
- Після зміни контракту чи контролера: `pnpm openapi:generate && pnpm web:codegen` (у фазі 5 ще й `pnpm platform:web:codegen`). Обидва артефакти комітяться.
- Рядки UI йдуть у i18next, множина через `_one`/`_other`; UI-примітиви беруться з `libs/ui`, скрол через `ScrollArea`.
- Коментарі в коді українською, ідентифікатори й логи англійською.
- `pnpm api:test:e2e` запускати лише після `pkill -f 'api|worker'`, тобто без піднятого dev-стеку.
- Виконав крок відповідного пункту `docs/auth-hardening-plan.md` — постав там `[x]` у тому ж коміті.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: можна виконувати паралельно (різні файли, без залежності від незавершених задач)
- **[Story]**: US1…US5 зі spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: залежності, потрібні з першого інкременту

- [X] T001 Встановити `@nestjs/throttler@^6.5` і `helmet@^8.3` в apps/api (`pnpm --filter @saas-skeleton/api add @nestjs/throttler helmet`) і в apps/platform-api (`pnpm --filter @saas-skeleton/platform-api add helmet`); переконатися, що `pnpm.onlyBuiltDependencies` у root `package.json` не потребує змін
- [X] T002 [P] Оновити табло `docs/auth-hardening-plan.md`: AUTH-0 → 🟨 в роботі

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: спільний Redis-клієнт і каркас валідації env. Без них не працюють ні throttler (US1), ні розрив сокетів (US2), ні нові env-змінні (US2–US5)

**⚠️ CRITICAL**: жодна user story не починається до завершення фази

- [X] T003 Створити `@Global()` модуль apps/api/src/redis/redis.module.ts з провайдерами `REDIS_CLIENT` (переїзд із apps/api/src/realtime/realtime-redis.provider.ts, ті самі `REDIS_URL`/`REALTIME_KEY_PREFIX` і дефолти) та `REDIS_THROTTLER_CLIENT` (окреме з'єднання з `enableOfflineQueue: false`, research R-01/R-16); `onApplicationShutdown` робить `quit()` обох клієнтів
- [X] T004 Видалити `REALTIME_REDIS` зовсім, без аліасу (research R-16): перевести apps/api/src/app.setup.ts, apps/api/src/realtime/realtime.module.ts (прибрати свій `onApplicationShutdown` із `quit()`), apps/api/src/realtime/presence/presence.store.ts на `REDIS_CLIENT`; видалити apps/api/src/realtime/realtime-redis.provider.ts і константу з apps/api/src/realtime/realtime.constants.ts; імпортувати `RedisModule` в apps/api/src/app.module.ts
- [X] T005 Створити apps/api/src/config/env.schema.ts: Zod-схема env з `validateEnv(config)` для `ConfigModule.forRoot({ validate })` в apps/api/src/app.module.ts; поки що лише наявні обов'язкові змінні (`DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `REDIS_URL`, S3-блок) без нових правил
- [X] T006 [P] Створити apps/platform-api/src/config/env.schema.ts з тим самим каркасом (`DATABASE_URL`/`PLATFORM_DATABASE_URL`, `PLATFORM_JWT_SECRET`) і підключити в apps/platform-api/src/app.module.ts
- [X] T007 Прогнати `pnpm typecheck --force && pnpm api:test:e2e` і переконатися, що realtime-сьюти (`apps/api/test/realtime.e2e-spec.ts`) зелені після переїзду клієнта

**Checkpoint**: фундамент готовий, поведінка системи не змінилась

---

## Phase 3: User Story 1 — Захист від перебору і гігієна периметра (Priority: P1) 🎯 MVP · AUTH-0

**Goal**: ліміти частоти з fail-open, справжній IP, CORS allowlist, helmet, env fail-fast, пароль ≥ 12

**Independent Test**: quickstart.md 0.1–0.10. Шість невдалих логінів дають 429, інший email проходить, чужий Origin відбивається, слабкий секрет валить старт, при зупиненій Valkey вхід працює

### Tests for User Story 1 ⚠️

> Написати ПЕРШИМИ і переконатися, що вони падають

- [X] T008 [P] [US1] В apps/api/test/auth.e2e-spec.ts: 6-й підряд логін на ту саму пошту з одного IP → 429, навіть із правильним паролем; тіло має форму `ApiError` із `code: 'TOO_MANY_REQUESTS'` і `requestId`, є заголовок `Retry-After`
- [X] T009 [P] [US1] В apps/api/test/auth.e2e-spec.ts: ліміт `(email, ip)` не заважає іншому email з того ж IP; після вичерпання вікна (окремий префікс ключа або короткий TTL у тесті) лічильник скидається
- [X] T010 [P] [US1] В apps/api/test/auth.e2e-spec.ts: fail-open. Підмінити storage через `overrideProvider` на такий, що кидає помилку → логін 200/401 (не 429 і не 503), а в логері зафіксовано `event: 'throttler_storage_unavailable'`
- [X] T011 [P] [US1] Новий apps/api/test/env.e2e-spec.ts: `validateEnv` кидає на `JWT_SECRET` < 32 символів і на літеральному значенні з `.env.example`; окремий кейс у apps/platform-api/test/platform.e2e-spec.ts: `PLATFORM_JWT_SECRET` не фолбечиться на `JWT_SECRET`
- [X] T012 [P] [US1] В apps/api/test/users.e2e-spec.ts: створення юзера з паролем з 11 символів → 400 з `fieldErrors` по `password`; 12 символів → 201
- [X] T013 [P] [US1] В apps/api/test/auth.e2e-spec.ts: запит із `Origin`, якого немає в allowlist, не отримує `Access-Control-Allow-Origin`; дозволений отримує; відповідь містить `X-Content-Type-Options` і не містить `X-Powered-By`
- [X] T014 [US1] Ізоляція в apps/api/test/setup-env.ts: пороги логіну піднімаються env-змінними `AUTH_LOGIN_LIMIT_PER_MINUTE`/`AUTH_LOGIN_IP_LIMIT_PER_MINUTE`, щоб наявні сьюти з логіном у `beforeAll` не впиралися в 429; ключі throttler-а живуть під `REALTIME_KEY_PREFIX` jest-worker-а; `auth.e2e-spec.ts` задає бойові значення явно і чистить свої ключі в `afterEach` (research R-17)

### Implementation for User Story 1

- [X] T015 [P] [US1] Додати `'TOO_MANY_REQUESTS', // 429` у `ApiErrorCodeSchema` в libs/contracts/src/error/error.schema.ts
- [X] T016 [US1] Нормалізувати `ThrottlerException` (429) в `ApiError` з кодом `TOO_MANY_REQUESTS` у спільному фільтрі libs/shared/src/errors/ (`AllExceptionsFilter`); `Retry-After` зберігається
- [X] T017 [US1] apps/api/src/common/throttler/redis-throttler.storage.ts — `ThrottlerStorage` на `REDIS_THROTTLER_CLIENT`: fixed window (`SET … PX NX` + `INCR` + `PTTL` в одному `multi`), ключ `{REALTIME_KEY_PREFIX}:throttle:{name}:{tracker}`. Помилка або таймаут (константа 200 мс у throttle.config.ts) → запис «не заблоковано» і `logger.warn({ event: 'throttler_storage_unavailable', throttler, error })` (research R-01)
- [X] T018 [US1] Трекери в apps/api/src/common/throttler/throttler.setup.ts: `emailAndIpTracker` для ліміту `login` (`trim().toLowerCase()`, обрізання до 254, не рядок → лише ip; research R-02), `userTracker` (`user:<sub>`, без `req.user` — ip); apps/api/src/common/throttler/app-throttler.guard.ts — підклас `ThrottlerGuard` лише заради стандартного `Retry-After` (пакетні заголовки вимкнені)
- [X] T019 [US1] Іменовані throttler-и в `ThrottlerModule.forRootAsync` (apps/api/src/common/throttler/throttler.setup.ts, імпорт в apps/api/src/app.module.ts) з кастомним storage: `default` 120/хв (`THROTTLE_DEFAULT_LIMIT_PER_MINUTE`); `AppThrottlerGuard` — третій `APP_GUARD` в apps/api/src/auth/auth.module.ts після `JwtAuthGuard` і `RolesGuard`
- [X] T020 [US1] Opt-in `@RateLimit(...)` (apps/api/src/common/throttler/rate-limit.decorator.ts, `skipIf` за метаданими — v6 застосовує кожен throttler до кожного роуту) в apps/api/src/auth/auth.controller.ts і apps/api/src/account/account.controller.ts: `POST /auth/login` — `login` 5/хв на `email+ip` (`AUTH_LOGIN_LIMIT_PER_MINUTE`) і `login-ip` 20/хв (`AUTH_LOGIN_IP_LIMIT_PER_MINUTE`); `POST /auth/refresh` — 30/хв на `ip` (`AUTH_REFRESH_LIMIT_PER_MINUTE`); `POST /account/password` і `POST /account/sessions/revoke-all` — 10/год на користувача (`ACCOUNT_SENSITIVE_LIMIT_PER_HOUR`)
- [X] T021 [US1] У `AuthService.login` (apps/api/src/auth/auth.service.ts) на кожен невдалий вхід писати `logger.warn({ event: 'auth_login_failed', email, ip, tenant })` із `requestId` з контексту pino; в activities нічого не писати
- [X] T022 [P] [US1] Розширити apps/api/src/config/env.schema.ts: `JWT_SECRET` мінімум 32 символи і ≠ значенню з `.env.example`; `CORS_ALLOWED_ORIGINS` (comma-separated, фолбек на `REALTIME_ALLOWED_ORIGINS`, потім `http://localhost:5173`); `TRUST_PROXY_HOPS` int ≥ 0, дефолт `1`; пороги throttler-а (`THROTTLE_DEFAULT_LIMIT_PER_MINUTE`, `AUTH_LOGIN_LIMIT_PER_MINUTE`, `AUTH_LOGIN_IP_LIMIT_PER_MINUTE`, `AUTH_REFRESH_LIMIT_PER_MINUTE`, `ACCOUNT_SENSITIVE_LIMIT_PER_HOUR`). Таймаут сховища — константа, не env (plan D-15)
- [X] T023 [US1] Одне джерело allowlist: apps/api/src/realtime/realtime.config.ts і HTTP-CORS читають той самий розпарсений список (винести функцію розбору в apps/api/src/config/ і використати в обох місцях), щоб HTTP і Socket.IO не розійшлися
- [X] T024 [US1] В apps/api/src/main.ts: `NestFactory.create<NestExpressApplication>`, `app.set('trust proxy', TRUST_PROXY_HOPS)`, `app.use(helmet())`, `app.enableCors({ origin: <allowlist>, credentials: true })` замість `enableCors()`; повторити helmet і CORS в apps/api/src/app.setup.ts (`configureApp`), щоб e2e перевіряли ту саму конфігурацію; перевірити, що `/api/docs` рендериться
- [X] T025 [P] [US1] Те саме для apps/platform-api/src/main.ts і apps/platform-api/src/app.setup.ts: trust proxy, helmet, CORS з дефолтом `http://localhost:5174`. Розширити apps/platform-api/src/config/env.schema.ts правилами для `PLATFORM_JWT_SECRET` (≥ 32, ≠ `.env.example`, без фолбеку), `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY_HOPS`. Throttler тут НЕ підключати — він прийде в US3 (research R-15)
- [X] T026 [P] [US1] Перевірити, що pino-логер apps/api/src/common/logger/logger.config.ts і apps/platform-api/src/logger.config.ts пише `req.ip` після `trust proxy`, а не `remoteAddress` сокета; виправити серіалізатор, якщо ні
- [X] T027 [P] [US1] `PasswordSchema` в libs/contracts/src/user/user.schema.ts → `z.string().min(12).max(128)`
- [X] T028 [US1] Оновити паролі сіду до ≥ 12 символів у libs/database/prisma/seed.ts, apps/api/test/test-users.ts, docs/database-seed.md і в розділі «Команди» CLAUDE.md (`Admin12345`/`Platform12345` → нові значення)
- [X] T029 [P] [US1] Документувати нові змінні в .env.example (з коментарями); перевірити, що `JWT_SECRET` і `PLATFORM_JWT_SECRET` у docker/deploy.env мають ≥ 32 символи, і додати туди `CORS_ALLOWED_ORIGINS`; прокинути нові змінні в docker/docker-compose.stack.yml для api і platform-api
- [X] T030 [P] [US1] Фронт: у libs/ui/src/api/api-error.ts обробити 429 як глобальну помилку з людським текстом; додати ключ `tooManyRequests` у libs/i18n/src/locales/en/errors.json
- [X] T031 [US1] `pnpm openapi:generate && pnpm web:codegen`; `pnpm lint && pnpm typecheck && pnpm build`; `pnpm api:test:e2e && pnpm platform:test:e2e`
- [X] T032 [US1] Живий прогін quickstart.md 0.1–0.10 (включно з 0.10: зупинена Valkey); оновити табло і §8 docs/auth-hardening-plan.md, записати відхилення D-1 і D-2 з plan.md
- [X] T032a [US1] **Після `/speckit-analyze` (F1, plan D-10)**: ліміт `default` рахується через `userTracker` (на користувача; анонімні — на ip) в apps/api/src/common/throttler/throttler.setup.ts, щоб офіс за одним NAT не ділив стелю; e2e «general ceiling» в apps/api/test/rate-limit.e2e-spec.ts (два юзери з одного IP: перший ловить 429, другий — 200); `THROTTLER_STORAGE_TIMEOUT_MS` прибрано з env (константа); запис у §8 docs/auth-hardening-plan.md

**Checkpoint**: US1 працює і перевірена незалежно — це вже цінний реліз

---

## Phase 4: User Story 2 — Сесії як пристрої (Priority: P2) · AUTH-1

**Goal**: `auth_sessions`, ротація зі стабільним `sid`, reuse-detection, TTL 7/30, список пристроїв і revoke в UI, миттєвий розрив WS, сповіщення безпеки, перехід без розлогінення

**Independent Test**: quickstart.md 1.1–1.9. Два браузери → дві сесії → завершити одну → вона миттєво втрачає сокет і refresh; наявні користувачі не розлогінені

### Tests for User Story 2 ⚠️

- [X] T033 [P] [US2] Новий apps/api/test/auth-sessions.e2e-spec.ts: логін створює рівно один рядок `auth_sessions` із заповненими `user_agent`/`ip`/`device_label`; ротація зберігає той самий `sid`, робить `generation` +1, посуває `idle_expires_at` і не чіпає `absolute_expires_at`
- [X] T034 [P] [US2] Там само: `absolute_expires_at` у минулому → refresh 401 при вірному секреті; `idle_expires_at` у минулому → 401
- [X] T035 [P] [US2] Там само: reuse у вікні — старий токен одразу після ротації → 200 і `generation` без змін; дві паралельні ротації тим самим токеном дають сумарно `generation` +1
- [X] T036 [P] [US2] Там само: reuse поза вікном (`prev_rotated_at` зсунуто на −2 хв через `SystemPrismaService`) → 401, `revoked_reason = 'rotation_reuse'`, в інбоксі юзера `auth.session_reuse_detected`; друга сесія того ж юзера жива; з `AUTH_REUSE_REVOKES_ALL_SESSIONS=true` (окремий застосунок у тому ж сьюті) — reuse поза вікном відкликає ВСІ сесії юзера; активність `user.sessions_revoked { reason: 'rotation_reuse' }` з актором `system`
- [X] T037 [P] [US2] Там само: невідомий секрет при живому `sid` → 401 і `revoked_reason = 'secret_mismatch'`; токен із префіксом чужого тенанта → 401
- [X] T038 [P] [US2] Там само: `GET /account/sessions` показує обидві сесії, `isCurrent` рівно в тієї, чий access-токен пред'явлено, поточна першою; у відповіді немає `tokenHash`/`revokedAt`; `DELETE /account/sessions/:id` сесії іншого юзера → 404, рядок живий; власної → 204; після `DELETE` власної — активність `user.sessions_revoked { reason: 'user', count: 1 }`
- [X] T039 [P] [US2] Там само: зміна пароля і revoke-all ставлять `revoked_at` усім сесіям (рядки лишаються), а поточний пристрій отримує робочу нову пару
- [X] T040 [P] [US2] Там само: міграційний шлях — рядок із вручну зібраним `argon2:<phc>` верифікується, після ротації `token_hash` починається з `sha256:`
- [X] T041 [P] [US2] Там само: вхід із новим `User-Agent` створює `auth.new_device` з `{ deviceLabel, ip }`; повторний вхід із тим самим UA за наявності живої сесії — не створює
- [X] T042 [P] [US2] В apps/api/test/tenant-isolation.e2e-spec.ts: сесія юзера тенанта B не видима під контекстом A; `DELETE /account/sessions/:id` сесії з B у контексті A → 404
- [X] T043 [P] [US2] В apps/api/test/realtime.e2e-spec.ts: після `DELETE /account/sessions/:id` рветься сокет САМЕ цієї сесії, а сокет іншої сесії того ж юзера лишається підключеним; після `revoke-all` рвуться всі сокети юзера; `auth.update.v1` з токеном нової сесії того ж юзера (інший `sid`) сокет не рве і переводить його в `sessionRoom` нового `sid` (наступний `DELETE` нової сесії його рве)
- [X] T044 [US2] Перевести наявні сьюти з `refresh_tokens` на `auth_sessions`: apps/api/test/auth.e2e-spec.ts, apps/api/test/account.e2e-spec.ts, apps/api/test/users.e2e-spec.ts (прямі prisma-доступи через `SystemPrismaService`; перевірки «рядок видалено» → «`revoked_at` не null»)

### Implementation for User Story 2

- [X] T045 [US2] Модель `AuthSession` у libs/database/prisma/schema.prisma — рівно поля з data-model.md §1: `id` uuid; `tenantId` з `@default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)"))`; `userId`; `tokenHash String` («`sha256:<hex>` або перенесений `argon2:<phc>`»); `prevTokenHash String?`; `prevRotatedAt DateTime?`; `generation Int @default(0)`; `issuedAt`/`lastUsedAt DateTime @default(now())`; `idleExpiresAt DateTime`; `absoluteExpiresAt DateTime`; `revokedAt DateTime?`; `revokedReason String?`; `userAgent String?`; `ip String?`; `deviceLabel String?`. Композитний FK `(tenantId, userId) → User(tenantId, id)` `onDelete: Cascade`; FK на `Tenant`; `@@index([tenantId, userId])`, `@@index([tenantId, idleExpiresAt])`; `@@map("auth_sessions")`. Модель `RefreshToken` видалити
- [X] T046 [US2] Міграція `auth_sessions`. Згенерований SQL дописати руками в порядку: (1) `CREATE TABLE`; (2) `INSERT INTO "auth_sessions" (id, tenant_id, user_id, token_hash, generation, issued_at, last_used_at, idle_expires_at, absolute_expires_at) SELECT id, tenant_id, user_id, 'argon2:' || token_hash, 0, created_at, created_at, expires_at, created_at + INTERVAL '30 days' FROM "refresh_tokens";`; (3) RLS-блок; (4) `DROP TABLE "refresh_tokens";` — тільки після `INSERT`. Перевірити очима порядок, потім `pnpm db:reset`
- [X] T047 [P] [US2] apps/api/test/rls.e2e-spec.ts: переконатися, що авточек `pg_policies` підхопив `auth_sessions`, і прибрати згадки `refresh_tokens`
- [X] T048 [P] [US2] Створити libs/shared/src/auth/user-agent.ts — `parseUserAgent(ua: string | undefined): string | null`: ~6 регексів (Edge, Chrome, Firefox, Safari × macOS, Windows, Linux, iPhone/iPad, Android) → «Chrome on macOS»; невідомий → «Unknown device»; без зовнішніх залежностей (research R-10); експорт у libs/shared/src/index.ts
- [X] T049 [P] [US2] Створити apps/api/src/common/client-context.decorator.ts — `@ClientContext()` → `{ ip: req.ip ?? null, userAgent: (req.headers['user-agent'] ?? '').slice(0, 512) || null }`
- [X] T050 [P] [US2] Тип `SessionRevokeReason` у libs/shared/src/auth/session-revoke-reason.ts: `'logout' | 'rotation_reuse' | 'secret_mismatch' | 'revoke_all' | 'password_change' | 'password_reset' | 'user_disabled' | 'mfa_reset' | 'user'`
- [X] T051 [US2] Env у apps/api/src/config/env.schema.ts: `AUTH_SESSION_IDLE_DAYS` int, дефолт `7`; `AUTH_SESSION_ABSOLUTE_DAYS` int ≥ idle, дефолт `30` (spec FR-014 вимагає конфігурованості); `AUTH_REUSE_REVOKES_ALL_SESSIONS` bool, дефолт `false`. Вікно reuse 60 с — константа в `AuthSessionService` (plan D-15). Задокументувати в .env.example
- [X] T052 [US2] Створити apps/api/src/auth/auth-session.service.ts: `create(tx, { userId, ip, userAgent })` — один `INSERT`, хеш `sha256:` рахується ДО запису, повертає `{ session, refreshToken: tenantId:sid:secret }` із 32 байтів `randomBytes`; `verifyAndConsume(refreshToken, clientContext)` — рівно 8 кроків із contracts/http-api.md § «POST /auth/refresh — порядок перевірок». Ротація — умовний `updateMany({ where: { id, tokenHash: old } })`, `count === 0` → повторити як шлях reuse. Порівняння хешів через `timingSafeEqual`; `argon2:`-гілка через `argon2.verify`, успіх переписує на `sha256:`. Reuse поза вікном → `revoke(sid, 'rotation_reuse')` (або `revokeAllForUser`, якщо `AUTH_REUSE_REVOKES_ALL_SESSIONS`) + `logger.error({ event: 'auth_refresh_reuse_detected', … })` + сповіщення + активність `user.sessions_revoked { reason: 'rotation_reuse', count }` (актор `system`, spec FR-021); невідомий секрет → `revoke(sid, 'secret_mismatch')` + `warn`. Також `revoke(tx, sid, reason)`, `revokeAllForUser(tx, userId, reason, { exceptSid? })` через `updateMany` (не `deleteMany`), що повертає `count`, і `listForUser(userId)` — лише живі
- [X] T053 [US2] Переписати apps/api/src/auth/auth.service.ts: `issueTokens` через `AuthSessionService.create` (двох запитів `tokenHash: ''` + `UPDATE` більше немає); payload JWT += `sid`, `jti` (`randomUUID()`); `refresh` через `verifyAndConsume`, далі перевірка `user.isActive && tenant.isActive`; `logout` → `revoke(sid, 'logout')` мовчки ідемпотентно; `login`/`refresh` приймають `ClientContext` з apps/api/src/auth/auth.controller.ts
- [X] T054 [US2] Додати `sid: string` і `jti: string` у `JwtPayload` в apps/api/src/auth/decorators/current-user.decorator.ts і у валідацію payload в apps/api/src/auth/access-token.service.ts; в apps/api/src/realtime/socket-auth.service.ts і обробнику `auth.update.v1` `sid` НЕ звіряти (research R-11) — лишити коментар чому
- [X] T055 [US2] «Новий пристрій» у `AuthService.login`: якщо в юзера немає живої сесії з тим самим `deviceLabel`, то в транзакції створення сесії `NotificationRecorder.notify(tx, …)` типу `auth.new_device` з актором `system`
- [X] T056 [P] [US2] Типи сповіщень у libs/contracts/src/notification/notification.schema.ts: `auth.new_device` payload `{ deviceLabel: string | null, ip: string | null }` і `auth.session_reuse_detected` payload `{ deviceLabel: string | null }`; у `NOTIFICATION_TYPE_META` обидва `{ category: 'security', defaultEnabled: true, muteable: false }`; тексти в libs/i18n/src/locales/en/notifications.json
- [X] T057 [P] [US2] Payload `user.sessions_revoked` у libs/contracts/src/activity/activity.schema.ts += `reason: z.string().optional()`; у коментарі типу записати правило spec FR-021: пишеться лише для `user`, `revoke_all`, `rotation_reuse`; оновити коментар про «ідентичності пристрою в моделі немає»; тексти з причиною в libs/i18n/src/locales/en/activities.json
- [X] T058 [US2] Перевести на `revokeAllForUser(tx, userId, reason)` (`updateMany`, не `deleteMany`): `UsersService.setPassword` → `'password_change'`, `UsersService.setStatus(false)` → `'user_disabled'` в apps/api/src/users/users.service.ts; `AccountService.changePassword` → `'password_change'`, `AccountService.revokeAllSessions` → `'revoke_all'` в apps/api/src/account/account.service.ts. Нова пара для ініціатора створюється ПІСЛЯ коміту. `user.sessions_revoked` пише лише `revokeAllSessions` (`count` з `updateMany().count`); зміна пароля і деактивація лишаються з власними `user.password_changed` / `user.disabled` без окремого запису (spec FR-021)
- [X] T059 [US2] Realtime на рівні сесії (plan D-12): `sessionRoom(tenantId, sid)` поруч із `userRoom` у libs/contracts/src/realtime/realtime.schema.ts; handshake в apps/api/src/realtime/ додає сокет у room сесії, обробник `auth.update.v1` при зміні `sid` переводить його в новий room. В apps/api/src/realtime/realtime.emitter.ts — `disconnectSession(sid)` і `disconnectUser(userId)` (`namespace.to(room).disconnectSockets(true)`), тенант обидва беруть із `TenantContextService` (CLS), а не з аргументу — їх викликають доменні сервіси (конституція I). `disconnectSession` — після коміту `DELETE /account/sessions/:id` і `rotation_reuse`; `disconnectUser` — після коміту в усіх місцях T058, у security-діях — після того, як нова пара вже сформована
- [X] T060 [P] [US2] Схема `AuthSessionResponseSchema` в libs/contracts/src/account/account.schema.ts: `{ id, deviceLabel: string|null, userAgent: string|null, ip: string|null, isCurrent: boolean, createdAt, lastUsedAt, idleExpiresAt, absoluteExpiresAt }`, дати `z.iso.datetime()`; тип в account.types.ts
- [X] T061 [US2] Мапер `toAuthSessionResponse(session, currentSid)` в apps/api/src/account/account.mapper.ts — явний, без спреду; `createdAt = issuedAt.toISOString()`
- [X] T062 [US2] В apps/api/src/account/account.controller.ts і account.service.ts: `GET /account/sessions` → `AuthSessionResponse[]` (поточна першою, далі `lastUsedAt DESC`); `DELETE /account/sessions/:id` → 204, чужа/неіснуюча/мертва → 404 (не 403), причина `'user'`, у транзакції активність `user.sessions_revoked { reason: 'user', count: 1 }`, після коміту `disconnectSession(sid)`. Swagger-метадані з `Dto.Output`
- [X] T063 [US2] Cron apps/worker/src/subscribers/cleanup-expired-tokens.subscriber.ts: видаляти з `auth_sessions` рядки, де `revoked_at < now() - 30d` OR `idle_expires_at < now() - 30d` OR `absolute_expires_at < now() - 30d` (без умови на idle сесія, що спливла від бездіяльності, жила б до 60 днів — spec FR-017), під `SystemPrismaService`; ім'я команди `auth.cleanup-expired-tokens` і черги НЕ змінювати
- [X] T064 [US2] `pnpm openapi:generate && pnpm web:codegen`
- [X] T065 [US2] `SessionsSection` в apps/web/src/pages/user-settings/security.tsx замість абзацу-пояснення: список на `Item*` з libs/ui, рядок = `deviceLabel` · IP · відносний `lastUsedAt` (хелпер з libs/ui/src/lib/format), бейдж «This device» для `isCurrent`, кнопка revoke з `AlertDialog` на кожному рядку, «Sign out everywhere» знизу; порожнього стану немає. Інвалідація `getAccountSessionsQueryKey()` після кожної дії, тости успіху й помилки
- [X] T066 [US2] Revoke поточної сесії в apps/web/src/pages/user-settings/security.tsx → `clearSession()` + редірект на `/login`; підпис про межу замінити на «realtime рветься миттєво, REST — до спливання access-токена (до 15 хвилин)»; рядки в apps/web/src/locales/en/user-settings.json
- [X] T067 [US2] `pnpm lint && pnpm typecheck && pnpm build`; `pnpm api:test:e2e`
- [~] T068 [US2] Живий прогін quickstart.md 1.1–1.9 виконано проти dev-API (два User-Agent → дві сесії,
  `GET /account/sessions` із правильним `isCurrent`, ротація зі стабільним `sid`, `DELETE` однієї сесії →
  204 + її refresh 401 + сусідня жива, чужий id → 404, `auth.new_device` в інбоксі, `user.sessions_revoked
  { reason: 'user' }` у журналі). **НЕ виконано**: 1.1 на БД зі СТАРИМИ рядками `refresh_tokens` (dev-БД на
  момент міграції мала 0 рядків — `INSERT … SELECT` перенiс нуль; сам `argon2:`-шлях покрито e2e) і 1.10
  (дві репліки api проти однієї Valkey) — обидва в §8. Табло і §8 оновлено

**Checkpoint**: US1 і US2 працюють незалежно

---

## Phase 5: User Story 3 — Refresh у httpOnly cookie + дзеркало control plane (Priority: P3) · AUTH-2

**Goal**: refresh-токен поза досяжністю JS в обох фронтах; control plane отримує сесії, refresh і throttler

**Independent Test**: quickstart.md 2.1–2.8. `localStorage` порожній, F5 зберігає вхід, вкладка живе 20+ хв, logout чистить cookie; те саме в platform-web

**Depends on**: US2 (cookie несе `sid`)

### Tests for User Story 3 ⚠️

- [ ] T069 [P] [US3] В apps/api/test/auth.e2e-spec.ts: логін ставить `Set-Cookie` з `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`; тіло без `refreshToken`; при `COOKIE_SECURE=true` у рядку заголовка є `Secure`
- [ ] T070 [P] [US3] Там само: refresh без cookie і без тіла → 401; з cookie → 200 і нова `Set-Cookie`; перехідно токен у тілі теж працює
- [ ] T071 [P] [US3] Там само: logout чистить cookie (`Max-Age=0`, той самий `Path`) і ставить `revoked_reason = 'logout'`; чужий `Origin` на `/auth/refresh` і `/auth/logout` → 403, без `Origin` → 200
- [ ] T072 [P] [US3] В apps/platform-api/test/platform.e2e-spec.ts: логін оператора ставить cookie `saas_platform_refresh` (`HttpOnly`, `Path=/api/auth`), тіло без refresh-токена, access живе 15 хв; refresh ротує і зберігає `sid`; reuse поза вікном → 401; logout чистить cookie і відкликає сесію; чужий `Origin` на refresh/logout → 403, без `Origin` → 200; 6-й логін → 429; 31-й refresh за хвилину з одного ip → 429; токени планів лишаються крос-невалідними (401 в обидва боки)

### Implementation for User Story 3 — tenant-план

- [ ] T073 [US3] Встановити `cookie-parser@^1.4` і `@types/cookie-parser` (dev) в apps/api і apps/platform-api; `app.use(cookieParser())` в apps/api/src/main.ts **і** apps/api/src/app.setup.ts
- [ ] T074 [P] [US3] Env у apps/api/src/config/env.schema.ts: `COOKIE_SECURE` bool, дефолт `true`; у .env.example і docker/deploy.env — `false` (http)
- [ ] T075 [US3] Створити apps/api/src/auth/refresh-cookie.ts — одне місце на ім'я `saas_refresh` і опції (`httpOnly: true, sameSite: 'lax', path: '/api/auth', secure: COOKIE_SECURE, maxAge = idleExpiresAt − now`): `set(res, token, idleExpiresAt)`, `clear(res)`, `read(req)`. Звірити з docker/nginx/default.conf.template, що браузер бачить саме `/api/auth` (research R-12)
- [ ] T076 [US3] Створити apps/api/src/auth/guards/origin.guard.ts: заголовок `Origin` присутній і його немає в allowlist із T023 → 403 `FORBIDDEN`; відсутній → пропуск. Застосувати до `refresh` і `logout`
- [ ] T077 [US3] В apps/api/src/auth/auth.controller.ts і apps/api/src/account/account.controller.ts: `login`, `refresh`, `account/password`, `account/sessions/revoke-all` отримують `@Res({ passthrough: true })` і ставлять cookie; `logout` чистить. Без `passthrough` тіло перестане серіалізуватись. `refresh`/`logout` читають токен спочатку з cookie, потім із тіла (перехідно, з коментарем «прибрати після AUTH-4»)
- [ ] T078 [P] [US3] `AuthTokensSchema.refreshToken` → `.optional()`, `RefreshSchema`/`LogoutSchema` → `refreshToken` optional в libs/contracts/src/auth/auth.schema.ts; мапери apps/api/src/auth/auth.mapper.ts більше не кладуть `refreshToken` у тіло
- [ ] T079 [US3] `pnpm openapi:generate && pnpm web:codegen && pnpm platform:web:codegen`
- [ ] T080 [US3] apps/web/src/api/http-client.ts: `withCredentials: true`; `refreshTokens()` шле `POST /api/auth/refresh` з порожнім тілом, single-flight лишається; логаут через `clearSession()` обов'язково кличе серверний `/auth/logout`
- [ ] T081 [US3] apps/web/src/stores/auth.store.ts: прибрати `REFRESH_TOKEN_KEY`, `getStoredRefreshToken()` і запис у `localStorage`, у пам'яті лишити тільки `user` + `accessToken`. apps/web/src/lib/init-auth.ts: безумовна спроба `refreshTokens()` з мовчазним `catch` і без маркерів «здається, залогінені»; одноразово видалити старий ключ `saas_refresh_token` з `localStorage`

### Implementation for User Story 3 — дзеркало control plane

- [ ] T082 [US3] Перенести throttler у libs/shared/src/auth/throttler/ — другий споживач (research R-15): `redis-throttler.storage.ts`, `app-throttler.guard.ts`, `rate-limit.decorator.ts`, `throttle.config.ts` і фабрику з трекерами з `throttler.setup.ts` (опції модуля приймають набір імен лімітів застосунку); apps/api імпортує звідти, файли в apps/api/src/common/throttler/ видалити. Додати в три місця: `tsconfig.base.json` paths, `apps/api/webpack.config.js` і `apps/platform-api/webpack.config.js` allowlist, якщо потрібен subpath
- [ ] T083 [US3] platform-api отримує Valkey: `*realtime-broker-env` для сервісу `platform-api` у docker/docker-compose.stack.yml; `REDIS_URL`/`REALTIME_KEY_PREFIX` і пороги (`THROTTLE_DEFAULT_LIMIT_PER_MINUTE`, `AUTH_LOGIN_LIMIT_PER_MINUTE`, `AUTH_LOGIN_IP_LIMIT_PER_MINUTE`, `AUTH_REFRESH_LIMIT_PER_MINUTE`) в apps/platform-api/src/config/env.schema.ts; Redis-модуль із `REDIS_THROTTLER_CLIENT` в apps/platform-api/src/; `ThrottlerModule` із тим самим fail-open storage, `AppThrottlerGuard` після guard-а автентифікації оператора; `@RateLimit` на `POST /auth/login` (5/хв `email+ip`, 20/хв `ip`) і `POST /auth/refresh` (30/хв `ip`); у apps/platform-api/test/setup-env.ts підняти пороги, як в api
- [ ] T084 [US3] Модель `PlatformAuthSession` у libs/database/prisma/schema.prisma — поля як у `AuthSession` (data-model.md §2) **без** `tenantId` і без RLS, FK `userId → PlatformUser(id)` `onDelete: Cascade`, `@@map("platform_auth_sessions")`; міграція `platform_auth_sessions` з `REVOKE ALL ON "platform_auth_sessions" FROM saas_app`
- [ ] T085 [US3] Сервіс сесій platform в apps/platform-api/src/auth/platform-auth-session.service.ts (create/verifyAndConsume/revoke — та сама механіка без tenant-префікса: токен `sid:secret`, вікно reuse 60 с). **Чесна копія**, а не спільне ядро в libs/shared: різні Prisma-моделі й формат токена, третього споживача немає (plan § Відкрите, конституція VIII)
- [ ] T086 [US3] apps/platform-api/src/auth/platform-auth.controller.ts і platform-auth.service.ts: `POST /auth/refresh` і `POST /auth/logout` (публічні, Origin-check), cookie `saas_platform_refresh` (`Path=/api/auth`, та сама `COOKIE_SECURE`); `PLATFORM_JWT_ACCESS_EXPIRES_IN` дефолт `15m` в apps/platform-api/src/auth/platform-auth.module.ts; env `AUTH_SESSION_*`, `COOKIE_SECURE` у platform env.schema; `cookieParser` у main.ts і app.setup.ts
- [ ] T087 [US3] apps/platform-web/src/api/http-client.ts, apps/platform-web/src/stores/auth.store.ts, apps/platform-web/src/lib/init-auth.ts: access-токен лише в пам'яті, single-flight refresh на 401 за зразком apps/web, `withCredentials: true`, безумовна спроба refresh на старті, logout кличе сервер; прибрати ключ access-токена з `localStorage`
- [ ] T088 [US3] `pnpm platform:web:codegen` (якщо змінився platform-контракт); `pnpm lint && pnpm typecheck && pnpm build`; `pnpm api:test:e2e && pnpm platform:test:e2e`
- [ ] T089 [US3] Живий прогін quickstart.md 2.1–2.8. Найтонше місце — 2.4 (socket-цикл `auth.expiring.v1` → `refreshTokens()` → `auth.update.v1` після 20+ хв). Оновити табло і §8 docs/auth-hardening-plan.md; якщо дзеркало не вмістилося — винести в окремий захід 6 і записати в §8 (platform не лишати в напівстані)

**Checkpoint**: US1–US3 працюють; токенів у сховищі сторінки немає ні в одному фронті

---

## Phase 6: User Story 4 — Відновлення доступу і зміна email (Priority: P4) · AUTH-3

**Goal**: одноразові посилання, скидання пароля без оракула, зміна email з підтвердженням на нову адресу

**Independent Test**: quickstart.md 3.1–3.7. «Forgot password» → лист у Mailpit → новий пароль → старі сесії мертві

**Depends on**: US1 (throttler), US2 (`revokeAllForUser`), US3 (cookie на `confirm`)

### Tests for User Story 4 ⚠️

- [ ] T090 [P] [US4] Новий apps/api/test/auth-recovery.e2e-spec.ts: неіснуючий email → 204 і жодної опублікованої події (мок pg-boss не отримав `send`); існуючий → 204 і рівно одна подія `auth.password-reset-requested.v1`, у payload якої `tokenEncrypted` з префіксом `v1:` і немає поля `token`; `CryptoService.decrypt(tokenEncrypted)` дає робочий токен
- [ ] T091 [P] [US4] Там само: повний цикл reset — токен із payload події → `confirm` → новий пароль працює, старий 401, усі попередні сесії `revoked_reason = 'password_reset'`, повернена пара робоча; у журналі `user.password_changed` з актором-юзером, окремої `user.sessions_revoked` немає
- [ ] T092 [P] [US4] Там само: повторний `confirm` тим самим токеном → 400 і пароль не змінився; `expires_at` у минулому → 400; перевидача токена інвалідує попередній; юзер деактивований або тенант призупинений між запитом і `confirm` → 400, пароль не змінився, сесії не видано, `used_at` лишився `null`
- [ ] T093 [P] [US4] Там само: токен `PASSWORD_RESET` не приймається на `email-change/confirm` і навпаки; токен тенанта A з підміненим префіксом B → 400
- [ ] T094 [P] [US4] Там само: зміна email — невірний `currentPassword` → 400 з `fieldErrors.currentPassword`; підтвердження змінює `users.email`, публікує `auth.email-changed.v1` і пише активність `user.email_changed`; адресу зайняли між запитом і підтвердженням → 409 з `fieldErrors.email`
- [ ] T095 [P] [US4] В apps/api/test/tenant-isolation.e2e-spec.ts або rls.e2e-spec.ts: `verification_tokens` під RLS, рядки тенанта B не видимі в контексті A
- [ ] T095a [P] [US4] В apps/api/test/env.e2e-spec.ts: `validateEnv` кидає без `ENCRYPTION_KEY` і на ключі, що після base64-декодування не дає рівно 32 байти (api); те саме для env-схеми воркера

### Implementation for User Story 4

- [ ] T096 [US4] Модель `VerificationToken` і enum `VerificationPurpose { PASSWORD_RESET EMAIL_CHANGE INVITE }` у libs/database/prisma/schema.prisma — поля з data-model.md §3: `id` uuid, `tenantId` (DB-default), `userId`, `purpose`, `tokenHash String` («`sha256:<hex>`»), `payload Json @default("{}")`, `expiresAt DateTime` («`now + 60 хв`»), `usedAt DateTime?`, `createdAt @default(now())`, `createdIp String?`; композитний FK `onDelete: Cascade`; `@@index([tenantId, userId, purpose])`; `@@map("verification_tokens")`. Міграція `verification_tokens` + RLS-блок
- [ ] T097 [P] [US4] Env: `APP_PUBLIC_URL` URL без хвостового `/`, дефолт `http://localhost:5173` — у worker env-схеми немає, тому читати через `ConfigService` у підписниках T104 з дефолтом і відрізанням хвостового `/`; строк токена 60 хв — константа у `VerificationTokenService` (plan D-15); `APP_PUBLIC_URL` у .env.example, docker/deploy.env, docker/docker-compose.stack.yml
- [ ] T097a [US4] **Шифрування переїжджає з AUTH-4** (plan D-11): libs/shared/src/crypto/crypto.service.ts — AES-256-GCM `encrypt(plain) → "v1:<iv b64>:<tag b64>:<ct b64>"` і `decrypt`, 12-байтний IV з `randomBytes`; ключ `ENCRYPTION_KEY` (base64, рівно 32 байти після декодування, інакше кидає при створенні); експорт у libs/shared/src/index.ts; провайдер у apps/api **і** apps/worker; `ENCRYPTION_KEY` обов'язковий в apps/api/src/config/env.schema.ts і у валідації env воркера (процес не стартує без валідного ключа); згенерований ключ у apps/api/test/setup-env.ts, .env.example (з командою генерації), docker/deploy.env, docker/docker-compose.stack.yml для api і worker
- [ ] T098 [US4] Створити apps/api/src/auth/verification-token.service.ts: `issue(tx, { purpose, userId, payload, ip })` — спершу `updateMany({ usedAt: now })` на незвикористані токени тієї ж мети, потім `create` з хешем `sha256:`; повертає сирий `tenantId:id:secret`. `consume(tx, purpose, rawToken)` — розбір, звірка префікса з рядком, умовний `updateMany({ where: { id, purpose, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })`, `count === 0` → `null`
- [ ] T099 [P] [US4] Схеми в libs/contracts/src/auth/auth.schema.ts (`PasswordResetRequestSchema { email: normalizedEmail, tenant? }`, `PasswordResetConfirmSchema { token: z.string().min(1), newPassword: PasswordSchema }`) і libs/contracts/src/account/account.schema.ts (`EmailChangeRequestSchema { newEmail, currentPassword }`, `EmailChangeConfirmSchema { token }`)
- [ ] T100 [P] [US4] Події в новому libs/shared/src/messaging/definitions/auth.messages.ts: `auth.password-reset-requested.v1` `{ userId: z.uuid(), tokenEncrypted: z.string().startsWith('v1:') }`, `auth.email-change-requested.v1` `{ userId, tokenEncrypted, newEmail: z.email() }`, `auth.email-changed.v1` `{ userId, previousEmail: z.email() }`, усі `scope: 'tenant'`; у коментарі — чому токен зашифрований (`pgboss.*` поза RLS, екран Jobs показує `data`); рядки в libs/shared/src/messaging/topology.ts зі споживачами `password-reset-email`, `email-change-email`, `email-changed-notice`
- [ ] T101 [US4] Password reset в apps/api/src/auth/password-reset/ (controller + service): `POST /auth/password-reset` (`@Public`, throttle 3/год `email+ip` і 20/год `ip`, пороги — константи) — тенант резолвиться як на логіні (`SlugTenantResolver`), для існуючого активного юзера в активному тенанті в `withTenantTx` робить `issue` + `publish` з `tokenEncrypted = CryptoService.encrypt(token)`, завжди 204. `POST /auth/password-reset/confirm` (`@Public`, 10/хв `ip`) — тенант із префікса токена; ДО `consume` перевірити `user.isActive && tenant.isActive`, інакше 400 `BAD_REQUEST` без споживання токена (kill-switch, spec FR-033); далі `consume`, argon2-хеш нового пароля, `revokeAllForUser(…, 'password_reset')`, активність `user.password_changed` з актором-юзером, після коміту `disconnectUser`, нова сесія + cookie, 200 `AuthResponse`; недійсний токен → 400 `BAD_REQUEST`
- [ ] T102 [US4] Зміна email в apps/api/src/account/account.controller.ts і account.service.ts: `POST /account/email-change` (5/год на юзера) — `argon2.verify` поточного пароля (невірний → 400 `fieldErrors.currentPassword`), адреса вже зайнята → 409 `fieldErrors.newEmail`, `issue(EMAIL_CHANGE, payload { newEmail })` + `publish` з `tokenEncrypted`, 204. `POST /account/email-change/confirm` (`@Public`, 10/хв `ip`, тенант із префікса) — перевірка `user.isActive && tenant.isActive` (інакше 400), `consume`, повторна перевірка унікальності (`fieldConflictException('email')` → 409), `update` email, активність `user.email_changed { from, to }`, `publish auth.email-changed.v1`, 200 `AccountResponse`
- [ ] T103 [P] [US4] Тип активності `user.email_changed` payload `{ user: EntityRefSchema, from: z.email(), to: z.email() }` в libs/contracts/src/activity/activity.schema.ts; текст у libs/i18n/src/locales/en/activities.json
- [ ] T104 [P] [US4] Підписники apps/worker/src/subscribers/password-reset-email.subscriber.ts, email-change-email.subscriber.ts, email-changed-notice.subscriber.ts за зразком `WelcomeEmailSubscriber`: `locale` і `name` свіжими з БД; токен — `CryptoService.decrypt(tokenEncrypted)` лише в пам'яті, у лог не пишеться; лінк `${APP_PUBLIC_URL}/reset-password/confirm?token=…` та `${APP_PUBLIC_URL}/confirm-email?token=…`; відправка через `MailerService`; шаблони в apps/worker/src/locales/en/notifications.json; зареєструвати в apps/worker/src/worker.module.ts
- [ ] T105 [US4] Cron apps/worker/src/subscribers/cleanup-expired-tokens.subscriber.ts: додатково видаляти `verification_tokens` з `expires_at < now() - 30d`
- [ ] T106 [US4] `pnpm openapi:generate && pnpm web:codegen`
- [ ] T107 [US4] Публічні сторінки поза `AppShell`: apps/web/src/pages/reset-password.tsx (форма email + опційне Organization, як на `/login`) і apps/web/src/pages/reset-password-confirm.tsx (новий пароль; після успіху `history.replaceState` без токена, `setSession` і перехід у `/workspace`). Роути в apps/web/src/router.tsx; посилання «Forgot password?» в apps/web/src/pages/login.tsx; рядки в apps/web/src/locales/en/auth.json
- [ ] T108 [US4] Секція зміни email в apps/web/src/pages/user-settings/account.tsx замість read-only-підпису: форма `newEmail` + `currentPassword` (RHF, повні `defaultValues`, `applyServerError`) і стан «лист надіслано». Сторінка підтвердження apps/web/src/pages/confirm-email.tsx — **публічний роут верхнього рівня `/confirm-email`** в apps/web/src/router.tsx поза `AppShell` і поза префіксами area (лист відкривають на незалогіненому пристрої, plan D-13), очищення токена з URL через `history.replaceState`, після успіху — повідомлення і посилання на `/login` (або `/user-settings/account`, якщо сесія є); рядки в apps/web/src/locales/en/user-settings.json
- [ ] T109 [US4] `pnpm lint && pnpm typecheck && pnpm build`; `pnpm api:test:e2e`
- [ ] T110 [US4] Живий прогін quickstart.md 3.1–3.7 разом із 3.3a (шифротекст у `pgboss.job` і на екрані Jobs) і 3.3b (деактивований юзер) з Mailpit (http://localhost:8025); оновити табло і §8 docs/auth-hardening-plan.md (D-3, D-4, D-11, D-13)

**Checkpoint**: US1–US4 працюють

---

## Phase 7: User Story 5 — Двофакторна автентифікація (Priority: P5) · AUTH-4

**Goal**: TOTP із QR, recovery-коди, двокроковий логін із лічильником спроб у БД, серверне обмеження при обов'язковій 2FA, скидання адміністратором

**Independent Test**: quickstart.md 4.1–4.14. Реальний застосунок на телефоні → логін просить код → recovery працює один раз → адмін вмикає обов'язкову 2FA → юзер без неї отримує 403 поза майстром → адмін скидає 2FA

**Depends on**: US1 (throttler), US2 (сесії, `revokeAllForUser`, `disconnectUser`), US3 (cookie на `mfa/verify` і `mfa/confirm`)

### Tests for User Story 5 ⚠️

- [ ] T111 [P] [US5] Новий apps/api/test/auth-mfa.e2e-spec.ts: логін юзера з 2FA → `status: 'mfa_required'`, `mfaToken` не є JWT і `JwtAuthGuard` його відхиляє; у `auth_sessions` нових рядків немає, у `mfa_challenges` — один
- [ ] T112 [P] [US5] Там само: валідний TOTP (згенерований `otplib` у тесті) → `status: 'ok'` і рівно одна нова сесія; код сусіднього кроку (±30 с) приймається, ±90 с — ні; повторне використання того самого коду в межах кроку → відмова
- [ ] T113 [P] [US5] Там само: 5 невірних кодів → `attempts = 5`; 6-та спроба з правильним кодом → 401; протухлий `expires_at` → 401; використаний (`consumed_at`) → 401
- [ ] T114 [P] [US5] Там само: recovery-код працює один раз, другий раз ні, `recoveryCodesRemaining` = 9, в інбоксі `auth.recovery_code_used { remaining: 9 }`, у журналі `user.recovery_code_used { remaining: 9 }` (spec FR-045)
- [ ] T115 [P] [US5] Там само: `mfa/setup` → `mfa/confirm` дає 10 кодів і свіжу пару; `setup` у `ENABLED` → 409; `disable` з невірним паролем → 400 `fieldErrors.currentPassword`; `disable` при `requireMfa` → 403; у БД `totp_secret_encrypted` починається з `v1:`; секрет і хеші не з'являються в жодній відповіді, крім `setup`
- [ ] T116 [P] [US5] Там само: enforcement — при `requireMfa` юзер без 2FA логіниться (`status: 'ok'`), `GET /api/customers` → 403 `MFA_SETUP_REQUIRED`, `GET /auth/me`, `GET /account`, `GET /settings/bootstrap`, `GET /account/mfa` → 200; socket-handshake відхилено; після `mfa/confirm` нова пара дає 200 на `/api/customers`; токен, виданий ДО вмикання політики, працює до refresh
- [ ] T117 [P] [US5] Там само: admin reset — `POST /users/:id/mfa/reset` від ADMIN стирає секрет/коди/challenges, сесії `revoked_reason = 'mfa_reset'`, активність `user.mfa_reset`, сповіщення `auth.mfa_reset`; для себе → 403; від не-ADMIN → 403; юзер без 2FA → 204 без побічних ефектів; чужий тенант → 404
- [ ] T118 [P] [US5] В apps/api/test/tenant-isolation.e2e-spec.ts: `user_recovery_codes` і `mfa_challenges` під RLS; `mfaToken` тенанта A з префіксом B → 401
- [ ] T119 [P] [US5] В apps/api/test/auth-recovery.e2e-spec.ts: `password-reset/confirm` для юзера з 2FA → `status: 'mfa_required'`, сесія не створена

### Implementation for User Story 5 — дані і примітиви

- [ ] T120 [US5] Встановити `otplib@^13.5` в apps/api і `qrcode@^1.5.4` + `@types/qrcode` в apps/web. Перед використанням звірити API otplib v13 через context7 (research R-14)
- [ ] T121 [US5] Схема в libs/database/prisma/schema.prisma (data-model.md §4–6): `User` += `totpSecretEncrypted String? @map("totp_secret_encrypted")` («`v1:<iv>:<tag>:<ct>`»), `totpEnabledAt DateTime? @map("totp_enabled_at")`, `totpLastUsedStep BigInt? @map("totp_last_used_step")`; модель `UserRecoveryCode` (`id`, `tenantId` DB-default, `userId`, `codeHash String` «argon2», `usedAt DateTime?`, `createdAt`, композитний FK Cascade, `@@map("user_recovery_codes")`); модель `MfaChallenge` (`id`, `tenantId` DB-default, `userId`, `tokenHash String` «`sha256:<hex>`», `attempts Int @default(0)`, `expiresAt DateTime`, `consumedAt DateTime?`, `createdAt`, `ip String?`, `userAgent String?`, композитний FK Cascade, `@@index([tenantId, userId])`, `@@map("mfa_challenges")`). Міграція `mfa` з RLS-блоком для обох нових таблиць
- [ ] T122 [P] [US5] Перевикористати `CryptoService` з T097a для секрету TOTP — нового шифрування не заводити; переконатися, що `totpSecretEncrypted` і токени AUTH-3 ділять один `ENCRYPTION_KEY` (версія `v1:` у форматі лишає місце для ротації ключа)
- [ ] T123 [P] [US5] Env: нових змінних немає — `ENCRYPTION_KEY` уже обов'язковий з T097a; строк `mfaToken` 300 с і стеля 5 спроб — константи в `MfaChallengeService` (plan D-15)
- [ ] T124 [P] [US5] Контракти: `ApiErrorCodeSchema` += `'MFA_SETUP_REQUIRED', // 403` (libs/contracts/src/error/error.schema.ts); `AuthResponseSchema` → `z.discriminatedUnion('status', [{ status: 'ok', user, tokens }, { status: 'mfa_required', mfaToken: z.string(), mfaExpiresAt: z.iso.datetime() }])` і `MfaVerifySchema { mfaToken, code: z.string().trim().min(6).max(16) }` (libs/contracts/src/auth/auth.schema.ts); `MfaStatusResponse`, `MfaSetupResponse { secret, otpauthUrl }`, `MfaConfirmSchema { code }`, `MfaConfirmResponse { recoveryCodes: z.array(z.string()).length(10), tokens }`, `MfaPasswordSchema { currentPassword }`, `RecoveryCodesResponse` (libs/contracts/src/account/account.schema.ts); `UserResponseSchema` += `mfaEnabled: z.boolean()` (libs/contracts/src/user/user.schema.ts); секція `security { requireMfa: z.boolean().default(false) }` у libs/contracts/src/settings/settings.schema.ts і в bootstrap
- [ ] T125 [P] [US5] Сповіщення в libs/contracts/src/notification/notification.schema.ts: `auth.mfa_enabled` `{}`, `auth.mfa_disabled` `{}`, `auth.mfa_reset` `{}`, `auth.recovery_code_used` `{ remaining: z.number().int() }` — усі `{ category: 'security', defaultEnabled: true, muteable: false }`; активності `user.mfa_enabled`, `user.mfa_disabled`, `user.mfa_reset`, `user.recovery_code_used` `{ user: EntityRefSchema, remaining }` в libs/contracts/src/activity/activity.schema.ts; тексти в libs/i18n/src/locales/en/notifications.json і activities.json
- [ ] T126 [US5] Перевірити, що orval згенерував `AuthResponse` як нормальний union. Якщо ні — запасний план research R-14 (два response-типи, 200/202) і запис у §8 docs/auth-hardening-plan.md

### Implementation for User Story 5 — бекенд

- [ ] T127 [US5] Створити apps/api/src/auth/mfa/mfa-challenge.service.ts: `create(tx, userId, clientContext)` → сирий `tenantId:id:secret` (хеш `sha256:`, `expiresAt = now + 300 с`, константа); `registerFailure(tx, id)` — `updateMany({ where: { id, consumedAt: null, attempts: { lt: 5 /* константа */ }, expiresAt: { gt: now } }, data: { attempts: { increment: 1 } } })`, на останній спробі `logger.warn({ event: 'auth_mfa_challenge_locked' })`; `consume(tx, rawToken)` — розбір, звірка префікса, та сама умова + `consumedAt: now`, `count === 0` → 401 (research R-19)
- [ ] T128 [US5] Створити apps/api/src/auth/mfa/mfa.service.ts: `setup(userId)` (409, якщо `totpEnabledAt`; секрет otplib → `CryptoService.encrypt` → `totpSecretEncrypted`; повертає `{ secret, otpauthUrl }` з issuer = назва продукту і label = email); `confirm(userId, code)` (перевірка ±1 кроку, `totpEnabledAt = now`, 10 recovery-кодів формату `xxxxx-xxxxx` base32 без неоднозначних символів, argon2-хеші, активність + сповіщення `auth.mfa_enabled` з актором `system`); `verifyCode(tx, userId, code)` — одноразовість через `updateMany({ where: { id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] } })` (research R-18), інакше recovery-код (нормалізація регістру, дефісів і пробілів; argon2 проти невикористаних; умовний `updateMany` на `usedAt`; сповіщення `auth.recovery_code_used` і активність `user.recovery_code_used`); `disable(userId, currentPassword)` (400 `fieldErrors.currentPassword`; 403, якщо `requireMfa`; стерти секрет/крок/коди/challenges; активність + `auth.mfa_disabled`); `regenerateRecoveryCodes(userId, currentPassword)`; `status(userId)`
- [ ] T129 [US5] Логін у apps/api/src/auth/auth.service.ts: після перевірки пароля, якщо `totpEnabledAt != null` → `MfaChallengeService.create` і `{ status: 'mfa_required', mfaToken, mfaExpiresAt }` БЕЗ сесії і cookie; інакше `{ status: 'ok', … }`. `password-reset/confirm` (apps/api/src/auth/password-reset/) — та сама гілка для юзера з 2FA
- [ ] T130 [US5] `POST /auth/mfa/verify` в apps/api/src/auth/mfa/mfa.controller.ts (`@Public`, throttle 10/хв `ip`): тенант із префікса `mfaToken`; невірний код → `registerFailure` + 400 `fieldErrors.code`; вірний → в одній транзакції `consume` + `AuthSessionService.create`, cookie, перевірка «нового пристрою», 200 `status: 'ok'`
- [ ] T131 [US5] Claim `mfaSetupRequired` в apps/api/src/auth/auth.service.ts: при кожній видачі access-токена (login, refresh, `mfa/verify`, `mfa/confirm`, password/revoke-all, reset confirm) рахувати `tenant.settings.security.requireMfa && user.totpEnabledAt == null`, у payload додавати лише коли `true`; додати в `JwtPayload` і валідацію `AccessTokenService` (research R-20)
- [ ] T132 [US5] Створити apps/api/src/auth/decorators/allow-during-mfa-setup.decorator.ts і apps/api/src/auth/guards/mfa-enrollment.guard.ts — `APP_GUARD` у apps/api/src/auth/auth.module.ts, зареєстрований після `JwtAuthGuard` і `RolesGuard` і ДО `AppThrottlerGuard` (порядок реєстрації = порядок виконання; забанений політикою запит не має витрачати ліміт): `@Public` → пропуск; claim `mfaSetupRequired` без `@AllowDuringMfaSetup()` → `ForbiddenException` з кодом `MFA_SETUP_REQUIRED` (нормалізувати в `AllExceptionsFilter`). Позначити декоратором: `GET /auth/me`, `GET /account`, `GET /settings/bootstrap`, `GET /account/mfa`, `POST /account/mfa/setup`, `POST /account/mfa/confirm`
- [ ] T133 [US5] Realtime: в apps/api/src/realtime/socket-auth.service.ts handshake і обробник `auth.update.v1` відхиляють токен із `mfaSetupRequired: true` кодом `MFA_SETUP_REQUIRED`
- [ ] T134 [US5] Контролер `/account/mfa` в apps/api/src/auth/mfa/mfa.controller.ts: `GET /account/mfa`, `POST setup` (10/год на юзера), `POST confirm` (10/хв на юзера; відповідь `{ recoveryCodes, tokens }` + cookie, нова пара без claim-а), `POST disable` (10/год), `POST recovery-codes` (10/год); мапери без секрету й хешів; зареєструвати модуль в apps/api/src/auth/auth.module.ts
- [ ] T135 [US5] Скидання адміном: `POST /users/:id/mfa/reset` в apps/api/src/users/users.controller.ts під `@Roles(Role.ADMIN)`, логіка в apps/api/src/users/users.service.ts: `:id === sub` → 403 `FORBIDDEN`; немає / чужий тенант → 404; без 2FA → 204 без побічних ефектів; інакше `withTenantTx`: стерти `totp_*`, `user_recovery_codes`, незавершені `mfa_challenges`, `revokeAllForUser(…, 'mfa_reset')`, активність `user.mfa_reset` (актор — адмін), сповіщення `auth.mfa_reset`; після коміту `disconnectUser`. `UsersMapper` мапить `mfaEnabled = totpEnabledAt != null` (apps/api/src/users/users.mapper.ts)
- [ ] T136 [US5] Секція `security` у apps/api/src/settings/settings.controller.ts і settings.service.ts: `GET /settings/security`, `PUT /settings/security` під `@Roles(ADMIN)` (документ у `Tenant.settings.security`, журнал змін — наявний механізм секцій), `requireMfa` у `GET /settings/bootstrap`; зміна політики НЕ інвалідує токени
- [ ] T137 [US5] Cron apps/worker/src/subscribers/cleanup-expired-tokens.subscriber.ts: видаляти `mfa_challenges` з `expires_at < now() - 1 day`
- [ ] T138 [US5] `pnpm openapi:generate && pnpm web:codegen`

### Implementation for User Story 5 — фронт

- [ ] T139 [US5] Крок 2 логіну в apps/web/src/pages/login.tsx: окремий стан форми (не роут); на `status: 'mfa_required'` поле коду (6 цифр) і перемикач «use a recovery code»; `mfaToken` лише в стані компонента; 401 → повернення на крок пароля з поясненням; рядки в apps/web/src/locales/en/auth.json
- [ ] T140 [US5] 2FA у apps/web/src/pages/user-settings/security.tsx: картка стану (`GET /account/mfa`); майстер вмикання з 3 кроків (QR через `QRCode.toDataURL(otpauthUrl)` → `<img>`, під ним секрет текстом із кнопкою копіювання → поле коду → екран 10 recovery-кодів з кнопкою завантаження `.txt` через Blob-URL і підтвердженням «я зберіг»); вимкнення і перегенерація кодів з підтвердженням паролем (`applyServerError`); після `confirm` — `setSession` з новою парою; рядки в apps/web/src/locales/en/user-settings.json
- [ ] T141 [US5] Примусовий майстер: сторінка apps/web/src/pages/mfa-setup.tsx поза `AppShell` (перевикористовує компонент майстра з T140) і роут в apps/web/src/router.tsx; в apps/web/src/api/http-client.ts (або глобальному `onError` у apps/web/src/main.tsx) 403 з кодом `MFA_SETUP_REQUIRED` → редірект на майстер без тосту; в libs/ui/src/api/api-error.ts цей код не вважається глобальною помилкою; `beforeLoad` захищених роутів перевіряє `bootstrap.security.requireMfa && !mfa.enabled`
- [ ] T142 [P] [US5] Кнопка «Reset 2FA» з `AlertDialog` на картці apps/web/src/pages/user-detail.tsx: лише для ADMIN, лише при `user.mfaEnabled`, не на власній картці; інвалідація картки й гріда; рядки в apps/web/src/locales/en/users.json
- [ ] T143 [P] [US5] Сторінка apps/web/src/pages/settings/security.tsx (Switch `requireMfa`, форма-документ як у general.tsx); пункт у apps/web/src/app-shell/areas/settings-sidebar.tsx, шлях у apps/web/src/app-shell/paths.ts, роут в apps/web/src/router.tsx; рядки в apps/web/src/locales/en/settings.json
- [ ] T144 [US5] `pnpm lint && pnpm typecheck && pnpm build` (перевірити розмір web-бандла: з `qrcode` має потрапити лише `dijkstrajs`, research R-23); `pnpm api:test:e2e`
- [ ] T145 [US5] Живий прогін quickstart.md 4.1–4.14 з **реальним застосунком-автентифікатором на телефоні**; оновити табло і §8 docs/auth-hardening-plan.md (D-6…D-9)

**Checkpoint**: усі п'ять історій працюють

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T146 Прибрати перехідне читання refresh-токена з тіла в apps/api/src/auth/auth.controller.ts і apps/platform-api/src/auth/platform-auth.controller.ts; `RefreshSchema`/`LogoutSchema` → порожні тіла; регенерувати контракти (борг плану §7, «прибрати після заходу 5»)
- [ ] T147 [P] Документація: docs/account-settings.md §2 і §6 (рівень 1 зроблено, WS-розрив миттєвий); docs/roadmap.md §2.5 (закриті пункти); docs/multi-tenancy-architecture.md (нові tenant-таблиці); docs/notifications.md (нові типи категорії `security`)
- [ ] T148 [P] CLAUDE.md: блок «Auth Hardening завершений і перевірений» у шапці; розділ «Auth» (cookie, `sid`, сесії, 2FA, fail-open); таблиця «Зафіксовані рішення» — рядок Auth; оновлена кількість e2e у «Команди»
- [ ] T149 [P] Коментарі-обґрунтування в коді для неочевидних рішень: fail-open throttler-а (T017), загальна стеля на користувача (T032a), `sid` не звіряється в `auth.update.v1` (T054), тенант емітера з CLS (T059), шифрований токен у payload (T100), claim замість запиту в БД (T131), окремий Redis-клієнт (T003)
- [ ] T150 Фінальний прогін: `pnpm lint && pnpm typecheck --force && pnpm build`; `pkill -f 'api|worker'; pnpm api:test:e2e && pnpm platform:test:e2e`; вибірковий повтор quickstart.md 0.1, 1.3, 2.2, 3.3, 4.3, 4.9; **на стенді `saas-dev` після деплою** — у pino-лозі api `ip` реального клієнта, а не адреса nginx/overlay (spec SC-003); фінальне табло docs/auth-hardening-plan.md (усі ✅)
- [ ] T151 Запустити `/speckit-analyze` для перевірки узгодженості spec / plan / tasks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → блокує всі історії
- **US1 (Phase 3)** — лише Foundational
- **US2 (Phase 4)** — US1: `trust proxy` дає `ip` для сесій, env-схема, throttler на `/account/*`
- **US3 (Phase 5)** — US2: cookie несе `tenantId:sid:secret`; дзеркало platform потребує `AuthSessionService` як зразок
- **US4 (Phase 6)** — US1 (throttler на публічних роутах), US2 (`revokeAllForUser`), US3 (cookie на `confirm`)
- **US5 (Phase 7)** — US1, US2, US3. Від US4 технічно залежать T119 (reset + 2FA) і T122 (`CryptoService` з T097a). Порядок 4→5 зафіксований планом, не переставляти без запиту
- **Polish (Phase 8)** — після US5 (T146 саме тоді й знімає перехідну гілку)

Порядок фаз **обов'язковий і послідовний** (`docs/auth-hardening-plan.md`). Паралельно працювати можна лише всередині фази.

### Within Each Story

Тести (падають) → схема/міграція → контракти → сервіси → контролери → `openapi:generate`/codegen → фронт → lint/typecheck/build/e2e → живий прогін → оновлення табло.

### Parallel Opportunities

- Phase 2: T006 паралельно з T003–T005
- US1: тести T008–T013; T015, T022, T025, T026, T027, T029, T030 (різні файли)
- US2: тести T033–T043; T047, T048, T049, T050, T056, T057, T060
- US3: тести T069–T072; T074, T078
- US4: тести T090–T095a; T097, T099, T100, T103, T104 (T104 — після T097a)
- US5: тести T111–T119; T122–T125; T142, T143

---

## Parallel Example: User Story 2

```bash
# Тести разом (один файл auth-sessions.e2e-spec.ts — пишуться послідовно; інші файли паралельно):
Task: "T042 [US2] tenant-isolation для auth_sessions в apps/api/test/tenant-isolation.e2e-spec.ts"
Task: "T043 [US2] disconnect сокета в apps/api/test/realtime.e2e-spec.ts"

# Примітиви без взаємних залежностей:
Task: "T048 [US2] parseUserAgent в libs/shared/src/auth/user-agent.ts"
Task: "T049 [US2] @ClientContext в apps/api/src/common/client-context.decorator.ts"
Task: "T050 [US2] SessionRevokeReason в libs/shared/src/auth/session-revoke-reason.ts"
Task: "T056 [US2] типи сповіщень у libs/contracts/src/notification/notification.schema.ts"
Task: "T060 [US2] AuthSessionResponseSchema в libs/contracts/src/account/account.schema.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2
2. Phase 3 (US1): ліміти, CORS, helmet, env, пароль
3. **STOP and VALIDATE**: quickstart.md 0.1–0.10
4. Реліз: це закриває найгучніший ризик (перебір паролів) без жодної міграції

### Incremental Delivery

Один захід = одна фаза = одна сесія роботи = окремий реліз:
AUTH-0 (US1) → AUTH-1 (US2) → AUTH-2 (US3) → AUTH-3 (US4) → AUTH-4 (US5) → Polish.
Кожен захід закінчується зеленими e2e, живим прогоном і оновленим табло `docs/auth-hardening-plan.md`. Якщо крок виконати не можна — `[~]` і рядок у §8, чекбокс не прибирати.

### Ризикові місця (перевіряти очима)

- T046 — порядок `INSERT … SELECT` перед `DROP TABLE`
- T077 — `@Res({ passthrough: true })`, інакше порожні тіла
- T089 / quickstart 2.4 — socket-цикл після переходу на cookie
- T059 — `disconnectSession` проти `disconnectUser`: одиночний revoke не рве інші пристрої; `disconnectUser` — після видачі нової пари ініціатору
- T097a/T100 — сирий токен ніде не потрапляє в payload, лог чи DLQ
- T101 — kill-switch ДО `consume`, інакше деактивований юзер спалює токен і отримує сесію
- T132 — порядок трьох `APP_GUARD`; новий 🔒-ендпоінт закритий під час налаштування 2FA за замовчуванням
