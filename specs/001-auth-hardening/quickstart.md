# Quickstart: валідація Auth Hardening

Сценарії, що доводять кожен інкремент end-to-end. Контракти — [contracts/http-api.md](./contracts/http-api.md),
модель — [data-model.md](./data-model.md). Код тут не наводиться.

## Передумови (для всіх фаз)

```bash
pnpm docker:up                                   # Postgres, Valkey, Mailpit, SeaweedFS
pnpm db:reset                                    # чисті міграції + сід (паролі ≥ 12 з AUTH-0)
pnpm api:dev & pnpm worker:dev & pnpm web:dev    # tenant
pnpm platform:dev & pnpm platform:web:dev        # control plane (AUTH-0 env, AUTH-2)
```

Автоматична перевірка кожної фази (dev-стек ЗУПИНИТИ перед e2e — `max_connections`):

```bash
pnpm lint && pnpm typecheck && pnpm build
pnpm openapi:generate && pnpm web:codegen && pnpm platform:web:codegen   # якщо чіпали контракти
pkill -f 'api|worker'; pnpm api:test:e2e && pnpm platform:test:e2e
```

---

## AUTH-0 — захист периметра (US1)

| # | Дія | Очікування |
| --- | --- | --- |
| 0.1 | 6 разів `POST /api/auth/login` з невірним паролем на один email | 1–5 → 401, 6-й → 429 `TOO_MANY_REQUESTS` із `requestId` і `Retry-After` |
| 0.2 | Одразу логін іншим email з тієї ж машини | 200 |
| 0.3 | Через 60 с повторити 0.1-й email з правильним паролем | 200 |
| 0.4 | У формі `/login` 6 невдалих спроб | тост «забагато спроб», а не «невірний пароль» |
| 0.5 | `curl -H 'Origin: https://evil.example' -i …/api/auth/me` | немає `Access-Control-Allow-Origin` |
| 0.6 | `curl -i …/api/health` | заголовки helmet (`X-Content-Type-Options`), немає `X-Powered-By`; `/api/docs` відкривається |
| 0.7 | `JWT_SECRET=short pnpm api:dev` | процес падає на старті з помилкою env; те саме з літеральним значенням `.env.example` і з `PLATFORM_JWT_SECRET` |
| 0.8 | Запит із `X-Forwarded-For: 203.0.113.7` через vite-проксі / nginx | у pino-лозі `ip` клієнта, не проксі |
| 0.9 | Створити юзера з паролем з 11 символів | 400 `fieldErrors.password` |
| 0.9a | Двоє залогінених юзерів з однієї машини (імітація NAT), один гортає гріди без зупинки | загальна стеля рахується на юзера: другий не отримує 429 через трафік першого (автоматично — `rate-limit.e2e-spec.ts` › general ceiling) |
| 0.10 | Зупинити Valkey (`docker compose -p saas-skeleton stop valkey`), 10 разів логін | правильний пароль → 200, невірний → 401 (не 429 і не 503); у лозі `event=throttler_storage_unavailable` на кожен запит; відповідь не довша за ~200 мс від звичайної. Підняти Valkey — ліміт знову діє |

## AUTH-1 — сесії (US2)

| # | Дія | Очікування |
| --- | --- | --- |
| 1.1 | **Перехід без розлогінення**: на коміті ДО AUTH-1 залогінитись у web; перейти на коміт AUTH-1, `pnpm db:migrate:deploy`, перезапустити api | вкладка продовжує працювати після refresh (перенесений `argon2:`-рядок), після першої ротації в БД `token_hash` починається з `sha256:` |
| 1.2 | Увійти у звичайному вікні та в інкогніто | `/user-settings/security` показує 2 сесії, «This device» у поточної; прийшло сповіщення «новий пристрій» (якщо браузери різні) |
| 1.3 | З першого вікна завершити сесію інкогніто | інкогніто миттєво втрачає сокет (presence-крапка гасне), наступний refresh → 401 → `/login`; сокет першого вікна НЕ перепідключався; у першого лишилась 1 сесія; у журналі — `user.sessions_revoked` з причиною `user` |
| 1.4 | Завершити поточну сесію зі списку | редірект на `/login` |
| 1.5 | «Sign out everywhere» | інші пристрої вилітають, поточний лишається залогіненим |
| 1.6 | Взяти refresh-токен до ротації, виконати refresh, у БД зсунути `prev_rotated_at` на −2 хв, пред'явити старий | 401, `revoked_reason = rotation_reuse`, у дзвінку сповіщення безпеки, інші сесії живі |
| 1.7 | Два паралельні refresh одним токеном (дві вкладки) | обидва 200, `generation` +1, а не +2 |
| 1.8 | Зсунути `absolute_expires_at` у минуле | refresh → 401 при вірному секреті |
| 1.9 | `DELETE /api/account/sessions/<id чужого юзера>` | 404, рядок живий |
| 1.10 | **Дві репліки**: api на :3001 і :3011 проти однієї Valkey; сокет вкладки — до :3011, `DELETE /account/sessions/:id` — через :3001 | сокет рветься не пізніше ніж за 5 с (FR-019, SC-006) |

## AUTH-2 — cookie + control plane (US3)

| # | Дія | Очікування |
| --- | --- | --- |
| 2.1 | Логін у web → DevTools → Application | `localStorage` без токенів; cookie `saas_refresh` HttpOnly, `Path=/api/auth`, `SameSite=Lax`; тіло відповіді без `refreshToken` |
| 2.2 | F5 | лишаєтеся залогіненим; у Network один `POST /api/auth/refresh` |
| 2.3 | Анонімне вікно → `/` | `/login`, один тихий 401, без тосту |
| 2.4 | Лишити вкладку на 20+ хв | сокет отримав `auth.expiring.v1` → оновився, presence не мигнула |
| 2.5 | Logout | cookie зникла, сесія `revoked_reason = logout` |
| 2.6 | `curl -X POST -H 'Origin: https://evil.example' --cookie saas_refresh=… …/api/auth/refresh` | 403; без `Origin` → 200 |
| 2.7 | platform-web: логін, F5, 70 хв роботи | сесія жива (access 15 хв + refresh), `localStorage` порожній; 6 невдалих логінів → 429 |
| 2.8 | Access-токен tenant → platform-api і навпаки | 401 в обидва боки |

## AUTH-3 — відновлення (US4)

| # | Дія | Очікування |
| --- | --- | --- |
| 3.1 | `/login` → «Forgot password?» → email існуючого юзера | 204; у Mailpit (http://localhost:8025) лист із лінком на `APP_PUBLIC_URL` |
| 3.2 | Те саме з неіснуючим email | ідентична відповідь; листа немає; у `pgboss.job` немає нової job-и |
| 3.3 | Відкрити лінк → новий пароль | одразу залогінені; токен зник з URL; старий пароль → 401; інша відкрита сесія вилетіла |
| 3.3a | `SELECT data FROM pgboss.job WHERE name LIKE 'auth.password-reset-requested.v1/%'`; те саме на екрані Jobs у platform-web | у `data` — `tokenEncrypted` з префіксом `v1:`, сирого токена з листа там немає |
| 3.3b | Деактивувати юзера між запитом скидання і переходом за лінком | помилка «посилання недійсне», пароль не змінився, сесії не видано |
| 3.4 | Відкрити той самий лінк вдруге | помилка «посилання недійсне» |
| 3.5 | `/user-settings/account` → змінити email, невірний поточний пароль | помилка на полі |
| 3.6 | Вірний пароль → лист на нову адресу → відкрити лінк `/confirm-email?token=…` в **іншому, незалогіненому** браузері | підтвердження проходить без логіну; email змінено; на стару адресу прийшло повідомлення |
| 3.7 | Між запитом і підтвердженням створити іншого юзера з цією адресою | підтвердження → 409 на полі |

## AUTH-4 — 2FA (US5)

| # | Дія | Очікування |
| --- | --- | --- |
| 4.1 | `/user-settings/security` → увімкнути 2FA, **реальний застосунок на телефоні** | QR/секрет → код → 10 recovery-кодів, кнопка завантаження файлу |
| 4.2 | Logout → логін паролем | форма просить код, у Network `status: 'mfa_required'` і непрозорий `mfaToken` (не JWT); у `auth_sessions` нових рядків немає, у `mfa_challenges` — один |
| 4.3 | Код із телефону | вхід, рівно одна нова сесія, `mfa_challenges.consumed_at` заповнено |
| 4.4 | Той самий код ще раз (logout → login) у межах 30 с | відмова |
| 4.5 | 5 невірних кодів | `attempts = 5`; 6-та спроба → 401, форма повертає на пароль |
| 4.6 | Зупинити Valkey і пройти 4.2–4.5 | усе працює так само, ліміт 5 спроб діє |
| 4.7 | Recovery-код | вхід; `GET /account/mfa` → `recoveryCodesRemaining: 9`; сповіщення безпеки і `user.recovery_code_used` у журналі; повтор коду → відмова |
| 4.8 | `SELECT totp_secret_encrypted FROM users` | починається з `v1:`, не збігається з секретом |
| 4.9 | Адмін: `/settings` → Security → require MFA; юзер без 2FA логіниться | потрапляє на майстер; `curl` з його access-токеном на `/api/customers` → 403 `MFA_SETUP_REQUIRED`, на `/api/auth/me` → 200; сокет не підключається |
| 4.10 | Той самий юзер проходить майстер | доступ до `/workspace` відкривається одразу, без повторного входу |
| 4.11 | Юзер, залогінений ДО вмикання політики | працює до наступного refresh (≤ 15 хв), далі → майстер; ніхто не розлогінений |
| 4.12 | Вимкнути 2FA з невірним паролем; при увімкненій `requireMfa` — з вірним | помилка на полі; з вірним при політиці → 403 |
| 4.13 | Адмін на картці юзера з 2FA → «Reset 2FA» → підтвердити | сесії юзера мертві, сокет розірвано, сповіщення в юзера, `user.mfa_reset` у журналі; наступний вхід — лише паролем (або майстер при політиці) |
| 4.14 | Адмін намагається скинути 2FA собі | кнопки на власній картці немає; прямий `POST /api/users/<свій id>/mfa/reset` → 403 |
