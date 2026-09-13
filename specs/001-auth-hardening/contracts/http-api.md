# HTTP API Contract: Auth Hardening

Ревізія 3 (після `/speckit-analyze`). Схеми — Zod у `libs/contracts` (джерело правди); тут —
форма і поведінка. Помилки — завжди envelope `ApiError`. `🔓` — `@Public()`, `🔒` — `JwtAuthGuard`,
`⏱` — throttler (ліміт у дужках), `🛡` — дозволено під час обов'язкового налаштування 2FA
(`@AllowDuringMfaSetup()`).

## Спільне

### 429 (AUTH-0)

```jsonc
{ "statusCode": 429, "code": "TOO_MANY_REQUESTS", "message": "Too many requests", "requestId": "…" }
```
Заголовок `Retry-After` (секунди). Фронт: тост `errors:tooManyRequests`.
**Недоступне сховище лічильників → ліміт не діє** (fail-open, лог `warn`
`event=throttler_storage_unavailable`); 429/503 з цієї причини не віддаються ніколи.

### 403 `MFA_SETUP_REQUIRED` (AUTH-4)

```jsonc
{ "statusCode": 403, "code": "MFA_SETUP_REQUIRED", "message": "Two-factor setup required", "requestId": "…" }
```
Будь-який 🔒-роут без `🛡`, якщо в access-токені `mfaSetupRequired: true`. Фронт: глобальний
обробник → редірект на майстер, без тосту. Той самий код відхиляє socket-handshake.

### Access JWT payload

```ts
{ sub, email, role, tenantId, sid, jti, mfaSetupRequired?: true }
// sid, jti — AUTH-1; mfaSetupRequired — AUTH-4, присутній лише коли true
```

### Refresh cookie (AUTH-2)

`Set-Cookie: saas_refresh=<tenantId:sid:secret>; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=<idle залишок>[; Secure]`
Очищення — той самий `Path`, `Max-Age=0`.

---

## `/auth` (tenant-api)

| Метод і шлях | Доступ | Тіло | Відповідь | Фаза |
| --- | --- | --- | --- | --- |
| `POST /auth/login` | 🔓 ⏱ (5/хв `email+ip`, 20/хв `ip`) | `LoginSchema` (без змін) | 200 `AuthResponse` (+ `Set-Cookie` при `ok`) | 0 / 1 / 2 / 4 |
| `POST /auth/refresh` | 🔓 ⏱ (30/хв `ip`) · Origin-check | порожнє; перехідно `{ refreshToken? }` | 200 `AuthTokens` + `Set-Cookie` | 0 / 1 / 2 |
| `POST /auth/logout` | 🔓 · Origin-check | порожнє; перехідно `{ refreshToken? }` | 204 + очищення cookie (завжди) | 1 / 2 |
| `POST /auth/password-reset` | 🔓 ⏱ (3/год `email+ip`, 20/год `ip`) | `{ email, tenant? }` | 204 завжди | 3 |
| `POST /auth/password-reset/confirm` | 🔓 ⏱ (10/хв `ip`) | `{ token, newPassword }` | 200 `AuthResponse` (`ok` + `Set-Cookie`; з AUTH-4 для юзера з 2FA — `mfa_required` без cookie); 400 `BAD_REQUEST` на недійсний/використаний/протухлий токен **і** на деактивованого юзера чи призупинений тенант (однакова відповідь, токен не споживається) | 3 |
| `POST /auth/mfa/verify` | 🔓 ⏱ (10/хв `ip`) | `{ mfaToken, code }` — 6 цифр або recovery-код | 200 `AuthResponse` (`status:'ok'`) + `Set-Cookie`; 400 `fieldErrors.code` на невірний код (спробу враховано); 401 на мертвий `mfaToken` (протух / 5 спроб / використаний) | 4 |
| `GET /auth/me` | 🔒 🛡 | — | без змін | — |

### `AuthResponse`

До AUTH-4: `{ user, tokens }`. Після AUTH-4:

```ts
| { status: 'ok'; user: UserResponse; tokens: { accessToken: string; refreshToken?: string } }
| { status: 'mfa_required'; mfaToken: string; mfaExpiresAt: string /* ISO */ }
```

- `mfaToken` — непрозорий рядок `tenantId:challengeId:secret` (не JWT; `JwtAuthGuard` його не
  прийме за побудовою). Не зберігається фронтом між перезавантаженнями (стан форми `/login`).
- Юзер без 2FA в організації з `requireMfa` отримує `status: 'ok'` і токен із
  `mfaSetupRequired: true` → далі 403 `MFA_SETUP_REQUIRED` на все, крім 🛡.
- `password-reset/confirm` для юзера з увімкненою 2FA віддає `status: 'mfa_required'`: скидання
  пароля доводить володіння поштою, але не другим фактором.

### `POST /auth/refresh` — порядок перевірок (AUTH-1)

1. Джерело токена: cookie → тіло. Немає → 401.
2. `tenantId:sid:secret`; невірний формат → 401.
3. Сесія не знайдена / `revoked` / idle або absolute прострочені → 401.
4. Префікс ≠ `session.tenantId` → 401.
5. `secret ~ token_hash` → ротація, 200.
6. `secret ~ prev_token_hash`: у вікні → 200 без `generation++`; поза вікном → revoke
   `rotation_reuse` + `auth.session_reuse_detected` → 401.
7. Інакше → revoke `secret_mismatch` → 401.
8. `user.isActive && tenant.isActive`, інакше 401.
9. (AUTH-4) Новий access-токен отримує `mfaSetupRequired` за поточною політикою.

Усі 401 однакові (`UNAUTHORIZED`), причина — лише в лозі.

---

## `/account` (tenant-api, 🔒)

| Метод і шлях | Доступ | Тіло | Відповідь | Фаза |
| --- | --- | --- | --- | --- |
| `GET /account` | 🛡 | — | без змін | — |
| `POST /account/password` | ⏱ (10/год user) | без змін | 200 `AuthTokens` + `Set-Cookie` | 0 / 1 / 2 |
| `GET /account/sessions` | — | — | 200 `AuthSessionResponse[]` | 1 |
| `DELETE /account/sessions/:id` | — | — | 204; чужа/неіснуюча/мертва → 404; після коміту `disconnectSession(sid)` і активність `user.sessions_revoked { reason: 'user', count: 1 }` | 1 |
| `POST /account/sessions/revoke-all` | ⏱ (10/год user) | — | 200 `AuthTokens` + `Set-Cookie` | 0 / 1 / 2 |
| `POST /account/email-change` | ⏱ (5/год user) | `{ newEmail, currentPassword }` | 204; невірний пароль → 400 `fieldErrors.currentPassword`; зайнято → 409 `fieldErrors.newEmail` | 3 |
| `POST /account/email-change/confirm` | 🔓 ⏱ (10/хв `ip`) | `{ token }` | 200 `AccountResponse`; зайнято на момент підтвердження → 409 `fieldErrors.email`; недійсний токен → 400 | 3 |
| `GET /account/mfa` | 🛡 | — | 200 `{ enabled: boolean; enabledAt: string \| null; recoveryCodesRemaining: number }` | 4 |
| `POST /account/mfa/setup` | 🛡 ⏱ (10/год user) | — | 200 `{ secret: string; otpauthUrl: string }`; уже ввімкнено → 409 | 4 |
| `POST /account/mfa/confirm` | 🛡 ⏱ (10/хв user) | `{ code }` | 200 `{ recoveryCodes: string[]; tokens: AuthTokens }` + `Set-Cookie`; невірний код → 400 `fieldErrors.code` | 4 |
| `POST /account/mfa/disable` | ⏱ (10/год user) | `{ currentPassword }` | 204; невірний пароль → 400 `fieldErrors.currentPassword`; при `requireMfa` організації → 403 `FORBIDDEN` | 4 |
| `POST /account/mfa/recovery-codes` | ⏱ (10/год user) | `{ currentPassword }` | 200 `{ recoveryCodes: string[] }` | 4 |

- `mfa/confirm` повертає **свіжу пару**: старий access-токен ніс `mfaSetupRequired: true`, новий —
  ні, тож доступ відкривається без повторного входу (FR-046a). Recovery-коди видно лише тут.
- `mfa/disable` при обов'язковій 2FA заборонено: інакше користувач обходив би політику
  власноруч (скидання — лише адміном, `/users/:id/mfa/reset`).
- `email-change/confirm` — публічний: лист відкривають на іншому пристрої; доказ — токен,
  контекст тенанта — з префікса. Фронтова сторінка теж публічна і верхнього рівня —
  `/confirm-email?token=…`, а не під `/user-settings` (там гейт авторизації викинув би на `/login`).
- `POST /account/sessions/revoke-all` пише `user.sessions_revoked { reason: 'revoke_all' }`;
  зміна пароля, скидання, деактивація і скидання 2FA окремої `sessions_revoked` не пишуть —
  у них власна активність (spec FR-021).

### `AuthSessionResponse`

```ts
{
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;          // id === JWT.sid
  createdAt: string;           // ISO, = issued_at
  lastUsedAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}
```
Порядок: поточна першою, далі `lastUsedAt DESC`. Лише живі. `tokenHash`, `prevTokenHash`,
`revokedAt`, `revokedReason` — не існують у схемі.

---

## `/users` (tenant-api, 🔒 `@Roles(ADMIN)`) — AUTH-4

| Метод і шлях | Відповідь |
| --- | --- |
| `POST /users/:id/mfa/reset` | 204; `:id` = власний → 403 `FORBIDDEN`; чужий тенант/немає → 404; 2FA не ввімкнена → 204 без побічних ефектів |

Ефекти (одна транзакція): стерти секрет/крок/recovery-коди/незавершені `mfa_challenges` →
`revokeAllForUser(id, 'mfa_reset')` → активність `user.mfa_reset` → сповіщення `auth.mfa_reset`;
після коміту — `disconnectUser`. `UserResponse` += `mfaEnabled: boolean`.

---

## `/settings` (tenant-api, 🔒, запис `@Roles(ADMIN)`) — AUTH-4

| Метод і шлях | Доступ | Відповідь |
| --- | --- | --- |
| `GET /settings/security` | — | 200 `{ requireMfa: boolean }` |
| `PUT /settings/security` | ADMIN | `{ requireMfa: boolean }` → 200; секція-документ, як `general` |
| `GET /settings/bootstrap` | 🛡 | += `security.requireMfa` |

---

## `/auth` (platform-api) — AUTH-2 дзеркало

| Метод і шлях | Доступ | Відповідь |
| --- | --- | --- |
| `POST /auth/login` | 🔓 ⏱ (5/хв `email+ip`, 20/хв `ip`; fail-open) | 200 `PlatformAuthResponse` (access 15 хв) + `Set-Cookie saas_platform_refresh` |
| `POST /auth/refresh` | 🔓 ⏱ (30/хв `ip`) · Origin-check | 200 + ротація cookie |
| `POST /auth/logout` | 🔓 · Origin-check | 204 + очищення |

Окреме ім'я cookie — у dev обидва фронти на `localhost`, порт cookie не розділяє. Токени
планів крос-невалідні. Екран сесій операторів — поза скоупом (FR-030 вимагає модель і
захищене зберігання, не UI).

---

## Регенерація

Після кожної фази з контрактними змінами: `pnpm openapi:generate && pnpm web:codegen`
(+ `pnpm platform:web:codegen` для AUTH-2). Обидва артефакти комітяться.
