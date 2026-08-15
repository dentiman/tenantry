# Roadmap

Стан на **2026-08-15**. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md);
профільні деталі — у документах, на які посилається кожен рядок.

Документ описує **куди йдемо**. Історія «як робили» живе в шапці `CLAUDE.md` і в профільних
доках — тут завершені віхи лишені одним рядком, щоб було видно базу, на яку спирається план.

---

## 1. Зроблено

| Віха                     | Дата       | Що дала                                                                                                                            | Док                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Фаза 1 — фундамент**   | 2026-07-11 | Монорепо pnpm+Turborepo, ESLint/Prettier/Husky, CI; `libs/contracts` (Zod 4), `libs/database` (Prisma 7); auth + users end-to-end; конвеєр Zod → OpenAPI → orval → typed hooks; `apps/web` | `architecture-proposal.md`                             |
| **Фаза 2.1 — черги**     | 2026-07-11 | pg-boss v12 за власним `JobDispatcher`, `libs/shared` (`defineJob`, `@JobHandler`, `JobInboxService`), `apps/worker`, cron, транзакційний dispatch (замінено на EDA-1) | `architecture-proposal.md`                             |
| **Фаза 2.2 — помилки**   | 2026-07-12 | Наскрізний `ApiError`-envelope: `AllExceptionsFilter` → toast / fieldErrors у формах                                               | `error-handling.md`                                    |
| **I18N-1…3**             | 2026-07-12 | `libs/i18n` + react-i18next, коди помилок замість тексту з бекенда, `users.locale` і реальний welcome-лист локаллю юзера           | `i18n-plan.md`                                         |
| **DataGrid**             | 2026-07-13 | `createDataGrid` — фільтри/сортування/пагінація/selection декларативно; `/users`, `/jobs`                                          | `CLAUDE.md`                                            |
| **Files v1**             | 2026-07-14 | S3-сумісне сховище, двофазний presigned-upload, magic-bytes валідація, thumbnail у воркері, cron-очистка                            | `file-storage.md`                                      |
| **MT-0…MT-3**            | 2026-07-16…17 | Три ролі БД → tenant-фундамент → **RLS як основний enforcement** → control plane `apps/platform-api` + `apps/platform-web`      | `multi-tenancy-architecture.md`                        |
| **`pnpm db:reset`**      | 2026-07-17 | Один деструктивний dev-скрипт + зафіксовані seed-ідентичності                                                                       | `database-seed.md`                                     |
| **Activity Log**         | 2026-07-21 | Журнал бізнес-подій (`type`+`payload`, рендер через i18next), перший курсорний ендпоінт, sync/async-запис                          | `activity-log.md`                                      |
| **Деплой у Swarm + CI**  | 2026-07-24…31 | GitLab CI: build 6 образів → `docker stack deploy` через docker-context по SSH (нуль файлів на сервері); dev-стек `saas-dev` живий на 172.18.13.101; manual `db_roles`/`seed`/`dump` | `deploy-swarm.md`                                      |
| **EDA-0 + EDA-1**        | 2026-08-04 | Єдиний конвеєр асинхронних повідомлень замість `libs/shared/src/jobs/`: подія/команда, конверт (`messageId`/`correlationId`/`causationId`/`actor`), маніфест `MESSAGE_TOPOLOGY` із fan-out-ом на публікації, inbox по бізнес-факту, спільна DLQ, boot-assert топології | `event-driven-architecture.md`                         |
| **Realtime**             | 2026-08-15 | Socket.IO-гейтвей (websocket-only) + Valkey як Redis Streams adapter; socket-auth спільна з HTTP, tenant-ізоляція, presence на distributed leases (`GET /api/presence` + delta з ревізіями), online-badge на `/users` | `realtime.md`, `realtime-internals.md`                 |

Проєктні документи без реалізації (готові до роботи):
[tenant-settings.md](tenant-settings.md), беклог MT-4 у `multi-tenancy-architecture.md`,
фази EDA-2…EDA-4 у [event-driven-architecture.md](event-driven-architecture.md).

---

## 2. Наступні кроки (у порядку пріоритету)

### 2.1. In-app сповіщення — [realtime.md](realtime.md)

Realtime-транспорт уже працює (гейтвей, presence, ізоляція, деплой — див. `realtime.md`),
тому це доменна робота поверх готового шару, а не інфраструктурна. Вона ж **EDA-4**:
realtime стає звичайним підписником у `MESSAGE_TOPOLOGY`, окремого механізму не заводимо
([event-driven-architecture.md](event-driven-architecture.md) §3.12).

Обсяг: таблиця `notifications` (tenant-скоуп + RLS), REST список/лічильник непрочитаних/
позначити прочитаним, закритий перелік типів і структурований payload (текст рендерить
фронт через i18next, як `activities`), підписник `realtime` + міст із воркера через стрім
`realtime.dispatch`, подія `notification.created.v1` з одним лише ідентифікатором, bell-меню
в UI. Плюс операційний хвіст realtime — масштабування і rolling update на живому стеку,
навантажувальний профіль, метрики (перелік — у `realtime-internals.md`).

### 2.2. Налаштування тенанта (System Settings) — [tenant-settings.md](tenant-settings.md)

Перша вертикаль — секція `general` (name + currency), редагована з обох plane-ів, плюс
`GET /system-settings/bootstrap` для «гарячих» налаштувань фронта. Звуження редактора до ADMIN —
разом із RBAC.

### 2.3. RBAC

Мапа role → permissions у `libs/contracts`, `@RequirePermissions('tickets:write')` + guard.
Ставиться поверх готового tenant-контексту; блокує «правильне» закриття доступів у
system-settings і доменних модулях.

### 2.4. Доменні модулі (еталони для форків)

Усі три пишуться вже на шарі `messaging` (EDA-1): асинхронна робота — тільки через
`defineEvent`/`defineCommand` + рядок у `MESSAGE_TOPOLOGY`, другого шляху немає.

1. `customers` — зразковий CRUD (пишеться вже **без згадок tenantId**: MT невидима для домену).
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

---

## 3. Свідомо поза скоупом

Прибрано з roadmap 2026-08-02 — щоб план відображав реальні наміри, а не всі колись згадані опції.
Повернути можна будь-коли, історія в git.

| Пункт                                    | Чому не робимо                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Kubernetes / Helm / DaemonSet-колектори  | Спосіб деплою зафіксовано — **Docker Swarm** single-node з ростом до кількох нод. Гілки «якщо K8s» більше не тримаємо |
| OpenTelemetry (traces)                   | Латентність уже є в pino-логах (`responseTime`), Sentry + Loki покривають діагностику. Трасування — надлишок для поточного масштабу |
| ClamAV / антивірус для завантажень       | Валідація — allowlist MIME + magic bytes; сканування вмісту не входить у скелетон                                     |
| I18N-4: друга мова, language switcher, TMS (Tolgee) | Стартово тільки `en`. Механіка i18n готова; повертаємось до цього, коли зʼявиться реальна друга мова        |
| Membership / Invitations як окремі сутності | Скасовано на MT-1: `users.tenant_id NOT NULL`, юзер належить одному тенанту                                       |
| Окремий `audit-log`-модуль               | Перекривається Activity Log (`docs/activity-log.md`)                                                                  |

Single-tenant форк скелетона додаткової роботи не потребує: `tenant_id` є завжди, single-tenant —
це **N=1** тієї самої схеми (один рядок `Tenant`, control plane просто не деплоїться). `if (multiTenant)`
у коді немає.
