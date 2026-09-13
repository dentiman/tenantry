# Events, Realtime & Config Contract: Auth Hardening

Ревізія 3 (після `/speckit-analyze`).

## 1. Асинхронні повідомлення (`libs/shared/src/messaging/`) — AUTH-3

Новий файл `definitions/auth.messages.ts`; рядки в `MESSAGE_TOPOLOGY`; підписники в
`apps/worker/src/subscribers/`. Публікація — `publish(tx, …)` у транзакції видачі токена.

| Подія | scope | Payload | Підписник (`id`) | Ефект |
| --- | --- | --- | --- | --- |
| `auth.password-reset-requested.v1` | tenant | `{ userId: uuid, tokenEncrypted: string }` | `password-reset-email` | лист із `${APP_PUBLIC_URL}/reset-password/confirm?token=…` |
| `auth.email-change-requested.v1` | tenant | `{ userId: uuid, tokenEncrypted: string, newEmail: email }` | `email-change-email` | лист підтвердження на `newEmail` з `${APP_PUBLIC_URL}/confirm-email?token=…` |
| `auth.email-changed.v1` | tenant | `{ userId: uuid, previousEmail: email }` | `email-changed-notice` | повідомлення на стару адресу |

- **Токен у payload — лише зашифрований** (`CryptoService`, AES-256-GCM, `v1:<iv>:<tag>:<ct>`;
  spec FR-031/FR-036). Причина: `pgboss.*` поза RLS, job-и живуть ~7 днів і лежать у DLQ, а
  екран Jobs у platform-web показує повний `data` — сирий токен дав би оператору платформи
  (і будь-кому з читанням pgboss) захоплення акаунта протягом 60 хв. API шифрує перед
  `publish`, воркер розшифровує лише в пам'яті перед рендером листа. Ретрай job-а
  розшифровує той самий шифротекст, тож обидва листи ведуть на одне посилання (US4 сц. 7).
- Мова й ім'я — з БД свіжими (патерн `WelcomeEmailSubscriber`).
- Лист — at-least-once, без claim-before-send.
- `auth.cleanup-expired-tokens` — наявна команда, ім'я черги не змінюється; тіло розширюється:
  `auth_sessions` (AUTH-1), `verification_tokens` (AUTH-3), `mfa_challenges` (AUTH-4).

## 2. Realtime (`apps/api/src/realtime/`)

| Точка | Контракт | Фаза |
| --- | --- | --- |
| `sessionRoom(tenantId, sid)` у `libs/contracts/src/realtime/` | поруч із `userRoom`; handshake додає сокет у room сесії з `sid` токена | 1 |
| `RealtimeEmitter.disconnectSession(sid)` | `namespace.to(sessionRoom).disconnectSockets(true)` — завершення ОДНІЄЇ сесії (`DELETE /account/sessions/:id`, `rotation_reuse`); інші пристрої й ініціатор не рвуться | 1 |
| `RealtimeEmitter.disconnectUser(userId)` | `namespace.to(userRoom).disconnectSockets(true)` — завершення ВСІХ сесій; після коміту і після видачі нової пари ініціатору | 1 |
| `auth.update.v1` (наявна) | звірка `sub`/`tenantId`/`role`; `sid` **не** звіряється, але при зміні `sid` сокет переходить зі старого `sessionRoom` у новий | 1 |
| Handshake (наявний) | той самий `AccessTokenService`; токен із `mfaSetupRequired: true` → відмова з кодом `MFA_SETUP_REQUIRED` | 4 |
| `auth.update.v1` з токеном, що несе `mfaSetupRequired: true` | відхиляється тим самим кодом, сокет рветься | 4 |

Тенант обидва методи емітера беруть із CLS (`TenantContextService`), а не з аргументу:
їх викликають доменні сервіси (`UsersService`, `AccountService`), де `tenantId` — запах
(конституція, принцип I). Публічні флоу з тенантом із префікса токена (`password-reset/confirm`)
уже працюють у `runWith`, тож CLS там є.

Нових socket-подій немає: сповіщення безпеки їдуть наявним каналом сповіщень.

## 3. Сповіщення (`NOTIFICATION_TYPE_META`, категорія `security`, `muteable: false`)

| Тип | Payload | Актор | Фаза | Тригер |
| --- | --- | --- | --- | --- |
| `auth.new_device` | `{ deviceLabel: string \| null, ip: string \| null }` | system | 1 | логін без живої сесії з таким `deviceLabel` |
| `auth.session_reuse_detected` | `{ deviceLabel: string \| null }` | system | 1 | reuse поза вікном |
| `auth.mfa_enabled` | `{}` | system | 4 | `mfa/confirm` |
| `auth.mfa_disabled` | `{}` | system | 4 | `mfa/disable` |
| `auth.mfa_reset` | `{}` | адмін | 4 | `POST /users/:id/mfa/reset` |
| `auth.recovery_code_used` | `{ remaining: number }` | system | 4 | вхід recovery-кодом |

Recorder відсіює «актор == отримувач», тому для подій, ініційованих самим юзером, актор —
`system` (подія безпеки має дійти, навіть якщо юзер зробив дію сам). Тексти —
`libs/i18n/src/locales/en/notifications.json`.

## 4. Технічний журнал (контракт тегів для алертів)

| `event` | Рівень | Поля | Фаза |
| --- | --- | --- | --- |
| `auth_login_failed` | warn | `requestId`, `email`, `ip`, `tenant` | 0 |
| `throttler_storage_unavailable` | warn | `requestId`, `throttler`, `error` | 0 |
| `auth_refresh_reuse_detected` | error | `requestId`, `tenantId`, `userId`, `sid`, `generation` | 1 |
| `auth_refresh_secret_mismatch` | warn | `requestId`, `tenantId`, `userId`, `sid` | 1 |
| `auth_mfa_challenge_locked` | warn | `requestId`, `tenantId`, `userId` | 4 |

## 5. Конфігурація (env)

Валідується Zod-схемою на старті (`apps/*/src/config/env.schema.ts`); невалідний env → процес
не стартує. Нові змінні — у `.env.example` і, де потрібно, `docker/deploy.env` та
`docker/docker-compose.stack.yml`.

| Змінна | Процес | Дефолт | Правило | Фаза |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | api | — | ≥ 32, ≠ значення `.env.example` | 0 |
| `PLATFORM_JWT_SECRET` | platform-api | — | те саме; без фолбеку на `JWT_SECRET` | 0 |
| `CORS_ALLOWED_ORIGINS` | api | фолбек `REALTIME_ALLOWED_ORIGINS` → `http://localhost:5173` | comma-separated URL | 0 |
| `PLATFORM_CORS_ALLOWED_ORIGINS` | platform-api | `http://localhost:5174` | comma-separated URL; окреме ім'я, бо обидва API читають один `.env` | 0 |
| `TRUST_PROXY_HOPS` | api, platform-api | `1` | int ≥ 0 | 0 |
| `AUTH_LOGIN_LIMIT_PER_MINUTE` | api (+platform з AUTH-2) | `5` | int; e2e піднімає (R-17) | 0 |
| `AUTH_LOGIN_IP_LIMIT_PER_MINUTE` | те саме | `20` | int | 0 |
| `THROTTLE_DEFAULT_LIMIT_PER_MINUTE` | api (+platform з AUTH-2) | `120` | int; на користувача, анонімні — на ip | 0 |
| `AUTH_REFRESH_LIMIT_PER_MINUTE` | те саме | `30` | int; на ip | 0 |
| `ACCOUNT_SENSITIVE_LIMIT_PER_HOUR` | api | `10` | int; на користувача | 0 |
| `AUTH_SESSION_IDLE_DAYS` | api, platform-api | `7` | int | 1 |
| `AUTH_SESSION_ABSOLUTE_DAYS` | api, platform-api | `30` | int ≥ idle | 1 |
| `AUTH_REUSE_REVOKES_ALL_SESSIONS` | api | `false` | bool | 1 |
| `COOKIE_SECURE` | api, platform-api | `true` | bool; `false` у `.env.example` і `deploy.env` (http) | 2 |
| `PLATFORM_JWT_ACCESS_EXPIRES_IN` | platform-api | `15m` (було `60m`) | | 2 |
| `REDIS_URL`, `REALTIME_KEY_PREFIX` | platform-api | як в api | додати `*realtime-broker-env` у стек | 2 |
| `APP_PUBLIC_URL` | worker | `http://localhost:5173` | URL без хвостового `/` | 3 |
| `ENCRYPTION_KEY` | api, worker | — | base64, рівно 32 байти після декодування; процес не стартує без валідного ключа | **3** (шифрування токена в payload), далі й секрет TOTP |

**Env чи константа.** Env отримують лише пороги, які e2e мусять піднімати (усі тести ходять з
одного IP, research R-17), параметри середовища і секрети. Решта — константи в коді, бо spec
фіксує значення, а тести прострочення моделюють зсувом дат у БД, а не коротким TTL:
стеля очікування Valkey (200 мс), вікно повторного пред'явлення секрету (60 с), строк одноразового посилання (60 хв), строк `mfaToken`
(300 с), стеля спроб коду (5), пороги скидання пароля і зміни email (3/год, 5/год).
