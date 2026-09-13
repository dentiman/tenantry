# Research: Auth Hardening (AUTH-0 … AUTH-4)

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-13 (ревізія 2 — після `/speckit-clarify`)

Первинне джерело рішень — `docs/auth-hardening-plan.md` (аудит коду 2026-09-12). Цей файл
фіксує рішення у форматі Decision / Rationale / Alternatives, додає те, що виявила звірка плану
з кодом (R-15…R-18), і рішення з сесії уточнень 2026-09-13 (R-19…R-23).

**Ревізія 3 (`/speckit-analyze`) змінила**: R-11 (розрив на рівні сесії); див. також plan D-10…D-15.
**Ревізія 2 змінила**: R-01 (fail-open), R-14 (`mfaToken` непрозорий, не JWT), R-19
(лічильник спроб у БД замість Valkey); додано R-20…R-23.

## Звірка плану з кодом (2026-09-13)

| Твердження плану | Факт у коді | Висновок |
| --- | --- | --- |
| `app.enableCors()` без опцій | `apps/api/src/main.ts:17`, `apps/platform-api/src/main.ts:16` | підтверджено |
| `REALTIME_REDIS` створюється в `RealtimeModule` | провайдер `realtime-redis.provider.ts`; споживачі `app.setup.ts`, `realtime.module.ts`, `presence/presence.store.ts` | підтверджено; `presence.store.ts` — третій споживач, план його не згадує |
| `PasswordSchema` min 8 | `libs/contracts/src/user/user.schema.ts:51` | підтверджено |
| Коду `TOO_MANY_REQUESTS` немає | `ApiErrorCodeSchema` — 8 кодів | підтверджено |
| `AuthTokens.refreshToken` обов'язковий | `libs/contracts/src/auth/auth.schema.ts` | підтверджено |
| Категорія сповіщень `security` існує | є, разом із `user.password_changed` | нову категорію не заводимо |
| platform-api: access 60m без refresh | `platform-auth.module.ts:18` | підтверджено |
| Нові пакети не встановлені | `apps/api/package.json` — лише `ioredis` | підтверджено; актуальні версії: `@nestjs/throttler` 6.5, `helmet` 8.3, `cookie-parser` 1.4, `otplib` 13.5, `qrcode` 1.5.4 |
| platform-api має доступ до Valkey | stack дає platform-api лише `*db-env` | **НЕ має** → R-15 |
| `Tenant.settings Json` існує | `schema.prisma:28` | підтверджено |
| QR-генератора в репо немає | жодного `qr*` у `package.json` застосунків і лібів | підтверджено → R-23 |

---

## R-01. Обмеження частоти: алгоритм, ключ, сховище, відмова

- **Decision**: `@nestjs/throttler` з власним `ThrottlerStorage` на наявному `ioredis`
  (`INCR` + `PEXPIRE` в одному `multi`, fixed window). Ключ логіну — `(normalizedEmail, ip)`
  + окремий ліміт на `ip`. Лічильники — у Valkey під `REALTIME_KEY_PREFIX`.
  **Відмова сховища → fail-open** (clarify Q3): storage ловить помилку клієнта, повертає
  запис «не заблоковано» і пише `warn` зі стабільним тегом `event: 'throttler_storage_unavailable'`
  (+ `requestId`, ім'я ліміту). Таймаут команди — короткий (`commandTimeout` ~200 мс на
  окремому з'єднанні або `Promise.race`), щоб недоступний брокер не підвішував логін.
- **Rationale**: in-memory ліміт множиться на N реплік. Ліміт — додатковий контроль: пароль
  argon2, лічильник 2FA у БД; простій входу гірший за годину без лімітів.
- **Alternatives**: `nestjs-throttler-storage-redis` (залежність заради ~50 рядків); sliding
  window log; fail-closed (вхід падає разом із брокером — відхилено в clarify); in-memory
  фолбек (поріг × N, відхилено в clarify); permanent lockout (NIST 800-63B).
- **Нюанс ioredis**: за замовчуванням `enableOfflineQueue: true` — команди при розриві
  стоять у черзі, а не падають. Для throttler-а потрібна швидка помилка: або окремий
  клієнт з `enableOfflineQueue: false`, або таймаут на рівні storage. Спільний клієнт
  presence чіпати не можна — там черга офлайн-команд бажана.

## R-02. Email для ключа до валідації тіла

- **Decision**: кастомний `ThrottlerGuard.getTracker()` читає `req.body.email`, приводить до
  рядка, `trim().toLowerCase()`, обрізає до 254; не рядок → лише `ip`.
- **Rationale**: guard іде після body-parser, але до Zod-пайпа — тіло недовірене.

## R-03. Справжня адреса клієнта

- **Decision**: `NestFactory.create<NestExpressApplication>` + `app.set('trust proxy', TRUST_PROXY_HOPS)`
  (дефолт `1`) в обох API.
- **Alternatives**: `true` (клієнт підробляє `X-Forwarded-For`).

## R-04. CORS + helmet + env fail-fast

- **Decision**: одне джерело allowlist `CORS_ALLOWED_ORIGINS` з фолбеком на
  `REALTIME_ALLOWED_ORIGINS`, спільне для `enableCors({ origin, credentials: true })` і
  Socket.IO; `helmet()` з дефолтами (перевірити `/api/docs`); Zod env через
  `ConfigModule.forRoot({ validate })`: `JWT_SECRET` ≥ 32 і ≠ значенню `.env.example`;
  `PLATFORM_JWT_SECRET` — те саме, без фолбеку.
- **Примітка**: комітнутий тестовий секрет у `docker/deploy.env` мусить пройти правило ≥ 32.

## R-05. Політика пароля

- **Decision**: `PasswordSchema` → `min(12).max(128)`; сід, `test-users.ts`,
  `docs/database-seed.md`, `CLAUDE.md` — на паролі ≥ 12.
- **Alternatives**: HIBP (мережа в критичному шляху), словник (~100 МБ), композиційні правила.

## R-06. Модель сесії

- **Decision**: одна таблиця `auth_sessions`, рядок = пристрій; формат refresh-токена
  лишається `tenantId:sessionId:secret`.
- **Alternatives**: таблиця поколінь (~670 рядків на пристрій на тиждень); еволюція
  `refresh_tokens` через `ALTER`.

## R-07. Хешування секрету сесії і перенесення без розлогінення

- **Decision**: self-describing `sha256:<hex>` / `argon2:<phc>`; міграція переносить з
  `argon2:`, перша ротація переписує на `sha256:`; порівняння — `timingSafeEqual`.

## R-08. Reuse detection

- **Decision**: вікно 60 с; у вікні — нова пара без `generation++`; поза вікном —
  `revoke(sid, 'rotation_reuse')` + сповіщення + лог `error`; невідомий секрет —
  `revoke(sid, 'secret_mismatch')`; прапорець `AUTH_REUSE_REVOKES_ALL_SESSIONS=false`.
  Ротація — умовний `updateMany … WHERE id = $sid AND token_hash = $old`, щоб дві паралельні
  ротації не видали дві «головні» пари.
- **Alternatives**: вікно 0; `deleteMany` по юзеру.

## R-09. Двовимірний TTL

- **Decision**: idle 7 днів (посувається), absolute 30 днів (не посувається); прибирання —
  наявна команда `auth.cleanup-expired-tokens` без перейменування черги.

## R-10. Ідентифікація пристрою

- **Decision**: власний `parseUserAgent` у `libs/shared/src/auth/user-agent.ts`; «новий» = немає
  живої сесії з тим самим `deviceLabel`.
- **Alternatives**: `ua-parser-js` v2 (AGPL/комерційна), fingerprint, GeoIP.

## R-11. Миттєвий розрив WS при revoke

- **Decision** (ревізія 3, після `/speckit-analyze`): два методи емітера — `disconnectSession(sid)`
  для завершення однієї сесії (room `sessionRoom(tenantId, sid)`, у який сокет потрапляє на
  handshake) і `disconnectUser(userId)` для завершення всіх; обидва після коміту, `disconnectUser`
  — ще й після видачі нової пари ініціатору. Тенант — із CLS, не з аргументу (виклики живуть у
  доменних сервісах). `sid` в `auth.update.v1` не звіряється, але при його зміні сокет
  переходить у room нової сесії.
- **Відкинуто**: лише `disconnectUser` на кожен revoke — завершення однієї чужої сесії рвало б і
  всі живі пристрої юзера, включно з ініціатором (spec FR-019).

## R-12. Refresh у httpOnly cookie

- **Decision**: `saas_refresh`, `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` за
  `COOKIE_SECURE`; `cookie-parser` у `main.ts` і `configureApp`; Origin-check на refresh/logout;
  перехідне читання з тіла.
- **Нюанс Path**: перевірити в конфігу nginx web-контейнера, що браузер бачить саме `/api/auth`.
- **Нюанс dev**: обидва фронти на `localhost` → cookie за хостом не розділяються портом →
  platform використовує окреме ім'я `saas_platform_refresh`.

## R-13. Одноразові посилання

- **Decision**: `verification_tokens` з `purpose` (`PASSWORD_RESET`, `EMAIL_CHANGE`, `INVITE`),
  sha256, TTL 60 хв, атомарне споживання умовним `updateMany`, токен у лінку
  `tenantId:tokenId:secret`, перевидача інвалідує попередні незвикористані; лист — подія через
  `MESSAGE_TOPOLOGY`; для неіснуючого email подія не публікується.
- **Нюанс**: сирий токен у payload job-а живе в `pgboss.job` до ретеншну (~7 днів) — довше за
  TTL; прийнятно (мертвий після 60 хв, `pgboss.*` доступний лише платформній ролі).

## R-14. TOTP 2FA

- **Decision**: `otplib` (MIT; актуальна major — 13, API функціональний і відрізняється від
  v12 — звірити документацію через context7 на старті AUTH-4), RFC 6238, крок 30 с, вікно ±1;
  секрет — AES-256-GCM (`ENCRYPTION_KEY`, `v1:<iv>:<tag>:<ct>`, `CryptoService` у
  `libs/shared/src/crypto/`); 10 recovery-кодів на argon2; логін → discriminated union
  `status: 'ok' | 'mfa_required'`; сесія створюється лише на кроці 2; політика
  `Tenant.settings.security.requireMfa`.
- **Зміна ревізії 2 — `mfaToken` непрозорий, а не JWT**: `tenantId:challengeId:secret`,
  sha256-хеш у `mfa_challenges` (R-19). Рядок не є JWT, тож `JwtAuthGuard` не прийме його
  **за побудовою**, а не завдяки перевірці `typ`; контекст тенанта — з префікса (як refresh);
  анулювання після 5 спроб — стан рядка.
- **Alternatives**: JWT `typ: 'mfa'` (план; потребує стану для лічильника все одно — див. R-19);
  passkeys (RP ID вимагає домену); SMS.
- **Запасний план контракту**: якщо orval погано згенерує union — два response-типи і 200/202.

---

## Рішення, яких немає в плані

## R-15. Throttling у platform-api

- **Decision**: у AUTH-0 platform-api отримує `trust proxy`, CORS, `helmet`, env fail-fast, але
  не throttler (немає Valkey у стеку). Ліміт логіну оператора — у AUTH-2 разом із дзеркалом
  сесій: platform-api отримує `*realtime-broker-env`, а storage + guard переїжджають у
  `libs/shared/src/auth/throttler/` (другий споживач). Fail-open (R-01) діє і там.
- **Наслідок для spec**: FR-001 для control plane закривається в AUTH-2.

## R-16. Спільний Redis-клієнт

- **Decision**: `@Global() RedisModule` з `REDIS_CLIENT`; `REALTIME_REDIS` видаляється з усіма
  вживаннями (включно з `presence.store.ts`); `quit()` переїжджає в `RedisModule`. Для
  throttler-а — окремий клієнт із `enableOfflineQueue: false` (R-01), провайдер
  `REDIS_THROTTLER_CLIENT` у тому ж модулі.

## R-17. Ізоляція throttler-ключів у e2e

- **Decision**: ключі під `REALTIME_KEY_PREFIX` jest-worker-а; сьюти, що б'ють ліміт, чистять
  свої ключі в `afterEach`; `setup-env.ts` піднімає пороги логіну env-змінними, а
  `auth.e2e-spec.ts` задає бойові значення явно. Fail-open тестується storage-ом, що кидає
  (`overrideProvider`), а не зупинкою Valkey.

## R-18. Одноразовість TOTP-коду між репліками

- **Decision**: `users.totp_last_used_step BIGINT NULL` + умовний
  `updateMany … WHERE totp_last_used_step IS NULL OR totp_last_used_step < $step`.
- **Rationale**: без залежності auth від брокера; атомарно; переживає рестарт. `@updatedAt`
  посунеться — прийнятно, фіксується в доці.

## R-19. Лічильник спроб другого кроку — таблиця `mfa_challenges` (clarify Q2)

- **Decision**: окремий рядок на кожну спробу входу з 2FA: `id`, `tenant_id`, `user_id`,
  `token_hash`, `attempts`, `expires_at` (+5 хв), `consumed_at`, `created_ip`, `user_agent`.
  Невдала спроба — `updateMany … SET attempts = attempts + 1 WHERE id = $id AND consumed_at IS
  NULL AND attempts < 5 AND expires_at > now()`; `count === 0` → 401 (мертвий). Успіх —
  `SET consumed_at = now()` тією самою умовою в транзакції створення сесії.
  `user_agent`/`ip` з першого кроку порівнюються з другим лише для `deviceLabel` сесії
  (не як захист — легітимна зміна мережі між кроками можлива).
- **Rationale**: вхід не залежить від брокера; лічильник атомарний між репліками; стан живе
  рівно стільки, скільки потрібен. Прибирання — той самий cron (`expires_at < now() - 1д`).
- **Alternatives**: Valkey fail-closed (вхід падає з брокером — відхилено в clarify);
  Valkey fail-open (перебір 10⁶ — відхилено); `verification_tokens` з новим `purpose`
  (там немає лічильника спроб і семантика «посилання в листі» інша).
- **Обсяг**: рядок на кожен вхід користувача з 2FA; вхід — раз на 30 днів на пристрій
  (absolute TTL) → мізерно.

## R-20. Серверне обмеження при обов'язковій 2FA (clarify Q4)

- **Decision**: claim `mfaSetupRequired: true` в access-токені, обчислений при видачі (login,
  refresh, `mfa/verify`) як `tenant.settings.security.requireMfa && user.totp_enabled_at IS NULL`.
  Глобальний `MfaEnrollmentGuard` (третій `APP_GUARD` після `JwtAuthGuard` і `RolesGuard`)
  відхиляє запит з цим claim-ом кодом **403 `MFA_SETUP_REQUIRED`**, якщо хендлер не має
  `@AllowDuringMfaSetup()`. Дозволені: `GET /auth/me`, `GET /account`, `GET /settings/bootstrap`,
  `GET /account/mfa`, `POST /account/mfa/setup`, `POST /account/mfa/confirm`; `@Public()`
  роути (refresh, logout) guard не чіпає. Socket-handshake відхиляє такий токен тим самим
  кодом. `POST /account/mfa/confirm` повертає свіжу пару токенів без claim-а → доступ
  відкривається без повторного входу.
- **Rationale**: перевірка лишається stateless (без запиту в БД на кожен HTTP-запит — та сама
  властивість, що зараз); політика застосовується до вже активних сесій не пізніше
  наступного refresh, тобто ≤ 15 хв (строк access-токена) — узгоджується з FR-046a
  («діє також для активних сесій»), межа документується поруч із «до 15 хвилин» для revoke.
  Opt-in-декоратор дозволеного переліку (а не deny-list) — новий ендпоінт закритий за
  замовчуванням.
- **Alternatives**: запит `tenant.settings` + `user` на кожен запит (+2 читання на кожен HTTP);
  кеш у Valkey (залежність auth від брокера); тільки фронт-гейт (відхилено в clarify).
- **Нюанс**: вмикання політики адміном НЕ інвалідує токени — інакше «зміна політики не
  розлогінює нікого миттєво» (FR-046) порушилась би.

## R-21. Скидання 2FA адміністратором (clarify Q5)

- **Decision**: `POST /users/:id/mfa/reset` під `@Roles(ADMIN)` у модулі `users`
  (адмінська дія над іншим юзером — там живуть `setPassword`/`setStatus`). У `withTenantTx`:
  стерти `totp_secret_encrypted`, `totp_enabled_at`, `totp_last_used_step`, `user_recovery_codes`,
  незавершені `mfa_challenges`; `revokeAllForUser(id, 'mfa_reset')`; активність
  `user.mfa_reset` (актор — адмін); сповіщення `auth.mfa_reset` (актор — адмін, отримувач —
  юзер, recorder пропускає); після коміту — `disconnectUser`. `:id === sub` → 403 `FORBIDDEN`
  (для себе — `POST /account/mfa/disable`); 2FA не ввімкнена → 204 без побічних ефектів.
- **UI**: `UserResponse += mfaEnabled: boolean` (довговічний факт, як `lastSeenAt`), кнопка
  «Reset 2FA» з `AlertDialog` на картці `/workspace/users/$userId`.
- **Alternatives**: email-самообслуговування (зводить 2FA до пароля+пошти); оператор платформи
  (поза скоупом).

## R-22. Нові коди помилок

- **Decision**: `ApiErrorCodeSchema` += `TOO_MANY_REQUESTS` (429, AUTH-0) і `MFA_SETUP_REQUIRED`
  (403, AUTH-4). Окремий код, а не `FORBIDDEN`: фронт мусить відрізнити «нема прав» (тост) від
  «налаштуй 2FA» (редірект на майстер) без розбору `message`.

## R-23. QR-код (clarify Q1)

- **Decision**: `qrcode` 1.5.4 (MIT) у `apps/web`, `QRCode.toDataURL(otpauthUrl)` → `<img>`
  (без `dangerouslySetInnerHTML`); під ним секрет текстом із кнопкою копіювання.
- **Факт, виправлений під час планування**: у питанні clarify стверджувалось «без runtime-залежностей».
  Насправді `qrcode` має `dijkstrajs`, `pngjs`, `yargs`; поле `browser` підміняє Node-вхід на
  `lib/browser.js`, тож у Vite-бандл потрапляє лише `dijkstrajs` (`pngjs` — Node-рендер PNG,
  `yargs` — CLI). Перевірити розміром бандла після `pnpm build`.
- **Alternative з нульовими залежностями**: `qrcode-generator` 2.0.4 (MIT, 0 deps), API
  нижчого рівня (матриця модулів → SVG руками, ~15 рядків). Якщо транзитивні залежності
  неприйнятні — заміна не зачіпає контрактів, лише один компонент.
- **Rationale вибору**: рішення користувача в clarify; QR генерується в браузері, секрет не йде
  через додатковий ендпоінт чи сторонній сервіс.
