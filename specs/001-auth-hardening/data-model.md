# Data Model: Auth Hardening

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) · ревізія 3 (після `/speckit-analyze`)

Чотири міграції: AUTH-1 (`auth_sessions`), AUTH-2 (`platform_auth_sessions`), AUTH-3
(`verification_tokens`), AUTH-4 (`users.totp_*`, `user_recovery_codes`, `mfa_challenges`).
Кожна нова tenant-таблиця: `tenant_id TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')`,
композитний FK `(tenant_id, user_id) → users(tenant_id, id) ON DELETE CASCADE`,
`ENABLE` + `FORCE ROW LEVEL SECURITY` + політика `tenant_isolation` (шаблон — план §1.3).
Авточек `pg_policies` у `apps/api/test/rls.e2e-spec.ts` ловить забуту політику.

---

## 1. `AuthSession` → `auth_sessions` (AUTH-1, замінює `refresh_tokens`)

| Поле | Тип | Null | Правило |
| --- | --- | --- | --- |
| `id` | uuid (text) | ні | = `sid`; стабільний, переживає ротацію; середній сегмент refresh-токена |
| `tenant_id` | text | ні | DB-default із CLS; RLS |
| `user_id` | text | ні | FK композитний |
| `token_hash` | text | ні | `sha256:<hex>` або перенесений `argon2:<phc>` |
| `prev_token_hash` | text | так | попереднє покоління; діє вікно 60 с (константа) від `prev_rotated_at` |
| `prev_rotated_at` | timestamptz | так | момент останньої ротації |
| `generation` | int | ні, 0 | `++` на кожній ротації, крім гонки у вікні |
| `issued_at` | timestamptz | ні, now() | момент логіну |
| `last_used_at` | timestamptz | ні, now() | оновлюється ротацією |
| `idle_expires_at` | timestamptz | ні | `now + AUTH_SESSION_IDLE_DAYS`; посувається ротацією |
| `absolute_expires_at` | timestamptz | ні | `issued_at + AUTH_SESSION_ABSOLUTE_DAYS`; **не** посувається |
| `revoked_at` | timestamptz | так | ≠ null → сесія мертва |
| `revoked_reason` | text | так | закритий набір (нижче); у відповіді API не віддається |
| `user_agent` | text | так | сирий, обрізаний до 512 |
| `ip` | text | так | `req.ip` після `trust proxy` |
| `device_label` | text | так | `parseUserAgent(ua)`; ключ «нового пристрою» |

**Індекси**: `(tenant_id, user_id)`, `(tenant_id, idle_expires_at)`. Індекси під крос-тенантне
прибирання — лише якщо `EXPLAIN` покаже seq scan на реальних обсягах.

**`revoked_reason`** (TS-юніон у `libs/shared`, у БД — `text`, щоб нова причина не вимагала
міграції): `logout` · `rotation_reuse` · `secret_mismatch` · `revoke_all` · `password_change` ·
`password_reset` · `user_disabled` · `mfa_reset` · `user` (DELETE з UI).

**Стани**:

```text
            login (або mfa/verify)
              │
              ▼
  ┌────────► ACTIVE ──ротація (secret == token_hash)──► ACTIVE (generation+1)
  │           │  └─ prev у вікні ─────────────────────► ACTIVE (generation без змін)
  │           │
  │           ├─ prev поза вікном ──► REVOKED(rotation_reuse) + notify
  │           ├─ невідомий secret ──► REVOKED(secret_mismatch)
  │           ├─ logout/DELETE/revoke-all/password/reset/disable/mfa_reset ──► REVOKED(<reason>)
  │           ├─ now > idle_expires_at ─────► EXPIRED (обчислюваний стан, без запису)
  │           └─ now > absolute_expires_at ─► EXPIRED
  │
  └─ REVOKED / EXPIRED ── +30 днів ──► видалено cron-ом
```

Прибирання: `revoked_at < now() - 30d OR idle_expires_at < now() - 30d OR absolute_expires_at
< now() - 30d`. Умова на `idle_expires_at` обов'язкова: без неї сесія, що спливла від
бездіяльності, чекала б `absolute + 30d`, тобто до 60 днів (spec FR-017).

«Жива» = `revoked_at IS NULL AND idle_expires_at > now() AND absolute_expires_at > now()`.

**Міграція даних** (порядок критичний): `INSERT INTO auth_sessions … SELECT id, tenant_id,
user_id, 'argon2:' || token_hash, 0, created_at, created_at, expires_at, created_at + INTERVAL
'30 days' FROM refresh_tokens;` → потім RLS-блок → `DROP TABLE refresh_tokens;`.

---

## 2. `PlatformAuthSession` → `platform_auth_sessions` (AUTH-2)

Ті самі поля, що §1, **без** `tenant_id` і без RLS; FK `user_id → platform_users(id) ON DELETE
CASCADE`; `REVOKE ALL … FROM saas_app`. Перенесення даних не потрібне (refresh у platform не було).

---

## 3. `VerificationToken` → `verification_tokens` (AUTH-3)

| Поле | Тип | Null | Правило |
| --- | --- | --- | --- |
| `id` | uuid | ні | середній сегмент токена в лінку |
| `tenant_id` | text | ні | RLS; префікс токена |
| `user_id` | text | ні | FK композитний |
| `purpose` | enum `VerificationPurpose` | ні | `PASSWORD_RESET` · `EMAIL_CHANGE` · `INVITE` (без флоу) |
| `token_hash` | text | ні | `sha256:<hex>` |
| `payload` | jsonb | ні, `{}` | `EMAIL_CHANGE` → `{ newEmail }`; Zod-схема на purpose |
| `expires_at` | timestamptz | ні | `now + 60 хв` (константа) |
| `used_at` | timestamptz | так | ≠ null → використано |
| `created_at` | timestamptz | ні, now() | |
| `created_ip` | text | так | |

**Індекс**: `(tenant_id, user_id, purpose)`.
**Сирий токен** не зберігається ні тут, ні в черзі: у payload повідомлення він шифрується
`CryptoService` (див. `contracts/events-and-config.md` §1).
**Правила**: споживання — атомарний умовний `updateMany` (`used_at IS NULL AND expires_at > now()
AND purpose = $p`); видача нового токена тієї самої мети ставить `used_at` на попередні
незвикористані. **Стани**: `ISSUED → USED` | `EXPIRED` (обчислюваний) | `SUPERSEDED` (= USED).
Прибирання — cron, `expires_at < now() - 30d`.

---

## 4. `User` — нові колонки (AUTH-4)

| Поле | Тип | Null | Правило |
| --- | --- | --- | --- |
| `totp_secret_encrypted` | text | так | `v1:<iv>:<tag>:<ct>`; заповнюється на `setup`, до `confirm` 2FA НЕ ввімкнена |
| `totp_enabled_at` | timestamptz | так | ≠ null → 2FA увімкнена; мапиться у `UserResponse.mfaEnabled` |
| `totp_last_used_step` | bigint | так | R-18: код кроку `≤` значення відхиляється |

**Стани 2FA**:

```text
DISABLED ──setup──► PENDING ──confirm(code)──► ENABLED
   ▲                  │ setup (перезапис секрету)     │
   │                  ▼                               │
   └──── disable(password) ◄──────────────────────────┤
   └──── admin reset (FR-044a) ◄──────────────────────┘
```

`setup` у `ENABLED` → 409. `disable` і admin reset стирають секрет, крок, recovery-коди і
незавершені `mfa_challenges`; admin reset додатково — `revokeAllForUser(…, 'mfa_reset')`.

**Похідне в access-токені** (не колонка): `mfaSetupRequired = tenant.settings.security.requireMfa
&& totp_enabled_at IS NULL`, рахується при видачі (R-20).

## 5. `UserRecoveryCode` → `user_recovery_codes` (AUTH-4)

| Поле | Тип | Null | Правило |
| --- | --- | --- | --- |
| `id` | uuid | ні | |
| `tenant_id` | text | ні | RLS |
| `user_id` | text | ні | FK композитний |
| `code_hash` | text | ні | argon2 (низька ентропія) |
| `used_at` | timestamptz | так | одноразовість, атомарний умовний `updateMany` |
| `created_at` | timestamptz | ні, now() | |

Рівно 10 на юзера; перегенерація = `deleteMany` + 10 `create` в одній транзакції. Формат —
`xxxxx-xxxxx` (base32 без неоднозначних символів), нормалізація вводу до хешування.
Перевірка: argon2 проти кожного невикористаного хешу юзера (≤ 10 × ~100 мс у гіршому
випадку — прийнятно для рідкісної дії; під throttler-ом другого кроку).

## 6. `MfaChallenge` → `mfa_challenges` (AUTH-4, clarify Q2)

| Поле | Тип | Null | Правило |
| --- | --- | --- | --- |
| `id` | uuid | ні | середній сегмент `mfaToken` |
| `tenant_id` | text | ні | RLS; префікс `mfaToken` |
| `user_id` | text | ні | FK композитний |
| `token_hash` | text | ні | `sha256:<hex>` |
| `attempts` | int | ні, 0 | невдалі спроби; стеля 5 |
| `expires_at` | timestamptz | ні | `now + 300 с` (константа) |
| `consumed_at` | timestamptz | так | ≠ null → вхід завершено |
| `created_at` | timestamptz | ні, now() | |
| `ip` | text | так | з першого кроку |
| `user_agent` | text | так | з першого кроку |

**Індекс**: `(tenant_id, user_id)`.

**Стани**:

```text
PENDING ──правильний код/recovery──► CONSUMED  (+ одна нова auth_session, у тій самій транзакції)
   │
   ├─ невірний код ──► PENDING (attempts+1)
   ├─ attempts = 5 ──► LOCKED   (обчислюваний: attempts >= 5)
   ├─ now > expires_at ──► EXPIRED (обчислюваний)
   └─ admin reset / disable ──► видалено
```

«Живий» = `consumed_at IS NULL AND attempts < 5 AND expires_at > now()`. Будь-яка зміна —
умовний `updateMany` з цією умовою; `count === 0` → 401. Прибирання — cron,
`expires_at < now() - 1 day`.

## 7. `Tenant.settings` JSON — секція `security` (AUTH-4)

`{ security: { requireMfa: boolean } }`, дефолт `false`; Zod-схема в `libs/contracts/src/settings/`,
запис під `@Roles(ADMIN)`. Вмикання НЕ інвалідує наявні токени (FR-046); діє з наступної видачі
access-токена (≤ 15 хв) — саме так це й записано у spec FR-046a/SC-015.

---

## 8. Ефемерний стан у Valkey (не БД)

| Ключ | TTL | Фаза | Призначення | Відмова сховища |
| --- | --- | --- | --- | --- |
| `{prefix}:throttle:{name}:{tracker}` | вікно ліміту | AUTH-0 | лічильник throttler-а | fail-open + `warn` (R-01) |

Жодний інший стан auth у Valkey не живе: лічильник спроб 2FA — `mfa_challenges` (§6),
одноразовість TOTP — `users.totp_last_used_step` (§4).

---

## 9. Закриті множини в `libs/contracts`

- `ApiErrorCodeSchema` += `TOO_MANY_REQUESTS` (AUTH-0), `MFA_SETUP_REQUIRED` (AUTH-4).
- `NOTIFICATION_TYPE_META` += (категорія `security`, `muteable: false`):
  `auth.new_device` `{ deviceLabel, ip }`, `auth.session_reuse_detected` `{ deviceLabel }` (AUTH-1);
  `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_reset`, `auth.recovery_code_used`
  `{ remaining }` (AUTH-4).
- `ActivityType`: `user.sessions_revoked` payload += `reason?` — пишеться лише для `user`,
  `revoke_all`, `rotation_reuse` (AUTH-1, spec FR-021); скидання пароля пише наявну
  `user.password_changed` (AUTH-3); += `user.email_changed` `{ from, to }` (AUTH-3);
  += `user.mfa_enabled`, `user.mfa_disabled`, `user.mfa_reset`, `user.recovery_code_used`
  `{ remaining }` (AUTH-4).
- `UserResponseSchema` += `mfaEnabled: boolean` (AUTH-4).
- `AuthTokensSchema.refreshToken` → `.optional()` (AUTH-2); `AuthResponseSchema` →
  discriminated union за `status` (AUTH-4).
- Access-JWT payload += `sid`, `jti` (AUTH-1), `mfaSetupRequired?` (AUTH-4).
