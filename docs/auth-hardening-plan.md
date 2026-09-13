# Auth Hardening — план імплементації (AUTH-0 … AUTH-4)

> **Для кого цей файл.** Це робоча інструкція для моделі, яка виконуватиме роботу
> **за п'ять окремих заходів** (по одному на сесію). Файл самодостатній: у ньому є
> поточний стан коду, зафіксовані рішення з обґрунтуванням, покрокові чекбокси і
> критерії приймання. Читати спочатку §0 і §1 — вони діють у кожному заході.
>
> **Правило ведення.** Виконав крок — постав `[x]` у цьому файлі **у тому ж комміті**,
> що й код кроку. Наприкінці заходу онови «Табло» нижче і §8 (журнал відхилень).
> Якщо крок виконати не можна — НЕ прибирай чекбокс: познач `[~]` і додай рядок у §8
> з причиною. Порожній чекбокс = робота попереду, `[~]` = свідомо пропущено.
>
> **Мова.** Коментарі в коді і доках — українською (як у решті репозиторію).
> Ідентифікатори, імена файлів, повідомлення логів — англійською.

---

## Табло прогресу

| Захід | Фаза                                                     | Обсяг | Міграції | Ламає контракти                               | Статус       |
| ----- | -------------------------------------------------------- | ----- | -------- | --------------------------------------------- | ------------ |
| 1     | **AUTH-0** — hardening без міграцій                      | S     | 0        | ні                                            | ✅ завершено |
| 2     | **AUTH-1** — сесія як сутність                           | L     | 1        | так (`/account/sessions`)                     | ✅ завершено |
| 3     | **AUTH-2** — httpOnly cookie + дзеркало в platform       | M     | 0        | так (`AuthTokens.refreshToken` стає опційним) | ⬜ не почато |
| 4     | **AUTH-3** — відновлення доступу (`verification_tokens`) | M     | 1        | ні (тільки нові роути)                        | ⬜ не почато |
| 5     | **AUTH-4** — 2FA (TOTP)                                  | L     | 1        | так (`AuthResponse` → union)                  | ⬜ не почато |

Статуси: ⬜ не почато · 🟨 в роботі · ✅ завершено й перевірено.

**Порядок обов'язковий.** Заходи 2→3 і 4→5 мають жорсткі залежності
(cookie ставиться на вже існуючий `sid`; 2FA використовує `verification_tokens`
і recovery-коди з заходу 4). Захід 1 незалежний, але робиться першим, бо дешевий
і закриває найгучніший відкритий ризик (brute force).

---

## §0. Поточний стан auth (станом на 2026-09-12)

### Що вже працює і чого НЕ треба переробляти

| Елемент                 | Де                                                                                                                                              | Стан                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Access-токен            | JWT 15m, payload `{sub, email, role, tenantId}`                                                                                                 | ок                             |
| Перевірка access-токена | `apps/api/src/auth/access-token.service.ts` — **єдине місце**, спільне для HTTP-guard і socket-middleware                                       | ок, не роздвоювати             |
| HTTP-guard              | `apps/api/src/auth/guards/jwt-auth.guard.ts` (глобальний `APP_GUARD`, `@Public()` для відкритих)                                                | ок                             |
| RBAC-зародок            | `@Roles(Role.ADMIN)` + `RolesGuard` (opt-in: хендлер без декоратора пропускається)                                                              | ок                             |
| Refresh-токен           | рядок `tenantId:tokenId:secret`, argon2-хеш секрету в `refresh_tokens.token_hash`                                                               | **переробляється в AUTH-1**    |
| Ротація                 | `delete` старого рядка + `create` нового на кожен `/auth/refresh`                                                                               | **переробляється в AUTH-1**    |
| Theft detection         | невірний secret при живому `tokenId` → `deleteMany` **усіх** токенів юзера                                                                      | **розширюється в AUTH-1**      |
| Logout                  | `POST /auth/logout`, публічний, мовчазно ідемпотентний (завжди 204)                                                                             | ок                             |
| Revoke all              | `POST /account/sessions/revoke-all` + свіжа пара ПІСЛЯ коміту                                                                                   | лишається, міняється нутрощами |
| Зміна пароля            | `POST /account/password`, доказ старого, 400 з `fieldErrors.currentPassword`                                                                    | ок                             |
| Kill-switch             | `isActive: false` на юзері і тенанті — перевіряється на login, refresh, socket-handshake                                                        | ок                             |
| Фронт                   | access у пам'яті (Zustand), refresh у `localStorage['saas_refresh_token']`, single-flight `refreshTokens()` в `apps/web/src/api/http-client.ts` | **міняється в AUTH-2**         |
| Realtime-цикл           | `auth.expiring.v1` → той самий `refreshTokens()` → `auth.update.v1` з ack; hard-таймер рве сокет на спливанні                                   | ок, не чіпати                  |

### Чого немає взагалі (це і є предмет плану)

1. **Сесії як сутності.** `refresh_tokens.id` змінюється на кожній ротації (~кожні
   15 хв) — ідентифікатор пристрою відсутній за побудовою.
2. **Повного reuse-detection.** RFC 9700 §4.14.2 вимагає вбивати всю family при
   пред'явленні вже ротованого токена. У нас ротація — це `delete`, рядка немає,
   пред'явник отримує звичайний 401, і атака не фіксується ніде.
3. **Absolute lifetime.** Кожна ротація видає `expiresAt = now + 7д` → активна
   сесія не спливає ніколи.
4. **Rate limiting** на `/auth/login` і `/auth/refresh` — жодного.
5. **`trust proxy`** — за nginx/swarm усі запити мають IP балансувальника.
6. **CORS allowlist** — `app.enableCors()` без опцій (`apps/api/src/main.ts`).
7. **`helmet`**, валідації env при старті.
8. **Відновлення доступу** — forgot password немає; юзер залежить від адміна.
9. **Зміни email** — поле read-only в UI, флоу немає.
10. **2FA** — немає.
11. **Метаданих пристрою** (`user_agent`, `ip`, `last_used_at`) — немає.

### Два технічні борги, які прибираються принагідно

- `AuthService.issueTokens` створює рядок із `tokenHash: ''` і одразу робить
  `UPDATE` — два запити там, де потрібен один (виправляється в AUTH-1).
- `argon2` на refresh-секреті: ~100 мс CPU на кожну ротацію. Повільний хеш потрібен
  **паролям** (низька ентропія); випадковому 256-бітному секрету — ні. Замінюється
  на SHA-256 в AUTH-1 (патерн GitHub/Auth0 для API-токенів).

---

## §1. Інваріанти проєкту (діють у КОЖНОМУ заході)

Порушення будь-чого з цього списку — привід переробити крок, а не «домовитись».

### 1.1. Конвеєр типів

Zod-схема в `libs/contracts` → `createZodDto` (nestjs-zod v5) → Swagger
(`@ApiOkResponse({ type: Dto.Output })`) → `pnpm openapi:generate` → `pnpm web:codegen`.
**Ручних типів API не існує.** Обидва артефакти (`apps/api/openapi.json` і
`apps/web/src/api/generated`) комітяться.

### 1.2. Шари backend-модуля

DTO → Service (логіка + Prisma) → Mapper (явний мапінг Prisma→response) → Controller.
`passwordHash`, `tokenHash`, `totpSecret` **ніколи** не потрапляють у мапер.

### 1.3. Мультитенантність невидима для доменного коду

- `tenantId` у сервісі — запах. Колонку заповнює DB-default із CLS, скоупить RLS.
- Легальні винятки (вже існують): `auth` (видача JWT, резолюція тенанта з префікса
  refresh-токена) і інфра-сервіси з композитним PK.
- Транзакції — **тільки** `TenantTransactions.withTenantTx` (голий `$transaction`
  заборонений ESLint-ом).
- Кожна нова таблиця отримує в міграції:
  ```sql
  ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "x" FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "x"
    FOR ALL
    USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
    WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
  ```
  Авточек `pg_policies` в `apps/api/test/rls.e2e-spec.ts` підхопить нову таблицю сам —
  забули політику, і тест впаде.
- Колонка: `"tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text)`,
  у схемі — `@default(dbgenerated(...))`, композитний FK на `(tenantId, userId)`.

### 1.4. Міграції

`cd libs/database && pnpm exec prisma migrate dev --name <name>`
(**НЕ** `pnpm db:migrate:dev -- --name X` — pnpm дублює `--`, prisma висне в prompt).
Prisma на зміну типу колонки генерує `DROP + ADD` — переписувати руками на
`ALTER … TYPE … USING`.

### 1.5. Активності й сповіщення

- `ActivityRecorder.record(tx, …)` — `tx` перший обов'язковий аргумент.
- `NotificationRecorder.notify(tx, …)` — так само; recorder сам відсіює «актор ==
  отримувач» і поважає преференси (немутабельні типи — виняток).
- Нові типи реєструються в `libs/contracts/src/activity/activity.schema.ts` і
  `libs/contracts/src/notification/notification.schema.ts` (закритий enum + payload-схема
  - `NOTIFICATION_TYPE_META`).
- **Рутинні події auth в activities НЕ пишемо** (успішний логін кожні 15 хв засмітить
  фід). Туди йдуть лише аномалії і свідомі дії: `sessions_revoked`, `password_changed`,
  reuse-detected, вмикання/вимикання 2FA.

### 1.6. Асинхронна робота

Єдиний шлях — `libs/shared/src/messaging/`. Нова подія = `defineEvent` у
`definitions/*.messages.ts` + рядок у `MESSAGE_TOPOLOGY` + клас `@MessageSubscriber`
у `apps/worker/src/subscribers/`. **Розсинхрон маніфесту і класів валить старт воркера** —
це фіча, не баг. Публікація тільки `publish(tx, …)` у транзакції доменної зміни.

### 1.7. Фронт

- UI-примітиви — з `libs/ui` (`@saas-skeleton/ui/components/ui/*`), кустарних обгорток
  не заводимо.
- Форми — RHF + `zodResolver` + `applyServerError` (потрібні **повні** `defaultValues`).
- Усі рядки — в i18next. Неймспейси: `apps/web/src/locales/en/*.json` (фічеві) і
  `libs/i18n/src/locales/en/*.json` (спільні: `common`, `errors`, `validation`,
  `activities`, `notifications`). Множина — суфікси `_one`/`_other` (форма v3 `_plural`
  у i18next 26 мовчки не працює).
- Скрол — `ScrollArea` з `libs/ui`, не нативний `overflow-y-auto`.

### 1.8. Definition of Done кожного заходу

```bash
pnpm lint && pnpm typecheck && pnpm build       # усі 6 таргетів
pnpm openapi:generate && pnpm web:codegen       # якщо чіпали контракти/контролери
pnpm api:test:e2e                               # ВИМАГАЄ Postgres і Valkey
```

- **`pnpm api:test:e2e` не ганяти з піднятим dev-стеком** — 14 сьютів × 2 Prisma-клієнти
  впираються в `max_connections` разом із api/worker, і падає ВИПАДКОВИЙ сусідній сьют
  (симптом — P2024, не чесна помилка підключення). Перед прогоном: `pkill -f 'api|worker'`.
- Turbo кешує зелений typecheck — при сумніві `pnpm typecheck --force`.
- Живий прогін у браузері обов'язковий для кожного заходу, що чіпає фронт: сценарії
  перелічені в розділі фази.

---

# Захід 1 — AUTH-0: hardening без міграцій

**Мета.** Закрити найгучніші відкриті ризики тим, що не зачіпає модель даних:
brute force, відкритий CORS, підміна IP за проксі, дефолтні секрети в проді.

**Критерій «зроблено».** 100 послідовних невдалих логінів з одного IP отримують 429
до того, як дійдуть до argon2; `curl` з чужим `Origin` відбивається; процес відмовляється
стартувати з `JWT_SECRET` із `.env.example`; у логах видно реальний IP клієнта, а не
адресу балансувальника.

## 1.1. Зафіксовані рішення (не переглядати)

- **Без permanent lockout.** NIST 800-63B прямо радить throttling замість блокування
  акаунта: lockout — це DoS-вектор на чужий акаунт (знаю email → блокую людину).
  Обмежуємо частоту, не закриваємо двері.
- **Ключ ліміту логіну — пара `(email, ip)`, а не лише IP.** Інакше корпоративний NAT
  (усі співробітники за одним зовнішнім IP) заб'є сам себе, а розподілена атака на один
  акаунт з різних IP пройде повз.
- **Storage лічильників — Valkey**, а не пам'ять процесу: у swarm N реплік api, і
  in-memory ліміт множиться на N (фактичний поріг стає невідомим).
- **Невдалі логіни НЕ пишемо в activities** — тільки лог рівня `warn` з тегами
  (`requestId`, email, ip) під майбутній алерт у Loki.

## 1.2. Кроки

### Redis-клієнт стає спільним ресурсом процесу

Зараз `REALTIME_REDIS` створюється в `RealtimeModule`, а `RealtimeModule` імпортує
`AuthModule`. Якщо throttler у auth-шарі попросить цей токен — вийде цикл модулів.

- [x] Створити `apps/api/src/redis/redis.module.ts` (`@Global()`) з провайдером
      `REDIS_CLIENT` (переїзд `realtime-redis.provider.ts`); `redisUrl` і `keyPrefix`
      читати з того самого env (`REDIS_URL`, `REALTIME_KEY_PREFIX`), дефолти не міняти.
- [x] `RealtimeModule` і `app.setup.ts` переводяться на `REDIS_CLIENT`; `REALTIME_REDIS`
      лишити реекспортом-алиасом **або** видалити разом з усіма вживаннями (обрати одне,
      напівстану не лишати).
- [x] `onApplicationShutdown` із `quit()` переїжджає в `RedisModule` (зараз він у
      `RealtimeModule` — після переїзду провайдера він закривав би чужий клієнт).
- [x] Перевірити `apps/api/test/setup-env.ts`: e2e ізолюються окремим
      `REALTIME_KEY_PREFIX` на jest-worker — ключі throttler-а мусять потрапити під той
      самий префікс, інакше сьюти битимуть лічильники один одного.

### Throttler

- [x] `pnpm --filter @saas-skeleton/api add @nestjs/throttler`
- [x] `apps/api/src/common/throttler/redis-throttler.storage.ts` — реалізація
      `ThrottlerStorage` на наявному `ioredis` (INCR + EXPIRE в одному `multi`;
      ~50 рядків). **Свідомо без пакета `nestjs-throttler-storage-redis`**: одна
      зовнішня залежність заради 50 рядків, які ми й так мусимо розуміти.
- [x] `ThrottlerModule.forRootAsync` в `app.module.ts`: дефолт помірний
      (120 запитів/хв на користувача; для анонімних — на IP) — це стеля від абузу, а не
      бізнес-обмеження. На IP для всіх вона віддавала б 429 цілому офісу за NAT (§8).
- [x] `@Throttle` на чутливих роутах: - `POST /auth/login` — 5/хв на `(email, ip)` + 20/хв на `ip`; - `POST /auth/refresh` — 30/хв на `ip` (ротація легальна, але не сотнями); - `POST /account/password`, `POST /account/sessions/revoke-all` — 10/год на юзера.
- [x] Кастомний `ThrottlerGuard` з `getTracker()`, який для логіну бере email із тіла
      запиту. **Грабля:** тіло на момент guard-а вже розпарсене body-parser-ом, але
      Zod-пайп ще не відпрацював — email може бути будь-чим; нормалізувати
      (`trim().toLowerCase()`) і обрізати довжину перед тим, як класти в ключ Redis.
- [x] Відповідь 429 мусить пройти через `AllExceptionsFilter` і отримати код
      `ApiError` (додати `TOO_MANY_REQUESTS` у закритий enum `libs/contracts/src/error/`).
- [x] Фронт: `libs/ui/src/api/api-error.ts` — 429 показується тостом із людським
      текстом (`errors.tooManyRequests` у `libs/i18n`), а не «щось пішло не так».

### Мережеві дрібниці, без яких ліміт декоративний

- [x] `NestFactory.create<NestExpressApplication>(...)` + `app.set('trust proxy', 1)`
      у `apps/api/src/main.ts` і `apps/platform-api/src/main.ts`.
      **Без цього кроку весь пункт «throttler» не працює**: за nginx/swarm `req.ip`
      дорівнює адресі балансувальника, і ліміт по IP банить увесь тенант одразу.
- [x] Звірити з логером: `apps/api/src/common/logger/` має писати справжній
      `req.ip` (після `trust proxy` він з'явиться сам).

### CORS і заголовки

- [x] `CORS_ALLOWED_ORIGINS` (comma-separated) — **той самий список**, що вже живе в
      `REALTIME_ALLOWED_ORIGINS` (`apps/api/src/realtime/realtime.config.ts`,
      дефолт `http://localhost:5173`). Прочитати обидва з одного місця, щоб вони не
      розійшлися: HTTP-CORS і Socket.IO `allowRequest` мусять мати однакову думку.
- [x] `app.enableCors({ origin: <allowlist>, credentials: true })` — `credentials`
      знадобиться в заході 3 (cookie), ставимо одразу.
- [x] `pnpm --filter @saas-skeleton/api add helmet` + `app.use(helmet())`.
      Для JSON-API користь помірна (`X-Content-Type-Options`, `X-Frame-Options`,
      вимкнений `X-Powered-By`), але ціна нульова. CSP для API не налаштовуємо —
      сторінок він не віддає (крім Swagger; перевірити, що `/api/docs` не зламався).

### Env fail-fast

- [x] `apps/api/src/config/env.schema.ts` — Zod-схема обов'язкових змінних:
      `DATABASE_URL`, `JWT_SECRET` (min 32 символи **і** заборона літерального значення
      з `.env.example`), `JWT_ACCESS_EXPIRES_IN`, `REDIS_URL`, S3-блок.
- [x] Підключити через `ConfigModule.forRoot({ validate })` — процес падає на старті,
      а не через тиждень «чомусь токени чужого середовища валідні».
- [x] Те саме для `apps/platform-api` (`PLATFORM_JWT_SECRET`), і **перевірити, що він
      не фолбечиться на `JWT_SECRET`** — це вже так, тест має це зафіксувати.
- [x] `.env.example` оновити коментарями до нових змінних.

### Password policy

- [x] `PasswordSchema` (`libs/contracts/src/user/user.schema.ts`) — підняти нижню межу
      з 8 до **12** символів і додати перевірку на топ-список зіпсованих паролів?
      **Рішення: ні до списку, так до 12.** Композиційні правила («цифра + спецсимвол»)
      NIST 800-63B прямо не радить; довжина — єдина метрика, що працює.
      Breach-словник — це або 100 МБ у репо, або зовнішній HIBP API (мережевий виклик
      у критичному шляху логіну) → поза скоупом, записати в §7.
- [x] Міграція наявних паролів не потрібна: перевірка діє на запис, старі хеші живі.
      Сід (`libs/database/prisma/seed.ts`) використовує `Admin12345` (10 символів) —
      **оновити сід і `docs/database-seed.md`**, інакше `pnpm db:reset` зламається.

## 1.3. Тести (додати в `apps/api/test/auth.e2e-spec.ts`)

- [x] 6-й підряд невдалий логін на ту саму пошту → 429 (і 6-й правильний логін теж 429 —
      ліміт не розрізняє успіх, це навмисно).
- [x] Ліміт по `(email, ip)` не заважає іншому email з того ж IP (у межах IP-стелі).
- [x] Лічильник скидається після вікна (фейковий таймер або окремий префікс ключа).
- [x] 429 має форму `ApiError` з `code: 'TOO_MANY_REQUESTS'` і `requestId`.
- [x] Старт із `JWT_SECRET` коротшим за 32 символи валить bootstrap.
- [x] **Ізоляція:** сьют чистить свої throttler-ключі у `afterEach`, інакше сусідній
      сьют почне з вичерпаним лімітом (класичне «падає випадковий тест»).

## 1.4. DoD заходу 1

- [x] `pnpm lint && pnpm typecheck && pnpm build` чисті
- [x] `pnpm api:test:e2e` і `pnpm platform:test:e2e` зелені
- [x] Живий прогін: `pnpm api:dev` + `pnpm web:dev`, 6 невдалих логінів у формі → тост
      про «забагато спроб» замість «невірний пароль»
- [x] Оновити «Табло» і §8

---

# Захід 2 — AUTH-1: сесія як сутність

**Мета.** Замінити «рядок refresh-токена, що живе 15 хвилин» на **сесію з
ідентифікатором, що переживає ротацію**. Це фундамент для всього решти: списку
пристроїв, повного reuse-detection, майбутнього denylist і 2FA.

**Критерій «зроблено».** У `/user-settings/security` видно список пристроїв із
позначкою «поточний»; кожен можна вбити окремо; пред'явлення ротованого токена
поза вікном грації вбиває сесію і присилає юзеру сповіщення; після перезапуску
api сесії живі; існуючі користувачі **не розлогінилися** міграцією.

## 2.1. Зафіксовані рішення (не переглядати)

**Модель — одна таблиця `auth_sessions`, рядок = пристрій.**
Альтернативу «сесія + рядок на кожне покоління токена» відкинуто арифметикою:
ротація кожні ~15 хв × 7 днів = **~670 рядків на один пристрій**. Повна family-історія
не варта такої ваги; для forensics достатньо лічильника `generation` і
`revoked_reason`.

**Формат refresh-токена НЕ змінюється: `tenantId:sessionId:secret`.**
Середній сегмент просто перестає бути одноразовим. Клієнти, socket-цикл і
`/auth/logout` нічого не помічають — це найдешевша можлива міграція.

**Хеш секрету — self-describing рядок `sha256:<hex>` / `argon2:<phc>`.**

- SHA-256 достатньо: секрет — 256 біт з `randomBytes`, словникова атака і
  передобчислення до нього не застосовні; повільний хеш потрібен **паролям**.
  Це знімає ~100 мс CPU з кожної ротації.
- Префікс замість окремої колонки `hash_alg`: самоописовий формат дозволяє
  прочитати перенесені argon2-хеші і переписати їх у sha256 при першій же ротації —
  **тому ніхто не розлогінюється**. Через 7 днів (макс. idle) argon2-гілка стає
  мертвою сама; код гілки лишається як приклад майбутньої зміни алгоритму.

**Reuse-interval 60 секунд.** Пред'явлення попереднього покоління в межах вікна —
це гонка клієнта (паралельні вкладки, мобільна мережа, повтор запиту), а не атака.
Карати за неї = розлогінювати людей у метро. Патерн Auth0 «refresh token reuse
interval». Поза вікном — атака, сесія вмирає.

**Reuse вбиває СЕСІЮ, а не всі сесії юзера.** Нинішня поведінка (`deleteMany` по
всьому юзеру) надто агресивна: один зіпсований токен на телефоні розлогінює робочий
ноутбук. Глобальне відкликання лишається за прапорцем
`AUTH_REUSE_REVOKES_ALL_SESSIONS=false`.

**TTL двовимірний.** `idle_expires_at` (7 днів від останнього використання) +
`absolute_expires_at` (30 днів від логіну, ротацією **не** подовжується). Зараз
сесія безсмертна, бо кожна ротація видає нові 7 днів.

**`sid` у access-токені обов'язковий.** Без нього сервер не може відповісти на
питання «а який із цих пристроїв — той, з якого прийшов запит», тобто список
пристроїв неможливо коректно намалювати. `jti` додаємо тією ж правкою — він
знадобиться, якщо колись з'явиться denylist.

**Парсер User-Agent — власний, ~40 рядків, у `libs/shared/src/auth/user-agent.ts`.**
`ua-parser-js` v2 змінив ліцензію на AGPL/комерційну; для «Chrome on macOS» вистачає
шести регексів. Сирий UA зберігаємо теж — розпарсене завжди можна перерахувати.

## 2.2. Схема даних

- [x] Модель у `libs/database/prisma/schema.prisma`:

```prisma
/// Сесія = пристрій. Id стабільний і переживає ротацію refresh-токена
/// (до AUTH-1 тут був рядок refresh_tokens, що вмирав на кожній ротації).
model AuthSession {
  id       String @id @default(uuid())
  tenantId String @default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)")) @map("tenant_id")
  userId   String @map("user_id")

  /// Хеш ПОТОЧНОГО покоління секрету: "sha256:<hex>" або (перенесені) "argon2:<phc>"
  tokenHash     String    @map("token_hash")
  /// Попереднє покоління — живе `reuseWindow` секунд, щоб гонка клієнта не читалась як атака
  prevTokenHash String?   @map("prev_token_hash")
  prevRotatedAt DateTime? @map("prev_rotated_at")
  /// Лічильник ротацій: аномально велике значення = привід подивитись уважніше
  generation    Int       @default(0)

  issuedAt          DateTime  @default(now()) @map("issued_at")
  lastUsedAt        DateTime  @default(now()) @map("last_used_at")
  /// Спливає від БЕЗДІЯЛЬНОСТІ; ротація посуває
  idleExpiresAt     DateTime  @map("idle_expires_at")
  /// Стеля життя сесії; ротація НЕ посуває
  absoluteExpiresAt DateTime  @map("absolute_expires_at")
  revokedAt         DateTime? @map("revoked_at")
  /// logout | rotation_reuse | secret_mismatch | revoke_all | password_change | admin | user
  revokedReason     String?   @map("revoked_reason")

  userAgent   String? @map("user_agent")
  ip          String? @map("ip")
  /// "Chrome on macOS" — обчислено при створенні; сирий UA лишається поруч
  deviceLabel String? @map("device_label")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [tenantId, userId], references: [tenantId, id], onDelete: Cascade)

  @@index([tenantId, userId])
  @@index([tenantId, idleExpiresAt])
  @@map("auth_sessions")
}
```

- [x] Міграція `cd libs/database && pnpm exec prisma migrate dev --name auth_sessions`
- [x] У згенерованому SQL **дописати руками**:
  - [x] RLS-блок за шаблоном §1.3 (`ENABLE` + `FORCE` + `tenant_isolation`);
  - [x] перенесення даних **до** `DROP TABLE "refresh_tokens"`:
    ```sql
    INSERT INTO "auth_sessions" (id, tenant_id, user_id, token_hash, generation,
                                 issued_at, last_used_at, idle_expires_at, absolute_expires_at)
    SELECT id, tenant_id, user_id, 'argon2:' || token_hash, 0,
           created_at, created_at, expires_at, created_at + INTERVAL '30 days'
    FROM "refresh_tokens";
    ```
  - [x] `DROP TABLE "refresh_tokens";` — **тільки після** `INSERT … SELECT`.
- [x] Прогнати `pnpm db:reset` і переконатись, що всі міграції лягають на чисту БД.

## 2.3. Бекенд

- [x] `apps/api/src/auth/auth-session.service.ts` — уся механіка сесій окремо від
      `AuthService` (той лишається про логін/токени):
      `create()`, `rotate()`, `verifyAndConsume()`, `revoke(sid, reason)`,
      `revokeAllForUser(userId, reason)`, `listForUser(userId)`.
- [x] Алгоритм `verifyAndConsume(refreshToken)` — реалізувати рівно в цьому порядку: 1. `split(':')` → `tenantId`, `sid`, `secret`; невірний формат → 401. 2. `tenantContext.set(tenantId)` (як зараз: на `/auth/refresh` немає ні JWT, ні slug). 3. Знайти сесію по `sid`; немає / `revokedAt != null` /
      `idleExpiresAt < now` / `absoluteExpiresAt < now` → 401. 4. `tenantId` префікса ≠ `session.tenantId` → 401 (захист від зшитого токена). 5. secret збігається з `tokenHash` → **ротація**: `generation++`,
      `prevTokenHash ← tokenHash`, `prevRotatedAt ← now`, новий `tokenHash` (sha256),
      `lastUsedAt/ip/userAgent ← поточні`, `idleExpiresAt ← now + idle`,
      `absoluteExpiresAt` **не чіпати**. 6. інакше secret збігається з `prevTokenHash`: - `now - prevRotatedAt <= reuseWindow` → гонка: віддати нову пару як у п.5,
      `generation` не інкрементувати (щоб лічильник не брехав); - інакше → **reuse detected**: `revoke(sid, 'rotation_reuse')`, сповіщення
      юзеру, лог `error`, 401. 7. інакше → `revoke(sid, 'secret_mismatch')`, 401. 8. Після успіху — перевірити `user.isActive` і `tenant.isActive` (як зараз).
- [x] `AuthService.issueTokens` → один `INSERT` (хеш рахується ДО запису; порожнього
      `tokenHash` більше не існує), payload JWT += `sid`, `jti`.
- [x] `JwtPayload` (`apps/api/src/auth/decorators/current-user.decorator.ts`) += `sid`.
      **Перевірити socket-шар**: `SocketAuthService` і `handleAuthUpdate` звіряють
      `sub`/`tenantId`/`role` при оновленні токена — вирішити, чи `sid` теж має
      збігатися (рекомендація: **ні** — після revoke-all клієнт легально приносить
      токен нової сесії, і вимога незмінного `sid` розірвала б живий сокет без потреби).
- [x] `@ClientContext()` — декоратор у `apps/api/src/common/` → `{ ip, userAgent }`
      з `req.ip` (працює завдяки `trust proxy` із заходу 1) і `req.headers['user-agent']`.
      Передається в `login` і `refresh`.
- [x] `libs/shared/src/auth/user-agent.ts` — `parseUserAgent(ua): string | null`
      («Chrome on macOS», «Safari on iPhone», «Unknown device»).
- [x] Конфіг (`AUTH_SESSION_IDLE_DAYS=7`, `AUTH_SESSION_ABSOLUTE_DAYS=30`,
      `AUTH_REFRESH_REUSE_WINDOW_SECONDS=60`, `AUTH_REUSE_REVOKES_ALL_SESSIONS=false`)
      через Zod-схему env із заходу 1 + `.env.example`.
- [x] `UsersService.setPassword` і `AccountService.revokeAllSessions` переводяться на
      `revokeAllForUser(..., reason)` — **`update` замість `deleteMany`**: рядок лишається
      з `revoked_at`, інакше зникає і слід, і можливість показати «сесію вбито тоді-то».
- [x] `UsersService.setStatus(false)` — так само (зараз теж `deleteMany`).
- [x] **Миттєвий розрив WS** при revoke: після коміту транзакції
      `namespace.to(userRoom(tenantId, userId)).disconnectSockets(true)` через
      `RealtimeEmitter` (додати метод `disconnectUser(tenantId, userId)`). Adapter
      (Valkey) сам рознесе це по всіх нодах. Межа чесна: REST через ще живий
      access-токен працює до 15 хв — так і написано в UI.
- [x] Cron `apps/worker/src/subscribers/cleanup-expired-tokens.subscriber.ts`:
      перевести на `auth_sessions`, видаляти рядки, де
      `revoked_at < now() - 30d` OR `absolute_expires_at < now() - 30d`
      (30 днів «мертвого» зберігання — щоб список пристроїв міг показати історію
      і щоб інцидент було чим розбирати). Команда називається `auth.cleanup-expired-tokens` —
      **ім'я черги не перейменовувати** (перейменування = нова черга, старі job-и
      лишаться в непрочитаній).

## 2.4. Контракти й ендпоінти

- [x] `libs/contracts/src/account/account.schema.ts`:
      `ts
  AuthSessionResponseSchema = {
    id, deviceLabel, userAgent, ip, isCurrent,
    createdAt, lastUsedAt, idleExpiresAt, absoluteExpiresAt
  }
  `
      `revokedAt`/`revokedReason` у відповідь **не** віддаємо: список показує активні
      сесії, мертві — це forensics в БД, не UI.
- [x] `GET /account/sessions` → `AuthSessionResponse[]` (тільки живі, найсвіжіші зверху,
      поточна першою).
- [x] `DELETE /account/sessions/:id` → 204. Чужий/неіснуючий `id` → **404**, не 403
      (не даємо оракул «чи існує така сесія»). Вбити поточну сесію дозволено — це
      просто logout з іншого боку.
- [x] `POST /account/sessions/revoke-all` лишається як є (повертає свіжу пару).
- [x] Мапер `apps/api/src/account/account.mapper.ts` — `tokenHash`/`prevTokenHash`
      не існують у відповіді за побудовою (явний мапінг, не спред).
- [x] `pnpm openapi:generate && pnpm web:codegen`

## 2.5. Активності й сповіщення

- [x] `libs/contracts/src/notification/notification.schema.ts`: - `auth.new_device` — «вхід із нового пристрою» (категорія `security`,
      `muteable: false`, payload `{ deviceLabel, ip }`); - `auth.session_reuse_detected` — «сесію завершено з міркувань безпеки»
      (категорія `security`, `muteable: false`).
- [x] «Новий пристрій» визначаємо як «немає ЖИВОЇ сесії цього юзера з таким
      `deviceLabel`». Не fingerprint, не IP-мережа — просто і чесно; хибні
      спрацювання (перевстановив браузер) дешеві, пропуски — дорогі.
- [x] `libs/contracts/src/activity/activity.schema.ts`: `user.sessions_revoked` —
      payload += опційний `reason`. Нових типів активності **не додаємо** (див. §1.5).
- [x] Тексти в `libs/i18n/src/locales/en/notifications.json`.

## 2.6. Фронт (`apps/web`)

- [x] `apps/web/src/pages/user-settings/security.tsx` — секція `SessionsSection`
      замість абзацу-пояснення: список пристроїв (`Item*` з `libs/ui`, **не** кустарна
      розмітка), рядок = `deviceLabel` · IP · відносний час `lastUsedAt`, бейдж
      «This device» для `isCurrent`, кнопка revoke на кожному + «Sign out everywhere» знизу.
- [x] Видалення поточної сесії → `clearSession()` + редірект на `/login`
      (сервер уже нічого не поверне).
- [x] Порожнього стану не буває (сесія, з якої дивишся, завжди є) — не вигадувати `Empty`.
- [x] Інвалідація списку після кожної дії; тости успіху/помилки.
- [x] Рядки — `apps/web/src/locales/en/user-settings.json`; відносний час — наявний
      хелпер форматування з `libs/ui/src/lib/format`.
- [x] Оновити підпис про «до 15 хвилин»: тепер WS рветься миттєво, REST — до спливання
      access-токена. Текст має описувати рівно це.

## 2.7. Тести — новий `apps/api/test/auth-sessions.e2e-spec.ts`

- [x] Логін створює рівно один рядок `auth_sessions` із заповненими UA/IP/deviceLabel.
- [x] Ротація зберігає **той самий** `sid` і інкрементує `generation`.
- [x] Ротація посуває `idle_expires_at` і **не чіпає** `absolute_expires_at`.
- [x] Сесія з `absolute_expires_at` у минулому → 401, навіть якщо секрет вірний.
- [x] **Reuse у вікні:** старий токен одразу після ротації → 200 (гонка).
- [x] **Reuse поза вікном:** `prev_rotated_at` зсунуто в минуле → 401 + `revoked_reason
  = 'rotation_reuse'` + сповіщення в інбоксі юзера.
- [x] Reuse вбиває ТІЛЬКИ свою сесію — друга сесія того ж юзера жива.
- [x] Чужий секрет при живому `sid` → 401 + `revoked_reason = 'secret_mismatch'`.
- [x] `GET /account/sessions` показує обидві сесії; `isCurrent` — рівно в тієї, чий
      access-токен пред'явлено.
- [x] `DELETE /account/sessions/:id` чужої сесії (інший юзер) → 404, рядок живий.
- [x] Зміна пароля / revoke-all ставлять `revoked_at` усім, але поточний пристрій
      отримує робочу нову пару.
- [x] Міграційний шлях: рядок із `argon2:`-префіксом верифікується і після ротації
      стає `sha256:` (зібрати хеш у тесті вручну).
- [x] RLS: сесія юзера тенанта B не видима під контекстом A (`rls.e2e-spec` авточек
      `pg_policies` підхопить таблицю сам, але явний тест ізоляції теж потрібен).
- [x] Оновити наявні сьюти, що чіпають `refresh_tokens` напряму
      (`auth.e2e-spec.ts`, `account.e2e-spec.ts`, `users.e2e-spec.ts`) — прямі
      prisma-доступи тестів ідуть через `SystemPrismaService` (BYPASSRLS).

## 2.8. Граблі цього заходу

- **`DROP TABLE refresh_tokens` до `INSERT … SELECT`** — втрата всіх живих сесій.
  Порядок у міграції перевірити очима.
- **Prisma на зміну типу колонки генерує `DROP + ADD`** — якщо вирішиш не створювати
  нову таблицю, а еволюціонувати стару, перечитай §1.4.
- **Не плутати `deleteMany` і revoke.** Після переходу на `revoked_at` усі місця, що
  рахують «скільки сесій відкликано», мають рахувати `updateMany().count`.
- **`disconnectSockets(true)` рве і поточний пристрій** — викликати ПІСЛЯ того, як
  нова пара токенів уже сформована й повернута (інакше людина вилітає за власну дію).
- **Тести presence/realtime вимагають живої Valkey** — сьют сесій теж, якщо чіпає
  `disconnectUser`.

## 2.9. DoD заходу 2

- [x] Усі чекбокси §2.2–§2.7
- [x] `pnpm lint && pnpm typecheck && pnpm build` чисті; `openapi.json` і orval-артефакти закомічені
- [x] `pnpm api:test:e2e` зелений (очікувано ~+14 тестів)
- [~] Живий прогін: два «браузери» (два різні `User-Agent` через curl) → у списку дві
      сесії з правильним `isCurrent` → вбити чужу з першого → її refresh 401, сусідня
      жива, чужий id → 404. Розрив сокета перевірено e2e (`realtime.e2e-spec.ts`,
      справжній socket.io-клієнт), а НЕ в живому браузері — §8
- [~] Живий прогін міграції на БД зі СТАРИМИ рядками не робився: dev-БД на момент
      міграції мала нуль `refresh_tokens`, тож `INSERT … SELECT` перенiс нуль рядків.
      Перевірено інакше: всі 16 міграцій лягли на ЧИСТУ базу (throwaway `saas_migrcheck`,
      21 таблиця + політика `tenant_isolation` на `auth_sessions`), а `argon2:`-шлях
      верифікації і перезапис на `sha256:` покрито e2e — §8
- [x] Оновити «Табло» і §8

---

# Захід 3 — AUTH-2: refresh у httpOnly cookie (+ дзеркало в platform)

**Мета.** Прибрати refresh-токен із досяжності JavaScript. Сьогодні один XSS дає
атакуючому довічну сесію — і ротація тут на боці атакуючого: він ротує першим,
справжній юзер отримує 401 і вважає це збоєм.

**Критерій «зроблено».** `localStorage` порожній; `document.cookie` не показує
refresh; повний цикл (логін → F5 → refresh → logout) працює; socket-цикл
`auth.expiring` → `auth.update` теж.

## 3.1. Зафіксовані рішення (не переглядати)

**Cookie, а не BFF.** Повний BFF (сесія цілком на сервері, фронт без токенів) —
найбезпечніше, але переписує обидва фронти і socket-auth. Не окупається.

**Один шлях коду, а не два транспорти.** Cookie ставиться **завжди**; `Secure` —
деталь конфігу (`COOKIE_SECURE`, за замовчуванням `true`, `false` на локалці й
тестовому проді по http). Прапорець «слати токен у тілі» не заводимо: два шляхи =
два набори багів, і той, яким не користуються, тихо гниє.

**`SameSite=Lax` + `Path=/api/auth`.**

- `Lax` не шле cookie на cross-site POST → CSRF на `/auth/refresh` закрито для
  сучасних браузерів; `Strict` нічого не додає (перехід за посиланням нам не потрібен),
  але ламає сценарії повернення з зовнішніх лінків.
- `Path` звужує: cookie не їде на кожен запит до API, тільки на auth-роути.
- Додатково — перевірка заголовка `Origin` на `/auth/refresh` і `/auth/logout`
  проти allowlist із заходу 1 (пояс і підтяжки; старі браузери без `SameSite`).

**Префікс `__Host-`/`__Secure-` не беремо.** `__Host-` вимагає `Path=/` (конфліктує
з нашим звуженням), `__Secure-` — щоб ім'я мінялося разом із `COOKIE_SECURE`, тобто
два імені в коді. Ім'я лишається просте: `saas_refresh`.

**Same-origin уже забезпечено.** dev — vite-проксі `/api` → :3001; прод — nginx у
контейнері web проксить `/api` по overlay. Тому CORS для cookie взагалі не потрібен,
а `credentials: true` із заходу 1 покриває нестандартні розгортання.

**`AuthTokens.refreshToken` стає опційним** у контракті (сервер його більше не
віддає в тілі), а не видаляється: `apps/platform-web` ще на старій схемі, і поле
знадобиться, доки його не перевели.

## 3.2. Кроки — бекенд

- [ ] `pnpm --filter @saas-skeleton/api add cookie-parser` (+ `@types/cookie-parser` у dev)
      і `app.use(cookieParser())` у `main.ts` **та** в `configureApp` (інакше e2e
      перевірятимуть не ту конфігурацію — та сама причина, чому там стоїть
      WebSocket-адаптер).
- [ ] `apps/api/src/auth/refresh-cookie.ts` — одне місце на ім'я, опції й TTL cookie:
      `set(res, token)`, `clear(res)`, `read(req)`.
- [ ] `AuthController`: `login`, `refresh`, `account/password`, `account/sessions/revoke-all`
      отримують `@Res({ passthrough: true })` і ставлять cookie; `logout` — чистить.
      **Грабля:** без `passthrough: true` Nest віддає керування відповіддю вручну, і
      повернений об'єкт перестає серіалізуватись — роут почне віддавати порожнє тіло.
- [ ] `refresh`/`logout` читають токен **спочатку з cookie**, і лише потім із тіла
      (перехідний період — доки `platform-web` і старі вкладки не оновились).
      Після заходу 5 гілку з тілом прибрати (записати в §7 як борг із датою).
- [ ] Перевірка `Origin` на `/auth/refresh` і `/auth/logout`: немає заголовка — пропускаємо
      (native-клієнти, curl); є і не в allowlist — 403.
- [ ] `AuthTokensSchema.refreshToken` → `.optional()`; мапери перестають його класти.
- [ ] `pnpm openapi:generate && pnpm web:codegen && pnpm platform:web:codegen`

## 3.3. Кроки — фронт (`apps/web`)

- [ ] `axios.create({ baseURL: '/', withCredentials: true })` у
      `apps/web/src/api/http-client.ts`.
- [ ] `refreshTokens()` більше не читає токен зі сховища — просто
      `POST /api/auth/refresh` з порожнім тілом; single-flight лишається як є.
- [ ] `apps/web/src/stores/auth.store.ts`: прибрати `REFRESH_TOKEN_KEY`,
      `getStoredRefreshToken()`, запис у `localStorage`. Стор тримає **тільки**
      `user` + `accessToken` (обидва в пам'яті).
- [ ] `init-auth.ts`: умову «є токен у localStorage» замінити на безумовну спробу
      `refreshTokens()` з мовчазним `catch` (cookie ми не бачимо — 401 і є відповіддю
      «сесії немає»). **Наслідок:** кожен холодний старт анонімного відвідувача робить
      один зайвий 401 — це нормально і дешевше за будь-який маркер у localStorage.
      Маркер «здається, ми залогінені» заводити **не** треба: він рано чи пізно
      розійдеться з реальністю.
- [ ] Перевірити, що логаут із `http-client` (`clearSession()` + редірект) кличе
      серверний `/auth/logout` — інакше cookie лишиться жити.
- [ ] Socket-цикл: `auth.expiring.v1` → `refreshTokens()` → `auth.update.v1` працює без
      змін (токен доступу як був у пам'яті, так і лишився) — **перевірити живим прогоном**,
      це найтонше місце заходу.

## 3.4. Дзеркало в `platform-api` / `platform-web`

Контрол-плейн зараз слабший за дата-плейн: access-токен 60 хв **без refresh**,
у `localStorage`. Це не можна лишати після того, як tenant-план став строгішим.

- [ ] Портувати `auth_sessions` у platform-план (таблиця `platform_auth_sessions`,
      **без RLS** — `platform_users` живуть поза tenant-ізоляцією, `REVOKE ALL FROM saas_app`).
- [ ] Повноцінний refresh-флоу: access 15 хв + refresh-cookie, ротація, той самий
      `AuthSessionService` (винести спільну механіку в `libs/shared/src/auth/`, якщо
      дублювання перевищить ~40 рядків; інакше чесна копія краща за передчасну абстракцію).
- [ ] `apps/platform-web`: прибрати access-токен із `localStorage`.
- [ ] Перевірити, що токени двох планів лишились крос-невалідними (наявний e2e).

> **Якщо обсяг заходу росте** — дзеркало виносити в окремий захід 6, а не робити
> наспіх: запиши це в §8 і онови «Табло». Головне — не лишити platform у
> напівстані (частина сесій у cookie, частина в localStorage).

## 3.5. Тести

- [ ] Логін ставить `Set-Cookie` з `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`;
      тіло відповіді `refreshToken` **не** містить.
- [ ] `refresh` без cookie і без тіла → 401.
- [ ] `refresh` із cookie → 200 + нова `Set-Cookie` (ротація видна в заголовку).
- [ ] `logout` чистить cookie (`Max-Age=0`) і вбиває сесію.
- [ ] Чужий `Origin` на `/auth/refresh` → 403; відсутній `Origin` → 200.
- [ ] `COOKIE_SECURE=true` додає `Secure` (перевіряти рядок заголовка, не поведінку).

## 3.6. DoD заходу 3

- [ ] Живий прогін у браузері: логін → DevTools → `localStorage` порожній,
      cookie є і позначена HttpOnly → F5 зберігає сесію → вкладка 20+ хвилин відкрита
      (socket дожив до `auth.expiring` і оновився) → logout чистить cookie
- [ ] `pnpm api:test:e2e` і `pnpm platform:test:e2e` зелені
- [ ] Оновити «Табло» і §8

---

# Захід 4 — AUTH-3: відновлення доступу (`verification_tokens`)

**Мета.** Закрити продуктову діру: сьогодні людина, що забула пароль, залежить від
адміна, а зміна email узагалі неможлива (поле read-only).

**Критерій «зроблено».** «Забув пароль» → лист у Mailpit → перехід за лінком →
новий пароль → всі старі сесії мертві, нова працює. Зміна email — з підтвердженням
на **нову** адресу.

## 4.1. Зафіксовані рішення (не переглядати)

**Одна таблиця `verification_tokens` на всі одноразові лінки**, з дискримінатором
`purpose`: `password_reset` | `email_change` | `invite`. Третій purpose заводимо
**порожнім з першого дня** — invite першого адміна тенанта вже лежить у беклозі MT-4,
і додавати його потім означало б міграцію заради значення enum. Той самий хід, що зі
`scope` у `NumberingService`.

**Зберігаємо хеш, не токен.** Витік БД не має давати робочих лінків. SHA-256 — з тих
самих міркувань, що в AUTH-1 (256 біт ентропії).

**Відповідь на `POST /auth/password-reset` — завжди 204**, незалежно від існування
email. Інакше роут стає оракулом «чи є така людина у вашій системі» — а це
мультитенантний продукт, і перелік користувачів клієнта не наша річ, щоб її роздавати.

**TTL 60 хвилин, одноразовість через `used_at`.** Успішний reset **відкликає всі
сесії** юзера (`revoke_all` з AUTH-1) — це стандарт: «я втратив контроль над акаунтом»
і є типовою причиною скидання.

**Зміна email підтверджується на НОВУ адресу, а старій надсилається сповіщення.**
Підтвердження на нову доводить володіння; лист на стару — це шанс помітити
захоплення акаунта. Email змінюється **тільки** після підтвердження; до того часу
нова адреса живе в `payload` токена, а не в `users`.

**Лист шле worker через наявний конвеєр.** `defineEvent` + `MESSAGE_TOPOLOGY` +
`@MessageSubscriber` — другого шляху асинхронної роботи в системі немає (§1.6).
Публікація — `publish(tx, …)` у транзакції створення токена.

## 4.2. Кроки

- [ ] Модель `VerificationToken` → таблиця `verification_tokens`:
      `id`, `tenant_id`, `user_id`, `purpose`, `token_hash`, `payload Json`,
      `expires_at`, `used_at`, `created_at`, `created_ip`; індекс
      `(tenant_id, user_id, purpose)`; RLS за шаблоном §1.3.
- [ ] Міграція `--name verification_tokens`.
- [ ] `apps/api/src/auth/verification-token.service.ts`:
      `issue(tx, {purpose, userId, payload, ttl})` → повертає **сирий** токен (єдиний
      момент, коли він існує в пам'яті); `consume(purpose, token)` → рядок або `null`
      (перевіряє `used_at`, `expires_at`, ставить `used_at` у тій самій транзакції).
- [ ] Ендпоінти (усі `@Public()`, усі під throttler із заходу 1 — інакше це розсилач спаму): - `POST /auth/password-reset` `{ email, tenant? }` → 204 завжди; - `POST /auth/password-reset/confirm` `{ token, newPassword }` → 200 + нова пара
      токенів (одразу залогінити — людина щойно довела володіння поштою); - `POST /account/email-change` (аутентифікований) `{ newEmail, currentPassword }` → 204; - `POST /account/email-change/confirm` `{ token }` → 200 + оновлений профіль.
- [ ] **Резолюція тенанта на `/auth/password-reset`** — та сама механіка, що на логіні
      (поле `tenant` як недовірена підказка + `SlugTenantResolver`). Токен у лінку
      несе `tenantId` префіксом (як refresh), щоб `confirm` знав контекст без підказки.
- [ ] Події `auth.password-reset-requested.v1` і `auth.email-change-requested.v1`
      (`libs/shared/src/messaging/definitions/auth.messages.ts`) + рядки в
      `MESSAGE_TOPOLOGY` + підписники в `apps/worker/src/subscribers/`.
      **Payload несе тільки `userId` і сирий токен** — решту (locale, ім'я) підписник
      читає з БД свіжими, як це робить `WelcomeEmailSubscriber`.
- [ ] Шаблони листів — `apps/worker/src/locales/en/notifications.json` (worker має
      власний i18next, спільного з фронтом немає).
- [ ] Базова URL для лінка — `APP_PUBLIC_URL` в env (worker не знає, під яким доменом
      живе фронт).
- [ ] Фронт: `/reset-password` і `/reset-password/confirm?token=…` (публічні роути,
      поза `AppShell`), посилання «Forgot password?» на `/login`; секція зміни email
      у `/user-settings/account` замість read-only-підпису.

## 4.3. Граблі

- **Лист — at-least-once side effect.** Падіння підписника після `sendMail` дасть
  повторний лист. Для reset це прийнятно (обидва лінки ведуть до того самого токена).
  Claim-before-send сюди **не** тягнемо — він для платіжних/юридичних листів.
- **Токен у URL потрапляє в логи проксі й в історію браузера.** Тому TTL короткий,
  одноразовість обов'язкова, а сторінка `confirm` після успіху робить
  `history.replaceState` без токена.
- **Зміна email ламає логін** — `users.email` унікальний у межах тенанта; перевірити
  зайнятість **на момент підтвердження**, а не лише на момент запиту (за годину адресу
  могли зайняти). Конфлікт → `fieldConflictException()` з полем.

## 4.4. Тести (новий `apps/api/test/auth-recovery.e2e-spec.ts`)

- [ ] Неіснуючий email → 204 і **жодної** опублікованої події (оракула немає).
- [ ] Успішний цикл reset: токен → новий пароль → старий не працює → всі попередні
      сесії мертві → повернена пара робоча.
- [ ] Повторне використання токена → 400/410, пароль не змінився.
- [ ] Протухлий токен (`expires_at` у минулому) → відмова.
- [ ] Токен одного purpose не приймається іншим ендпоінтом.
- [ ] Крос-tenant: токен тенанта A не діє в контексті B.
- [ ] Зміна email: невірний `currentPassword` → 400 з полем; підтвердження змінює
      `users.email`; зайнята адреса на момент підтвердження → 409.

## 4.5. DoD заходу 4

- [ ] Живий прогін: `pnpm docker:up` (Mailpit) + api + worker + web → «Forgot password»
      → лист у http://localhost:8025 → скидання → вхід новим паролем
- [ ] `pnpm api:test:e2e` зелений
- [ ] Оновити «Табло» і §8

---

# Захід 5 — AUTH-4: двофакторна автентифікація (TOTP)

**Мета.** Другий фактор при логіні — код із застосунку-автентифікатора.

**Критерій «зроблено».** Юзер вмикає 2FA (QR → підтвердження кодом → показ
recovery-кодів), виходить, входить знову — логін просить код; recovery-код працює
рівно один раз; адмін тенанта може зробити 2FA обов'язковою.

## 5.1. Зафіксовані рішення (не переглядати)

**TOTP (RFC 6238) перший, passkeys — потім і окремо.** WebAuthn/passkeys за
best practice 2026 сильніші (phishing-resistant), але RP ID прив'язаний до **домену** —
на `http://IP:port` вони не працюють узагалі, а наш тестовий прод саме такий. Тому
passkeys — після TLS-домену (§2.7 roadmap), як доповнення, не заміна.

**Секрет шифрується, не хешується.** TOTP вимагає оригінал секрету для перевірки —
хеш не підходить. AES-256-GCM, ключ `ENCRYPTION_KEY` (32 байти base64) в env,
новий `CryptoService` у `libs/shared/src/crypto/`. **Це перший секрет у системі, що
не є ні паролем, ні токеном** — і перший, який не можна «забути й видати новий»,
не вимкнувши 2FA юзеру.

**Recovery-коди — argon2**, а не sha256: їх 10 штук, вони короткі й людські
(низька ентропія — саме той випадок, де потрібен повільний хеш).

**Логін стає двокроковим, і це ламає контракт.** `AuthResponse` перетворюється на
discriminated union: `{ status: 'ok', user, tokens }` | `{ status: 'mfa_required',
mfaToken }`. `mfaToken` — окремий короткоживучий JWT (5 хв) з **власним scope**
(`typ: 'mfa'`), який `JwtAuthGuard` **не** приймає. Перевірити, що orval згенерував
union нормально; якщо ні — розділити на два response-типи і повертати 200/202.

**Крок 2 — теж під throttler** (6 цифр = 1 000 000 комбінацій; без ліміту це не
другий фактор). 5 спроб на `mfaToken`, потім токен мертвий.

**Вікно дрейфу — ±1 крок (30 с).** Ширше вікно = ширша поверхня перебору.
Використаний код запам'ятовується до кінця свого кроку (інакше перехоплений код
спрацює вдруге).

**Політика тенанта — у `Tenant.settings` JSON**, не колонка: це поведінковий
прапорець, платформа за ним не фільтруватиме (на відміну від `currency`).
Гейт вмикається **не** миттєво для всіх: юзер без 2FA після вмикання політики
логіниться і потрапляє на екран примусового налаштування.

## 5.2. Кроки

- [ ] `pnpm --filter @saas-skeleton/api add otplib` (MIT).
- [ ] Міграція: `users.totp_secret_encrypted`, `users.totp_enabled_at`,
      таблиця `user_recovery_codes` (`id`, `tenant_id`, `user_id`, `code_hash`,
      `used_at`) + RLS за шаблоном §1.3.
- [ ] `libs/shared/src/crypto/crypto.service.ts` — AES-256-GCM `encrypt`/`decrypt`
      (формат `v1:<iv>:<tag>:<ciphertext>`, base64), ключ із env, fail-fast на старті.
- [ ] `apps/api/src/auth/mfa/` — `mfa.service.ts` (setup/confirm/verify/disable,
      генерація і споживання recovery-кодів), `mfa.controller.ts`.
- [ ] Ендпоінти: - `POST /account/mfa/setup` → `{ secret, otpauthUrl }` (секрет ще **не** ввімкнений); - `POST /account/mfa/confirm` `{ code }` → `{ recoveryCodes: string[] }` —
      єдиний раз, коли коди видно; - `POST /account/mfa/disable` `{ currentPassword }` → 204; - `POST /account/mfa/recovery-codes` `{ currentPassword }` → перегенерація; - `POST /auth/mfa/verify` `{ mfaToken, code }` → `AuthResponse` (крок 2 логіну).
- [ ] `AuthService.login`: якщо `totp_enabled_at != null` → віддати `mfa_required`
      **замість** пари токенів. Сесія (`auth_sessions`) створюється **тільки** на
      кроці 2 — інакше в списку пристроїв висітимуть недологінені спроби.
- [ ] QR на фронті: `otpauthUrl` → QR **без нової залежності**, якщо в `libs/ui` вже є
      чим малювати; інакше показати секрет текстом для ручного введення і записати
      «QR — борг» у §8. Тягнути `qrcode`-пакет заради одного екрана — рішення користувача,
      не моделі.
- [ ] UI в `/user-settings/security`: картка стану 2FA, майстер вмикання (3 кроки),
      екран recovery-кодів із кнопкою «завантажити» (**увага:** у нашому шелі завантаження
      файлу з blob-URL — звичайна сторінка, обмеження стосуються лише Artifacts),
      вимикання з підтвердженням пароля.
- [ ] Екран кроку 2 на `/login` (окремий стан форми, не окремий роут — інакше
      `mfaToken` доведеться десь зберігати).
- [ ] Сповіщення (немутабельні, категорія `security`): `auth.mfa_enabled`,
      `auth.mfa_disabled`, `auth.recovery_code_used`.
- [ ] Політика тенанта: `settings.security.requireMfa` + секція в `/settings`
      (запис під `@Roles(ADMIN)`), гейт у фронті — редірект на майстер.

## 5.3. Тести (новий `apps/api/test/auth-mfa.e2e-spec.ts`)

- [ ] Логін юзера з 2FA не віддає токенів; `mfaToken` не приймається `JwtAuthGuard`.
- [ ] Валідний TOTP (згенерований `otplib` у тесті) → повна пара + рівно одна нова сесія.
- [ ] Код сусіднього кроку (±30 с) приймається, ±90 с — ні.
- [ ] Повторне використання того самого коду в межах кроку → відмова.
- [ ] 6 невдалих спроб → `mfaToken` мертвий.
- [ ] Recovery-код працює один раз; другий раз — ні; лишилось 9.
- [ ] `disable` без вірного пароля → 400 з полем.
- [ ] Секрет у БД зашифрований (рядок не дорівнює оригіналу і починається з `v1:`).
- [ ] Секрет/коди не витікають у жодну відповідь мапера.

## 5.4. DoD заходу 5

- [ ] Живий прогін із реальним застосунком-автентифікатором на телефоні
      (у симуляторі/тесті TOTP збігатиметься завжди — це не перевірка)
- [ ] `pnpm api:test:e2e` зелений
- [ ] Оновити «Табло» і §8; після завершення — оновити `docs/account-settings.md` §6
      і `docs/roadmap.md` §2.5 (пункти закриті)

---

## §7. Що свідомо НЕ робимо (і чому)

| Не робимо                                                   | Причина                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Denylist access-токенів у Valkey** (миттєвий REST-revoke) | +1 звернення до брокера на кожен запит і залежність auth від Valkey. Потрібна політика fail-open (revoke — прискорення, а не основний контроль доступу), а fail-open денилист — це вже не гарантія. Вмикати, коли з'явиться вимога комплаєнсу; до того чесний підпис «до 15 хвилин» + миттєвий розрив WS з AUTH-1 |
| **Серверні сесії замість JWT**                              | auth не має падати разом із брокером; ламає socket-auth і весь конвеєр токенів                                                                                                                                                                                                                                    |
| **Permanent account lockout**                               | DoS-вектор на чужий акаунт (NIST 800-63B)                                                                                                                                                                                                                                                                         |
| **Breach-словник паролів (HIBP)**                           | або 100 МБ у репо, або мережевий виклик у критичному шляху логіну                                                                                                                                                                                                                                                 |
| **Композиційні правила пароля** («цифра+спецсимвол»)        | NIST 800-63B прямо не радить; працює довжина                                                                                                                                                                                                                                                                      |
| **Окремий `audit-log` модуль**                              | його роль виконує Activity Log — розширюємо закритий enum                                                                                                                                                                                                                                                         |
| **Повна family-історія refresh-токенів**                    | ~670 рядків на пристрій на тиждень; `generation` + `revoked_reason` дають те саме для розбору                                                                                                                                                                                                                     |
| **GeoIP у сесіях**                                          | зовнішня база або платний API заради рядка в UI                                                                                                                                                                                                                                                                   |
| **Passkeys/WebAuthn зараз**                                 | RP ID прив'язаний до домену — на `http://IP:port` не працює; після TLS-домену                                                                                                                                                                                                                                     |
| **SSO / OIDC / SAML**                                       | окремий продуктовий напрям, не hardening                                                                                                                                                                                                                                                                          |

**Технічний борг, який ці заходи створюють свідомо:**

- гілка «refresh-токен у тілі запиту» після заходу 3 лишається заради `platform-web` —
  прибрати після заходу 5;
- `argon2:`-гілка верифікації після заходу 2 стає мертвою через 7 днів — лишається
  як приклад зміни алгоритму хешування.

---

## §8. Журнал відхилень

Записувати сюди все, що пішло не за планом: пропущені кроки (`[~]`), знайдені
граблі, змінені рішення. Формат — дата, захід, що і чому.

| Дата       | Захід | Що сталося                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | —     | План складено (аудит `apps/api/src/auth`, `apps/api/src/account`, `docs/account-settings.md`, `docs/roadmap.md` §2.5)                                                                                                                                                                                                                                           |
| 2026-09-13 | —     | Скоуп закріплено SpecKit-артефактами `specs/001-auth-hardening/` (spec + clarify + plan + tasks). Рішення clarify, що змінюють цей план: лічильник спроб 2FA — у БД, а не Valkey; throttler — fail-open; обов'язкова 2FA блокується на сервері; скидання 2FA адміном (див. `specs/001-auth-hardening/plan.md` D-1…D-9)                                          |
| 2026-09-13 | 1     | **Throttler у platform-api не зроблено** (D-1): у стеку platform-api не має Valkey; ліміт логіну оператора переїхав у захід 3 разом із дзеркалом сесій                                                                                                                                                                                                          |
| 2026-09-13 | 1     | `REALTIME_REDIS` **видалено**, аліасу немає (D-2); третій споживач — `presence.store.ts`. Для throttler-а — ОКРЕМИЙ клієнт `REDIS_THROTTLER_CLIENT` без offline-черги: fail-open потребує швидкої помилки, а спільний клієнт тримає чергу для presence                                                                                                          |
| 2026-09-13 | 1     | Замість `@Throttle` на роутах — іменовані throttler-и в `ThrottlerModule` + opt-in `@RateLimit(...)` через `skipIf`: @nestjs/throttler v6 застосовує кожен оголошений throttler до КОЖНОГО роуту. Guard — `AppThrottlerGuard` (підклас) лише заради стандартного `Retry-After`: для іменованого ліміту пакет пише `Retry-After-login` і світить `X-RateLimit-*` |
| 2026-09-13 | 1     | Усі пороги — env з бойовими дефолтами, а не константи в декораторах: e2e ідуть `--runInBand` з одного IP, лічильники спільні між сьютами. `setup-env.ts` піднімає пороги, бойові значення задає лише `rate-limit.e2e-spec.ts` (окремий файл, а не `auth.e2e-spec.ts` — свій застосунок з іншим env)                                                             |
| 2026-09-13 | 1     | Env-схема робить обов'язковим лише `JWT_SECRET`/`PLATFORM_JWT_SECRET`: у БД/S3/Valkey є робочі дефолти, і обов'язковість зламала б `pnpm api:dev` без `.env`. Плейсхолдери з `.env.example` відхиляються явним списком — **локальні `.env`, скопійовані з прикладу, треба оновити** (`openssl rand -hex 32`)                                                    |
| 2026-09-13 | 1     | CORS control plane — `PLATFORM_CORS_ALLOWED_ORIGINS`, а не спільне `CORS_ALLOWED_ORIGINS`: у dev обидва API читають один кореневий `.env`                                                                                                                                                                                                                       |
| 2026-09-13 | 1     | Знайдено поза планом: пароль першого адміна тенанта (`CreateTenantSchema`) мав `min(8)` — переведено на `PasswordSchema`. Пароль сіду `Admin12345` → `Admin1234567`; на наявній dev-БД сід його не переписує (`update: {}`)                                                                                                                                     |
| 2026-09-13 | 1     | helmet: CSP лишено, але БЕЗ `upgrade-insecure-requests` — тестовий прод по http, Swagger через nginx тягнув би ресурси по https. Перевірено: `/api/docs` рендериться                                                                                                                                                                                            |
| 2026-09-13 | 1     | Невдалий логін: `event=auth_login_failed` + reason/email/tenant; `requestId` і ip дає контекстний логер pino-http (`req.id`, `req.ip`), серіалізатор `req` тепер пише `ip` з Express, а не адресу сокета                                                                                                                                                        |
| 2026-09-13 | 1     | Нестабільність e2e, НЕ пов'язана із заходом: до змін повний прогін дав 205/206 (`numbering`), після — поодиноке падіння випадкового сьюту (`numbering`/`notifications`), кожен окремо зелений; три повні прогони поспіль — 221/221. Фронт: 429 — глобальний тост, форма його не показує під полями                                                              |
| 2026-09-13 | 1     | **Виправлено після `/speckit-analyze`** (plan D-10): загальна стеля `default` рахувалась на IP для ВСІХ роутів — офіс за одним NAT ділив би 120/хв на всіх, SPA кожного впирався б у 429. Тепер трекер — `user:<sub>` (throttler стоїть після `JwtAuthGuard`), на IP — лише анонімні запити; e2e «general ceiling». `THROTTLER_STORAGE_TIMEOUT_MS` прибрано з env — константа 200 мс (D-15) |
| 2026-09-13 | —     | `/speckit-analyze` змінив дизайн наступних заходів (plan D-11…D-15): токен одноразового посилання в payload події — лише зашифрований (`CryptoService` переїжджає з заходу 5 у захід 4, `ENCRYPTION_KEY` потрібен api і worker); realtime рветься на рівні сесії (`sessionRoom`), тенант емітер бере з CLS; сторінка підтвердження email — публічна `/confirm-email`; `sessions_revoked` лише для самостійних завершень; TTL-и і стеля спроб — константи |
| 2026-09-13 | 2     | **AUTH-1 зроблено.** `refresh_tokens` → `auth_sessions`: `id` стабільний і став `sid` у JWT, ротація — умовний `updateMany` по `tokenHash` (оптимістичне блокування замість `FOR UPDATE`), хеш секрету — `sha256:` (256 біт ентропії не треба розтягувати argon2 на кожному refresh), перенесені рядки живуть під префіксом `argon2:` і переписуються першою ж ротацією |
| 2026-09-13 | 2     | **Порядок у міграції виправлено руками**: Prisma згенерувала `DROP TABLE refresh_tokens` ПЕРЕД `CREATE TABLE auth_sessions` — тобто мовчазне розлогінення всіх. У файлі порядок CREATE → `INSERT … SELECT` → RLS → DROP |
| 2026-09-13 | 2     | `AccessTokenService` відхиляє токен БЕЗ `sid` (виданий до переходу). Розлогінення це не спричиняє — refresh-токени пережили міграцію, і перший 401 клієнт закриває мовчазним refresh-ом; без цього не було б ні `isCurrent`, ні точкового розриву сокета |
| 2026-09-13 | 2     | Реалізовано в парі з планом: `disconnectSession(sid)` рве рівно один пристрій, `disconnectUser` — усі; тенант обидва беруть із CLS (D-12). `auth.update.v1` `sid` НЕ звіряє і ПЕРЕВОДИТЬ сокет у room нової сесії — інакше після зміни пароля вкладка лишалась би в room-і мертвої сесії |
| 2026-09-13 | 2     | Побічний ефект, спійманий сусідніми сьютами: `auth.new_device` пише рядок в інбокс на КОЖЕН логін, і 15 тестів (`notifications`, `calendar`, `realtime`) рахували «в інбоксі рівно один елемент». Прибирання цього типу додано в login-хелпери тих сьютів — сповіщення правильне, просто не їхній предмет |
| 2026-09-13 | 2     | Тест «theft detection вбиває ВСІ токени юзера» переписано: тепер невідомий секрет відкликає ТІЛЬКИ свою сесію (`secret_mismatch`), а стару поведінку вмикає `AUTH_REUSE_REVOKES_ALL_SESSIONS=true`. `auth.e2e-spec` «old token after rotation → 401» теж змінився: у 60-секундному вікні старий токен дає 200 (гонка вкладок), 401 — лише після закриття вікна |
| 2026-09-13 | 2     | `JWT_REFRESH_EXPIRES_DAYS` прибрано звідусіль (env-приклади, `deploy.env`, stack-compose) — його замінили `AUTH_SESSION_IDLE_DAYS`/`AUTH_SESSION_ABSOLUTE_DAYS` |
| 2026-09-13 | 2     | **Не зроблено (перенесено):** живий прогін у браузері і 1.10 (дві репліки api :3001/:3011 проти однієї Valkey); прогін міграції на БД зі старими рядками — dev-БД мала нуль `refresh_tokens`. Замість них: e2e зі справжнім socket.io-клієнтом, `argon2:`-шлях в e2e і накат усіх міграцій на чисту throwaway-базу. E2E: 203 → **245** tenant + 16 platform |

---

## §9. Довідник: куди дивитись

| Тема                                              | Файл                                             |
| ------------------------------------------------- | ------------------------------------------------ |
| Чому немає списку сесій (V1) і три рівні розвитку | `docs/account-settings.md` §2                    |
| Беклог безпеки auth                               | `docs/roadmap.md` §2.5                           |
| RLS, tenant-контекст, контракт нового модуля      | `docs/multi-tenancy-architecture.md`             |
| Конвеєр повідомлень, конверт, DLQ                 | `docs/event-driven-architecture.md`              |
| Socket-auth, presence, last-seen                  | `docs/realtime.md`, `docs/realtime-internals.md` |
| Типи сповіщень, категорії, преференси             | `docs/notifications.md`                          |
| Журнал подій, `ActivityRecorder`                  | `docs/activity-log.md`                           |
| Правила UI, форми, токени теми                    | `docs/frontend/ui-stack.md`                      |
| Шел, контекстна панель, area                      | `docs/frontend/app-shell.md`                     |
| Сід-ідентичності і `pnpm db:reset`                | `docs/database-seed.md`                          |
