# Roadmap

Стан на **2026-08-15**. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md);
профільні деталі — у документах, на які посилається кожен рядок.

Документ описує **куди йдемо**. Історія «як робили» живе в шапці `CLAUDE.md` і в профільних
доках — тут завершені віхи лишені одним рядком, щоб було видно базу, на яку спирається план.

---

## 1. Зроблено

| Віха                            | Дата          | Що дала                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Док                                    |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Фаза 1 — фундамент**          | 2026-07-11    | Монорепо pnpm+Turborepo, ESLint/Prettier/Husky, CI; `libs/contracts` (Zod 4), `libs/database` (Prisma 7); auth + users end-to-end; конвеєр Zod → OpenAPI → orval → typed hooks; `apps/web`                                                                                                                                                                                                                                                                              | `architecture-proposal.md`             |
| **Фаза 2.1 — черги**            | 2026-07-11    | pg-boss v12 за власним `JobDispatcher`, `libs/shared` (`defineJob`, `@JobHandler`, `JobInboxService`), `apps/worker`, cron, транзакційний dispatch (замінено на EDA-1)                                                                                                                                                                                                                                                                                                  | `architecture-proposal.md`             |
| **Фаза 2.2 — помилки**          | 2026-07-12    | Наскрізний `ApiError`-envelope: `AllExceptionsFilter` → toast / fieldErrors у формах                                                                                                                                                                                                                                                                                                                                                                                    | `error-handling.md`                    |
| **I18N-1…3**                    | 2026-07-12    | `libs/i18n` + react-i18next, коди помилок замість тексту з бекенда, `users.locale` і реальний welcome-лист локаллю юзера                                                                                                                                                                                                                                                                                                                                                | `i18n-plan.md`                         |
| **DataGrid**                    | 2026-07-13    | `createDataGrid` — фільтри/сортування/пагінація/selection декларативно; `/users`, `/jobs`                                                                                                                                                                                                                                                                                                                                                                               | `CLAUDE.md`                            |
| **Files v1**                    | 2026-07-14    | S3-сумісне сховище, двофазний presigned-upload, magic-bytes валідація, thumbnail у воркері, cron-очистка                                                                                                                                                                                                                                                                                                                                                                | `file-storage.md`                      |
| **MT-0…MT-3**                   | 2026-07-16…17 | Три ролі БД → tenant-фундамент → **RLS як основний enforcement** → control plane `apps/platform-api` + `apps/platform-web`                                                                                                                                                                                                                                                                                                                                              | `multi-tenancy-architecture.md`        |
| **`pnpm db:reset`**             | 2026-07-17    | Один деструктивний dev-скрипт + зафіксовані seed-ідентичності                                                                                                                                                                                                                                                                                                                                                                                                           | `database-seed.md`                     |
| **Activity Log**                | 2026-07-21    | Журнал бізнес-подій (`type`+`payload`, рендер через i18next), перший курсорний ендпоінт, sync/async-запис                                                                                                                                                                                                                                                                                                                                                               | `activity-log.md`                      |
| **Деплой у Swarm + CI**         | 2026-07-24…31 | GitLab CI: build 6 образів → `docker stack deploy` через docker-context по SSH (нуль файлів на сервері); dev-стек `saas-dev` живий на 172.18.13.101; manual `db_roles`/`seed`/`dump`                                                                                                                                                                                                                                                                                    | `deploy-swarm.md`                      |
| **EDA-0 + EDA-1**               | 2026-08-04    | Єдиний конвеєр асинхронних повідомлень замість `libs/shared/src/jobs/`: подія/команда, конверт (`messageId`/`correlationId`/`causationId`/`actor`), маніфест `MESSAGE_TOPOLOGY` із fan-out-ом на публікації, inbox по бізнес-факту, спільна DLQ, boot-assert топології                                                                                                                                                                                                  | `event-driven-architecture.md`         |
| **Realtime**                    | 2026-08-15    | Socket.IO-гейтвей (websocket-only) + Valkey як Redis Streams adapter; socket-auth спільна з HTTP, tenant-ізоляція, presence на distributed leases (`GET /api/presence` + delta з ревізіями), online-badge на `/users`                                                                                                                                                                                                                                                   | `realtime.md`, `realtime-internals.md` |
| **In-app сповіщення (EDA-4)**   | 2026-08-16    | Персональний інбокс: 3 таблиці з RLS, колапс через частковий унікальний індекс, `unread/read/archived` + `seenAt` для бейджа, преференси на тип, курсорний REST + socket-дельти за патерном presence, after-commit хук у `withTenantTx`, headless-міст із воркера, bell + панель у UI                                                                                                                                                                                   | `notifications.md`                     |
| **Last seen (RT-3)**            | 2026-08-29    | `users.last_seen_at` як high-water mark присутності: позначки з шести точок життєвого циклу socket-а, write-behind буфер + монотонний сирий `UPDATE` (не чіпає `@updatedAt`), `lastSeenAt` в offline-дельті проти застарілого кеша, підпис «Last seen …» у `/users` і на картці юзера                                                                                                                                                                                   | `realtime.md`, `realtime-internals.md` |
| **Customers (еталонний домен)** | 2026-09-01    | Перша бізнес-сутність скелетона: `Customer` (`kind`: організація/фізособа) + `CustomerContact` + спільний нумераційний двигун (`NumberingService`: цілі номери, свої в кожного тенанта, конфіг серії редагується на `/settings/numbering`); RLS за шаблоном MT-2, архів замість soft delete, окремий ендпоінт статусу, 5 типів активностей + сповіщення відповідальному, грід `/customers` і картка `/customers/$customerId` з вкладками Overview / Contacts / Activity | `customers.md`                         |
| **Календар CAL-1**              | 2026-09-07    | Події користувача: `CalendarEvent` + учасники з RSVP + персональні нагадування; пів-відкритий інтервал і IANA-зона поруч із UTC-інстантом, all-day у зоні події; читання ВІКНОМ (`from`/`to`) плюс курсорна agenda; доступ за УЧАСТЮ, а не роллю; **спільна `scheduled_notifications` + cron-сканер із атомарним claim** (нагадування end-to-end, без email); area `/calendar` з Day/Week/Month/Agenda на власних сітках, панель події, блок «Upcoming» на картці кастомера, секція `/settings/calendar` у `settings` JSON | `calendar.md`                          |
| **AI-асистент AI-0** | 2026-09-20 | Бічна панель довідки в tenant-порталі на **фейковому провайдері**: `ai_conversations`/`ai_messages` під RLS + частковий унікальний індекс «одна активна розмова на юзера», команда `ai.generate-reply` у воркері (три фази, транзакція не тримається через виклик моделі), стрім чанками через наявний Socket.IO-міст із `chunkSeq` і REST-фолбеком, скасування через Valkey pub/sub, `AiPanel` як пʼята колонка шела з розкриттям «це AI». Заразом `ConsumerSpec` навчився опцій воркера (`localConcurrency`/`groupConcurrency`/`pollingIntervalSeconds`/`expireInSeconds`) — дефолтна одиниця означала б одну генерацію на всю інсталяцію | `ai-assistant-implementation.md` |
| **Account Settings V1**         | 2026-08-29    | Розділ `/settings` (Profile / Account / Security / Notifications / Appearance) на шаблоні `satnaing/shadcn-admin`; модуль `apps/api/src/account/` без id у шляхах; зміна власного пароля з доказом старого і поверненням свіжої пари токенів, «вийти звідусіль», справжній `POST /auth/logout` замість суто клієнтського виходу. Списку пристроїв немає свідомо — сесії як сутності в моделі auth не існує                                                              | `account-settings.md`                  |

Проєктні документи без реалізації (готові до роботи):
беклог MT-4 у `multi-tenancy-architecture.md`,
фази EDA-2 і EDA-3 у [event-driven-architecture.md](event-driven-architecture.md),
фази CAL-2…CAL-4 у [calendar.md](calendar.md) (інтерактивність, командний перегляд,
повторення).

---

## 2. Наступні кроки (у порядку пріоритету)

### 2.1. ~~Заплановані сповіщення (нагадування)~~ — зроблено 2026-09-07

Механізм приїхав разом із календарем (CAL-1, [calendar.md](calendar.md) §8), бо саме він і
був його першим справжнім споживачем: `scheduled_notifications` (tenant-скоуп + RLS) +
cron-сканер `notifications.dispatch-scheduled` (раз на хвилину, `scope: 'system'`), який
атомарним `claim`-ом забирає дозріле й матеріалізує його в `notifications` наявним
recorder-ом. Перепланування і скасування — у тій самій транзакції, що доменна зміна;
запізніле (понад `grace`) позначається `stale` і не доставляється. Таблиця `notifications`
лишилась як є — тільки доставлені рядки.

Лишилось із цього напрямку:

- **email як другий канал** («не прочитано за N хвилин і юзер офлайн → лист»): схема
  преференсів уже несе `channel`, відкладений тригер тепер теж є — бракує самої доставки
  і claim-before-send для листів, які не можна дублювати;
- **домени поза календарем**: «дедлайн завтра» для тікетів і «підписка спливає» для
  білінгу пишуться тим самим `ScheduledNotificationService` без нового коду інфраструктури.

Операційний хвіст realtime (лишився з попередньої віхи): масштабування і rolling update на
живому стеку, навантажувальний профіль, метрики — перелік у `realtime-internals.md`.

### 2.2. ~~Налаштування організації~~ — зроблено 2026-09-01

Перша вертикаль (`general`: name + locale + currency) і `GET /settings/bootstrap` —
[settings.md](settings.md). Лишилось у беклозі того ж доку: `currency` у
`PATCH /tenants/:id` control plane, секції `email`/`features`/`branding`.

### 2.3. RBAC

Мапа role → permissions у `libs/contracts`, `@RequirePermissions('tickets:write')` + guard.
Ставиться поверх готового tenant-контексту.

**Частково розблоковано:** разом із налаштуваннями воркспейсу зʼявився вузький зародок —
`@Roles(Role.ADMIN)` + глобальний `RolesGuard` (opt-in на хендлері). Повна система
permissions **замінює** його, а не додається поруч.

### 2.4. Доменні модулі (еталони для форків)

Усі три пишуться вже на шарі `messaging` (EDA-1): асинхронна робота — тільки через
`defineEvent`/`defineCommand` + рядок у `MESSAGE_TOPOLOGY`, другого шляху немає.

1. ~~`customers`~~ — **зроблено 2026-09-01** ([customers.md](customers.md)): написаний без
   жодної згадки `tenantId` у доменному коді, як і вимагає контракт §11 MT-доку. Форк
   розвиває свій напрям саме звідси; беклог сутності (merge дублікатів, trgm-пошук,
   таблиця адрес, портал клієнта) — у §12 самого документа.
2. `tickets` — статусний workflow, коментарі, події → черга; перший реальний споживач activities.
3. `billing` = **EDA-3**, еталон події з багатьма підписниками
   ([event-driven-architecture.md](event-driven-architecture.md) §3.9, §4): Plan/Subscription/Invoice,
   інтерфейс `PaymentProvider`, fake-провайдер → Stripe, webhooks через чергу (ідемпотентність по
   `event_id UNIQUE`); `invoice.paid.v1` → облік (`ledger_entries` + звірка балансу), баланс
   кастомера, лист (claim-before-send), provisioning як relay-підписник, realtime.

`audit-log` окремим модулем не робимо — його роль виконує Activity Log; за потреби «чутливих»
подій розширюємо закритий enum типів.

### 2.5. Безпека auth

- reuse-detection ротованих refresh-токенів: `revokedAt` замість видалення рядка (зараз повторне
  використання дає 401, але не відкликає інші сесії);
- refresh у httpOnly + Secure + SameSite cookie замість localStorage (потребує TLS — робити разом
  із п. 2.7);
- звузити `app.enableCors()` до allowlist (зараз широкий; той самий allowlist піде в
  `REALTIME_ALLOWED_ORIGINS`).

**План імплементації — [auth-hardening-plan.md](auth-hardening-plan.md)**: п'ять заходів
(AUTH-0 hardening без міграцій → AUTH-1 сесія як сутність → AUTH-2 httpOnly cookie →
AUTH-3 відновлення доступу → AUTH-4 2FA) з чекбоксами, зафіксованими рішеннями і
критеріями приймання.

### 2.6. Operational maturity

- **EDA-2 — спостережуваність асинхронного шару** ([event-driven-architecture.md](event-driven-architecture.md) §6).
  Вкладка DLQ у `/jobs` (перегляд конверта, причина відмови, replay у рідну чергу), фільтр за
  `correlationId` (весь ланцюг однієї HTTP-операції одним запитом), лаг і глибина по черзі.
  Сам док позиціонує це як **наступний крок після EDA-1**: конвеєр уже кладе провалені
  повідомлення в спільну `dlq`, але дивитися на неї поки нічим.
- **Error tracking — Sentry або self-hosted GlitchTip** (SDK-сумісний): умовна ініціалізація по
  `SENTRY_DSN` у `main.ts` api/platform-api/worker + `captureException` у гілці ≥500
  `AllExceptionsFilter` (tag `requestId`). Deployment-агностично, можна робити будь-коли.
- **Агрегація логів — Grafana Loki + Alloy** як сервіс того самого swarm-стеку (збирає stdout
  контейнерів; пошук по `requestId`). JSON у stdout уже є — коду не змінюємо.
- **Фікс логера під контейнер:** зараз pino пише файли в `cwd/logs`, і `Dockerfile.node` спеціально
  створює цю теку для non-root юзера — це обхід симптому. У прод-режимі має лишатись **тільки
  stdout**, файловий sink — opt-in через `LOG_FILE` (сценарій «гола VM без оркестрації»).
- ~~**Наскрізний correlationId у чергах**~~ — **зроблено в EDA-1**: `correlationId` живе в
  конверті повідомлення (на HTTP-вході = pino `req.id`, він же `ApiError.requestId`),
  `MessageWorkerRegistrar` піднімає його в CLS + child-логер, похідні публікації успадковують
  його разом із `causationId`. Заодно `genReqId`: uuid замість pino-лічильника, який починався
  з 1 на кожному процесі.
- **`@nestjs/terminus`** health для обох api і воркера (зараз health — саморобний, у воркера немає
  зовсім, стан видно лише через `docker service ps`).
- **Env-валідація через Zod при старті** (fail-fast), rate limiting, helmet.
- **Тести:** Vitest для критичних фронтових флоу; уніфікація api-тестів Jest → Vitest (заодно
  прибере моки pg-boss/file-type через `moduleNameMapper`).

### 2.7. Дозрівання деплою до справжнього проду — [deploy-swarm.md](deploy-swarm.md)

Зараз працює **тестовий прод**: усе по http на IP:port, прикладні секрети свідомо в репо.
Що змінити перед реальним продом:

- `docker/deploy.env` і `docker/seaweedfs/s3.prod.json` → CI Variables (Protected+Masked),
  повернути в `.gitignore`;
- reverse-proxy з TLS перед стеком: web/platform-web/S3 назад на `127.0.0.1`, для S3 **зберігати
  Host** (він у SigV4-підписі), для `/socket.io` — `Upgrade`/`Connection` і idle timeout більший
  за `pingInterval + pingTimeout`;
- окремі prod-раннери і тег `deploy_prod` (зараз усе, включно з prod-job-ами, під `deploy_dev`);
- Deploy Token (`read_registry`) замість job-token — потрібен, щойно нод стане більше однієї;
- `deploy_prod` зняти з `when: manual`, коли піде реальний прод;
- регулярний бекап: `dump_db_prod` за розкладом + снапшот `${SAAS_DATA_DIR}` (postgres + seaweedfs
  бекапити узгоджено).

### 2.8. Беклог MT-4 — [multi-tenancy-architecture.md](multi-tenancy-architecture.md)

Invite-флоу першого адміна тенанта (зараз пароль задає оператор), піддомени як спосіб резолву
тенанта, глобальні довідники рівня 3, білінг-специфіка платформи. Робиться на вимогу, не в чергу.

### 2.9. Палітра команд (⌘K) — рівень ЗАСТОСУНКУ

Рішення 2026-09-08 (винесено з CAL-3, [calendar.md](calendar.md) §11.9): одне поле на
`Cmd+K` — перехід між area, пошук кастомерів і юзерів, швидке «створити …», навігація по
датах. Робиться ОДИН раз на весь застосунок, а не для календаря: «⌘K для календаря» був би
другим механізмом навігації поруч із наявними гарячими клавішами.

Готове до використання: примітив `command` у реєстрі `@shadcn` (`cmdk`) — у нас ще не
вендорений; хоткеї календаря (`use-calendar-hotkeys`) показують робочий патерн одного
слухача на `window` із фільтрами «фокус у полі» і «відкрита модалка».

Не в чергу — робиться, коли розділів стане більше і навігація «мишкою по рейлу» почне
відчуватись довгою.

### 2.10. AI-асистент: AI-1 і далі

AI-0 зроблено (див. таблицю §1): бічна панель довідки працює наскрізь на **фейковому
провайдері** — без ключа, без мережі й без витрат.

Наступне — [ai-assistant-plan.md](ai-assistant-plan.md) §9: **AI-1** (реальний
OpenAI-сумісний провайдер за вже наявним інтерфейсом `LlmProvider` + корпус знань рівня 1 у
`docs/ai-knowledge/` + квоти токенів + retention), далі AI-2 (знання рівня 2), AI-3 (метрики
й оцінки якості, потребує EDA-2), AI-4 (retrieval).

**Фази AI-1…AI-4 свідомо лишаються відкритими до перегляду** (§9.1 того ж доку): кожна
приєднується до одного наперед визначеного шва, тож переозначити їх можна, не переписуючи
нічого з AI-0. Деталізувати їх до того, як конвеєр покаже реальну поведінку на живому
провайдері, — це план, який доведеться переписувати.

---

## 3. Свідомо поза скоупом

Прибрано з roadmap 2026-08-02 — щоб план відображав реальні наміри, а не всі колись згадані опції.
Повернути можна будь-коли, історія в git.

| Пункт                                               | Чому не робимо                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes / Helm / DaemonSet-колектори             | Спосіб деплою зафіксовано — **Docker Swarm** single-node з ростом до кількох нод. Гілки «якщо K8s» більше не тримаємо               |
| OpenTelemetry (traces)                              | Латентність уже є в pino-логах (`responseTime`), Sentry + Loki покривають діагностику. Трасування — надлишок для поточного масштабу |
| ClamAV / антивірус для завантажень                  | Валідація — allowlist MIME + magic bytes; сканування вмісту не входить у скелетон                                                   |
| I18N-4: друга мова, language switcher, TMS (Tolgee) | Стартово тільки `en`. Механіка i18n готова; повертаємось до цього, коли зʼявиться реальна друга мова                                |
| Membership / Invitations як окремі сутності         | Скасовано на MT-1: `users.tenant_id NOT NULL`, юзер належить одному тенанту                                                         |
| Окремий `audit-log`-модуль                          | Перекривається Activity Log (`docs/activity-log.md`)                                                                                |

Single-tenant форк скелетона додаткової роботи не потребує: `tenant_id` є завжди, single-tenant —
це **N=1** тієї самої схеми (один рядок `Tenant`, control plane просто не деплоїться). `if (multiTenant)`
у коді немає.
