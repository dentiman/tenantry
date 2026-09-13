# Implementation Plan: Auth Hardening (AUTH-0 … AUTH-4)

**Branch**: `001-auth-hardening` (робоча гілка — `feature/auth-new-features`) | **Date**: 2026-09-13 (ревізія 3 — після `/speckit-analyze`) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-auth-hardening/spec.md`; першоджерело рішень — `docs/auth-hardening-plan.md`

## Summary

П'ять послідовних інкрементів, що закривають дірки auth, знайдені аудитом 2026-09-12:

1. **AUTH-0** — throttler на Valkey (ключ `email+ip`, загальна стеля на користувача, **fail-open** при недоступному брокері),
   `trust proxy`, CORS allowlist, спільний із Socket.IO, `helmet`, Zod-валідація env на
   старті, пароль ≥ 12. Без міграцій.
2. **AUTH-1** — `auth_sessions` (рядок = пристрій, `sid` переживає ротацію), SHA-256 замість
   argon2 для секрету з перенесенням без розлогінення, reuse-detection з вікном 60 с, TTL
   7/30 днів, список пристроїв і вибірковий revoke в UI, миттєвий розрив WS, сповіщення безпеки.
3. **AUTH-2** — refresh у httpOnly cookie `SameSite=Lax; Path=/api/auth`, Origin-check, фронт
   без токенів у `localStorage`; дзеркало в platform-api/platform-web (сесії, refresh,
   15-хвилинний access, throttler).
4. **AUTH-3** — `verification_tokens` (одна таблиця, `purpose`), скидання пароля без оракула,
   зміна email з підтвердженням на нову адресу, листи через `MESSAGE_TOPOLOGY` із
   **зашифрованим** токеном у payload (`CryptoService` переїжджає сюди з AUTH-4).
5. **AUTH-4** — TOTP (`otplib`), AES-256-GCM для секрету (той самий `CryptoService`), 10 argon2 recovery-кодів, QR у
   браузері (`qrcode`), логін як discriminated union з непрозорим `mfaToken` і лічильником
   спроб у `mfa_challenges`, політика `requireMfa` із **серверним** обмеженням
   (`MFA_SETUP_REQUIRED`), скидання 2FA адміністратором.

Порядок обов'язковий (2→3, 4→5 — жорсткі залежності). Кожен інкремент — окремий робочий
захід з власним DoD і живим прогоном ([quickstart.md](./quickstart.md)).

**Що змінила сесія уточнень** (spec § Clarifications, research R-19…R-23): лічильник 2FA —
у БД, а не Valkey; ліміти — fail-open; обов'язкова 2FA блокується на сервері; додано скидання
2FA адміном; вибрано QR-пакет.

**Що змінив `/speckit-analyze`** (ревізія 3, D-10…D-15 нижче): загальна стеля — на
користувача (виправлено в уже зробленому AUTH-0); токен у черзі — зашифрований; realtime
рветься на рівні сесії, тенант емітер бере з CLS; час дії обов'язкової 2FA на живі сесії
(≤ 15 хв) і два рішення дизайну (reset → `mfa_required`, заборона `disable` під політикою)
перенесені у spec; налаштування без споживача стали константами.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node.js 24 (локально 24.8)

**Primary Dependencies**: NestJS 11, Prisma 7 (adapter-pg), Zod 4 + nestjs-zod v5, ioredis 5,
Socket.IO 4 + Redis Streams adapter, pg-boss v12, React 19 + Vite 7 + TanStack Router/Query,
react-hook-form, shadcn/ui (Base UI) через `libs/ui`, i18next.
**Нові**: `@nestjs/throttler` 6.5 + `helmet` 8.3 (AUTH-0, apps/api і apps/platform-api);
`cookie-parser` 1.4 + `@types/cookie-parser` (AUTH-2); `otplib` 13.5 (AUTH-4, apps/api —
API v13 звірити через context7); `qrcode` 1.5.4 + `@types/qrcode` (AUTH-4, apps/web).

**Storage**: PostgreSQL 17 з RLS — нові таблиці `auth_sessions`, `platform_auth_sessions`,
`verification_tokens`, `user_recovery_codes`, `mfa_challenges`; колонки `users.totp_*`; секція
`tenants.settings.security`. Valkey 8 — **лише** лічильники throttler-а (fail-open).

**Testing**: Jest e2e (`apps/api/test/*.e2e-spec.ts`, `apps/platform-api/test`) проти окремої
`saas_skeleton_test` і живої Valkey; фронтових тестів у репо немає → живий прогін у браузері
обов'язковий для кожного інкременту з UI.

**Target Platform**: Linux-контейнери в Docker Swarm за nginx (1 хоп); dev — macOS/OrbStack.
Тестовий прод по http без TLS (`COOKIE_SECURE=false`).

**Project Type**: web-service монорепо (2 API + worker + 2 SPA + спільні ліби).

**Performance Goals**: ротація refresh ≤ ~5 мс CPU (прибирається ~100 мс argon2); throttler —
+1 round-trip до Valkey на обмеженому роуті, стеля очікування 200 мс при недоступності;
звичайні автентифіковані запити без додаткових звернень до БД чи брокера (обидва нові
guard-и читають лише access-токен).

**Constraints**: без розлогінення наявних користувачів (FR-022); **вхід не залежить від
Valkey** ні в якому режимі (FR-004, FR-041); ліміти спільні для N реплік; одна точка перевірки
access-токена (`AccessTokenService`) для HTTP і сокета; нові політики (`requireMfa`) не
інвалідують живі токени, а діють із наступної видачі (≤ 15 хв; spec FR-046a).
Throttler — третій `APP_GUARD` після `JwtAuthGuard` і `RolesGuard`: анонімний шквал на захищені
роути отримує 401 до лічильника, тож загальна стеля його не рахує. Свідомий компроміс —
перевірка підпису JWT дешевша за звернення до Valkey, а без `req.user` неможливий ліміт на
користувача.

**Scale/Scope**: 49 FR, 5 інкрементів, 4 міграції, ~15 нових/змінених ендпоінтів, очікувано
+50…60 e2e (≈ +9 AUTH-0, +14 AUTH-1, +6 AUTH-2, +8 AUTH-3, +16 AUTH-4). Сесій — одиниці на
юзера, `mfa_challenges` — рядок на вхід із 2FA, прибирання cron-ом.

Невідомих («NEEDS CLARIFICATION») не лишилось — [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Принцип | Статус | Як дотримано / примітка |
| --- | --- | --- | --- |
| I | Мультитенантність невидима | ✅ з легальним винятком | Нові tenant-таблиці — DB-default `tenant_id` + RLS `ENABLE/FORCE` + `tenant_isolation`; транзакції лише `withTenantTx`. `tenantId` у коді `auth` (префікси refresh/verification/`mfaToken`, обчислення `mfaSetupRequired`) — легальний виняток плану §1.3. `RealtimeEmitter.disconnectUser/disconnectSession` бере тенант із CLS, тож `UsersService`/`AccountService` `tenantId` не бачать (D-12). `platform_auth_sessions` без RLS — як `platform_users` |
| II | Контракти — джерело правди | ✅ | Усі схеми в `libs/contracts`; `ApiErrorCode` += `TOO_MANY_REQUESTS`, `MFA_SETUP_REQUIRED`; `openapi:generate` + обидва codegen у тому ж наборі змін |
| III | Один асинхронний конвеєр | ✅ | Листи AUTH-3 — `defineEvent` + `MESSAGE_TOPOLOGY` + `@MessageSubscriber`; прибирання — наявна команда `auth.cleanup-expired-tokens` без перейменування черги |
| IV | Шари модуля | ✅ | `AuthSessionService`, `VerificationTokenService`, `MfaService`, `MfaChallengeService` + явні мапери; `tokenHash`, `totpSecretEncrypted`, `codeHash` відсутні в response-схемах за побудовою |
| V | Єдиний UI-стек | ✅ | Список сесій — `Item*`; діалоги — `AlertDialog`; форми — RHF-обгортки `libs/ui`; QR — `<img>` з data-URL, без кустарного компонента-обгортки |
| VI | Наскрізні помилки | ✅ | 429 і 403 `MFA_SETUP_REQUIRED` через `AllExceptionsFilter`; security-форми — `fieldErrors` (400, не 401); однакові 401 на refresh і `mfa/verify` |
| VII | i18n у споживача | ✅ | Сповіщення/активності — `type + payload`; листи — i18next воркера; 429 — `errors:tooManyRequests` |
| VIII | Без передчасних абстракцій | ✅ з рішенням | Throttler-storage у `libs/shared` лише з другим споживачем (AUTH-2, R-15). Прапорець `AUTH_REUSE_REVOKES_ALL_SESSIONS`, перехідне читання refresh із тіла і `argon2:`-гілка — виправдані в Complexity Tracking. Env лише для порогів, які піднімають e2e, параметрів середовища і секретів; таймаут Valkey, вікно reuse, строки токенів і стеля спроб — константи (D-15) |
| IX | Без soft delete за замовчуванням | ✅ | `revoked_at`/`consumed_at`/`used_at` — стани короткоживучих сутностей безпеки, а не приховування; фізичне видалення cron-ом |
| X | Сирий SQL — з обґрунтуванням | ✅ | Не потрібен: ротація, споживання токенів, лічильник спроб, `totp_last_used_step` — умовний `updateMany`. SQL у міграціях — DDL |
| XI | Рішення документуються | ✅ | Після кожного інкременту — табло і §8 `docs/auth-hardening-plan.md` (включно з D-1…D-9 нижче); по завершенні — `docs/account-settings.md` §6, `docs/roadmap.md` §2.5, `CLAUDE.md`, `docs/database-seed.md` |
| XII | Тести — умова готовності | ✅ | Нові сьюти `auth-sessions`, `auth-recovery`, `auth-mfa` + розширення `auth`, `account`, `users`, `rls`, `tenant-isolation`; fail-open — через storage, що кидає (R-17) |

**Gate (до Phase 0)**: PASS. **Re-check після Phase 1 (ревізія 2)**: PASS — нові рішення
(серверний guard, `mfa_challenges`, admin reset) не додали порушень; рядок Complexity Tracking
про клієнтський гейт знято, бо гейт тепер серверний.

### Відхилення від `docs/auth-hardening-plan.md`

| # | План | Цей дизайн | Джерело / чому |
| --- | --- | --- | --- |
| D-1 | Throttler у AUTH-0 лише в api | Ліміт логіну оператора — в AUTH-2 | R-15: у platform-api немає Valkey у стеку |
| D-2 | `REALTIME_REDIS` — аліас або видалення | Видалення; + окремий клієнт throttler-а | R-16, R-01: третій споживач `presence.store.ts`; fail-open потребує швидкої помилки без offline-черги |
| D-3 | `email-change/confirm` аутентифікований | Публічний, контекст із префікса токена | лист відкривають на іншому пристрої |
| D-4 | Нових активностей — лише 2FA | += `user.email_changed`, `user.mfa_reset` | свідомі дії над ідентичністю акаунта (план §1.5 допускає цей клас) |
| D-5 | `revoked_reason` включає `admin` | `user_disabled` / `password_change` / `password_reset` / `mfa_reset` | точніший розбір; `text`, не enum |
| D-6 | Одноразовість TOTP «запам'ятовується» | `users.totp_last_used_step` | R-18: без залежності від брокера |
| D-7 | `mfaToken` — JWT `typ:'mfa'` | Непрозорий `tenantId:challengeId:secret` + `mfa_challenges` | R-14, R-19, clarify Q2: лічильник спроб у БД; guard не прийме за побудовою |
| D-8 | Гейт `requireMfa` — редірект у фронті | Claim `mfaSetupRequired` + `MfaEnrollmentGuard` (403 `MFA_SETUP_REQUIRED`) | R-20, clarify Q4 |
| D-9 | Відновлення при втраті фактора — не описано | `POST /users/:id/mfa/reset` (ADMIN) | R-21, clarify Q5 |
| D-10 | Загальна стеля 120/хв «на IP» | На користувача; на IP — лише анонімні | analyze F1: за корпоративним NAT ліміт на IP віддавав би 429 цілій організації. Виправлено в коді AUTH-0 |
| D-11 | Сирий токен у payload події | `tokenEncrypted` (AES-256-GCM); `CryptoService` і `ENCRYPTION_KEY` — з AUTH-3, у api **і** worker | analyze E1: `pgboss.*` поза RLS, живе ~7 днів, екран Jobs показує `data` |
| D-12 | `disconnectUser(tenantId, userId)` | `disconnectUser(userId)` + `disconnectSession(sid)`, тенант із CLS; room `sessionRoom` | analyze C3/D1: одиночний revoke не рве чужі живі пристрої; `tenantId` не в доменних сервісах |
| D-13 | Сторінка підтвердження email під `/user-settings` | Публічна `/confirm-email` | analyze F6: лист відкривають на незалогіненому пристрої |
| D-14 | Журнал про завершення сесій — «з причиною» без переліку | `sessions_revoked` лише для `user`/`revoke_all`/`rotation_reuse`; наслідки інших дій — їхньою власною активністю; + `user.recovery_code_used` | analyze B1/E2, spec FR-021/FR-045 |
| D-15 | Env для TTL-ів, стелі спроб, вікна reuse, таймауту Valkey | Константи | analyze D2, конституція VIII |

Рішення «`password-reset/confirm` для юзера з 2FA → `mfa_required`» і «`mfa/disable` під
`requireMfa` → 403» тепер записані у spec (FR-033, FR-044).

## Project Structure

### Documentation (this feature)

```text
specs/001-auth-hardening/
├── plan.md                      # цей файл
├── research.md                  # Phase 0: R-01…R-23 + звірка плану з кодом
├── data-model.md                # Phase 1: таблиці, стани, міграції, закриті множини
├── quickstart.md                # Phase 1: сценарії валідації по інкрементах
├── contracts/
│   ├── http-api.md              # ендпоінти, AuthResponse union, cookie, 429, 403 MFA_SETUP_REQUIRED
│   └── events-and-config.md     # події, realtime, сповіщення, теги логів, env
├── checklists/requirements.md   # з /speckit-specify
└── tasks.md                     # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
libs/contracts/src/
├── error/error.schema.ts                 # += TOO_MANY_REQUESTS (0), MFA_SETUP_REQUIRED (4)
├── user/user.schema.ts                   # PasswordSchema min 12 (0); UserResponse.mfaEnabled (4)
├── auth/auth.schema.ts                   # refreshToken optional (2); PasswordReset* (3); AuthResponse union, MfaVerify (4)
├── account/account.schema.ts             # AuthSessionResponse (1); EmailChange* (3); Mfa* (4)
├── notification/notification.schema.ts   # auth.new_device, auth.session_reuse_detected (1); auth.mfa_*, recovery_code_used (4)
├── activity/activity.schema.ts           # sessions_revoked.reason (1); user.email_changed (3); user.mfa_* (4)
└── settings/                             # security section { requireMfa }             (4)

libs/database/prisma/
├── schema.prisma                         # AuthSession (1), PlatformAuthSession (2), VerificationToken (3), User.totp_*, UserRecoveryCode, MfaChallenge (4)
├── migrations/…_auth_sessions            # INSERT…SELECT + RLS + DROP refresh_tokens    (1)
├── migrations/…_platform_auth_sessions   # без RLS, REVOKE saas_app                     (2)
├── migrations/…_verification_tokens      # RLS                                          (3)
├── migrations/…_mfa                      # users.totp_*, user_recovery_codes, mfa_challenges + RLS (4)
└── seed.ts                               # паролі ≥ 12                                  (0)

libs/shared/src/
├── auth/user-agent.ts                    # parseUserAgent                               (1)
├── auth/throttler/                       # RedisThrottlerStorage (fail-open) + tracker — переїзд з api (2)
├── crypto/crypto.service.ts              # AES-256-GCM: токен у payload (3), секрет TOTP (4)
└── messaging/
    ├── definitions/auth.messages.ts      # 3 події                                      (3)
    └── topology.ts                       # += підписники                                (3)

apps/api/src/
├── main.ts, app.setup.ts                 # trust proxy, helmet, CORS (0); cookie-parser (2)
├── config/env.schema.ts                  # Zod env                                      (0…4)
├── redis/redis.module.ts                 # @Global REDIS_CLIENT + REDIS_THROTTLER_CLIENT (0)
├── common/throttler/                     # storage, AppThrottlerGuard, @RateLimit, throttle.config, throttler.setup (0) → libs/shared (2)
├── common/client-context.decorator.ts    # { ip, userAgent }                           (1)
├── auth/
│   ├── auth.service.ts, auth.controller.ts   # один INSERT, sid/jti (1); cookie (2); mfa_required, mfaSetupRequired claim (4)
│   ├── auth-session.service.ts           # create/rotate/verifyAndConsume/revoke*/list  (1)
│   ├── refresh-cookie.ts                 # set/clear/read                               (2)
│   ├── guards/origin.guard.ts            # Origin-check на refresh/logout              (2)
│   ├── guards/mfa-enrollment.guard.ts    # 403 MFA_SETUP_REQUIRED + @AllowDuringMfaSetup (4)
│   ├── verification-token.service.ts    # issue/consume                                (3)
│   ├── password-reset/                   # controller + service                         (3)
│   └── mfa/                              # mfa.service, mfa-challenge.service, mfa.controller (4)
├── account/                              # sessions list/delete (1); email-change (3)
├── users/                                # setPassword/setStatus → revokeAllForUser (1); mfa reset (4)
├── settings/                             # security section                             (4)
└── realtime/                             # REDIS_CLIENT (0); sessionRoom, disconnectSession/User з CLS (1); handshake MFA_SETUP_REQUIRED (4)

apps/api/test/
├── auth.e2e-spec.ts                      # throttler + fail-open, env (0); cookie (2)
├── auth-sessions.e2e-spec.ts             # (1)
├── auth-recovery.e2e-spec.ts             # (3)
├── auth-mfa.e2e-spec.ts                  # challenge, recovery, enforcement guard, admin reset (4)
└── setup-env.ts                          # пороги throttler-а, COOKIE_SECURE, ENCRYPTION_KEY

apps/worker/src/
├── subscribers/cleanup-expired-tokens.subscriber.ts   # auth_sessions (1), verification_tokens (3), mfa_challenges (4)
├── subscribers/{password-reset,email-change,email-changed-notice}-email.subscriber.ts (3)
└── locales/en/notifications.json         # шаблони листів                              (3)

apps/platform-api/src/
├── main.ts, app.module.ts, config/env.schema.ts       # trust proxy, helmet, CORS, env (0)
└── auth/                                 # сесії, refresh, cookie, throttler            (2)

apps/web/src/
├── api/http-client.ts                    # withCredentials (2); 403 MFA_SETUP_REQUIRED → майстер (4)
├── stores/auth.store.ts, init-auth.ts    # без localStorage                            (2)
├── pages/login.tsx                       # 429-тост (0); «Forgot password?» (3); крок MFA (4)
├── pages/reset-password*.tsx, confirm-email.tsx  # публічні роути верхнього рівня         (3)
├── pages/mfa-setup.tsx                   # примусовий майстер поза AppShell            (4)
├── pages/user-settings/security.tsx      # SessionsSection (1); 2FA-картка і майстер з QR (4)
├── pages/user-settings/account.tsx       # зміна email                                  (3)
├── pages/user-detail.tsx                 # «Reset 2FA»                                  (4)
├── pages/settings/security.tsx           # requireMfa                                   (4)
└── locales/en/user-settings.json, auth.json

apps/platform-web/src/
└── api/http-client.ts, stores/auth.store.ts           # refresh-цикл, без localStorage (2)

libs/ui/src/api/api-error.ts              # 429 → тост (0); MFA_SETUP_REQUIRED — не глобальна помилка (4)
libs/i18n/src/locales/en/{errors,notifications,activities}.json

docker/docker-compose.stack.yml, docker/deploy.env, .env.example   # нові env, broker-env для platform-api (0/2)
```

**Structure Decision**: наявна структура монорепо, без нових застосунків і лібів. Код сесій,
токенів і MFA — у `apps/api/src/auth/` (легальне місце для tenant-логіки); у `libs/shared` —
лише примітиви без tenant-знань (`user-agent`, `crypto`, throttler-storage з AUTH-2), бо ними
користуються два процеси. Адмінська дія скидання 2FA — у `users` поруч із `setPassword`/`setStatus`.

## Complexity Tracking

| Відхилення від принципу VIII | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Прапорець `AUTH_REUSE_REVOKES_ALL_SESSIONS` | Зафіксоване рішення плану §2.1: дефолт «вбити одну сесію», але середовище з вищими вимогами повертає глобальний revoke без релізу | Одна жорстка поведінка — або надто агресивна для людей у метро, або надто м'яка для комплаєнсу; дві гілки мінімальні |
| Перехідне читання refresh-токена з тіла | platform-web і старі вкладки tenant-web шлють токен у тілі між AUTH-2 і AUTH-4 | Жорсткий перехід розлогінює всіх на деплої; гілка має дату видалення (після AUTH-4, план §7) |
| Читання `argon2:`-хешів поруч із `sha256:` | Без розлогінення наявних сесій (FR-022) | Форсований релогін порушує FR-022; гілка вмирає сама через 7 днів |
| Окремий Redis-клієнт для throttler-а | Fail-open вимагає швидкої помилки, а спільний клієнт тримає offline-чергу, потрібну presence | Таймаут поверх спільного клієнта лишає команди висіти в черзі й виконуватись пізніше з неактуальними лічильниками |

## Відкрите

Блокуючих питань немає. Не блокує, але варто пам'ятати:
- **Deferred з clarify**: конкретні ліміти скидання пароля й зміни email (у контракті 3/год і
  5/год — значення дизайну, не з spec; константи).
- **Дзеркало сесій у platform-api** — чесна копія `AuthSessionService` без tenant-префікса, не
  спільне ядро в `libs/shared`: різні Prisma-моделі й формат токена, а третього споживача немає
  (конституція VIII). Рішення прийняте заздалегідь, щоб T085 не вирішувалось «на око».
- **Outstanding з clarify** (низький вплив): екран сесій оператора в control plane — поза скоупом.
- **Факт, виправлений при плануванні**: `qrcode` має транзитивні залежності (у браузерний
  бандл іде лише `dijkstrajs`); альтернатива з нулем залежностей — `qrcode-generator` (R-23).
