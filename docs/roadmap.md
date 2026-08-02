# Roadmap

Стан на **2026-08-02**. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md);
профільні деталі — у документах, на які посилається кожен рядок.

Документ описує **куди йдемо**. Історія «як робили» живе в шапці `CLAUDE.md` і в профільних
доках — тут завершені віхи лишені одним рядком, щоб було видно базу, на яку спирається план.

---

## 1. Зроблено

| Віха                     | Дата       | Що дала                                                                                                                            | Док                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Фаза 1 — фундамент**   | 2026-07-11 | Монорепо pnpm+Turborepo, ESLint/Prettier/Husky, CI; `libs/contracts` (Zod 4), `libs/database` (Prisma 7); auth + users end-to-end; конвеєр Zod → OpenAPI → orval → typed hooks; `apps/web` | `architecture-proposal.md`                             |
| **Фаза 2.1 — черги**     | 2026-07-11 | pg-boss v12 за власним `JobDispatcher`, `libs/shared` (`defineJob`, `@JobHandler`, `JobInboxService`), `apps/worker`, cron, транзакційний dispatch | `architecture-proposal.md`                             |
| **Фаза 2.2 — помилки**   | 2026-07-12 | Наскрізний `ApiError`-envelope: `AllExceptionsFilter` → toast / fieldErrors у формах                                               | `error-handling.md`                                    |
| **I18N-1…3**             | 2026-07-12 | `libs/i18n` + react-i18next, коди помилок замість тексту з бекенда, `users.locale` і реальний welcome-лист локаллю юзера           | `i18n-plan.md`                                         |
| **DataGrid**             | 2026-07-13 | `createDataGrid` — фільтри/сортування/пагінація/selection декларативно; `/users`, `/jobs`                                          | `CLAUDE.md`                                            |
| **Files v1**             | 2026-07-14 | S3-сумісне сховище, двофазний presigned-upload, magic-bytes валідація, thumbnail у воркері, cron-очистка                            | `file-storage.md`                                      |
| **MT-0…MT-3**            | 2026-07-16…17 | Три ролі БД → tenant-фундамент → **RLS як основний enforcement** → control plane `apps/platform-api` + `apps/platform-web`      | `multi-tenancy-architecture.md`                        |
| **`pnpm db:reset`**      | 2026-07-17 | Один деструктивний dev-скрипт + зафіксовані seed-ідентичності                                                                       | `database-seed.md`                                     |
| **Activity Log**         | 2026-07-21 | Журнал бізнес-подій (`type`+`payload`, рендер через i18next), перший курсорний ендпоінт, sync/async-запис                          | `activity-log.md`                                      |
| **Деплой у Swarm + CI**  | 2026-07-24…31 | GitLab CI: build 6 образів → `docker stack deploy` через docker-context по SSH (нуль файлів на сервері); dev-стек `saas-dev` живий на 172.18.13.101; manual `db_roles`/`seed`/`dump` | `deploy-swarm.md`                                      |

Проєктні документи без реалізації (готові до роботи): [realtime.md](realtime.md),
[tenant-settings.md](tenant-settings.md), беклог MT-4 у `multi-tenancy-architecture.md`.

---

## 2. Наступні кроки (у порядку пріоритету)

### 2.1. Realtime (RT-0 → RT-3) — [realtime.md](realtime.md)

Найближча вертикаль. Деплой уже відомий, тому документ переглянуто під Swarm
(§ «Що змінив відомий деплой» у `realtime.md`): транспорт **websocket-only** (sticky sessions не
потрібні), Valkey — окремий сервіс стеку, `wss` — разом із TLS-проксі, не раніше.

1. **RT-0 — інфраструктурний spike (гейт).** Valkey у dev-compose і в swarm-стеку, Socket.IO +
   Redis Streams adapter, `/socket.io` у nginx-шаблоні й Vite dev-proxy. Довести cross-instance
   emit на `docker service scale saas-dev_api=2`, пережити рестарт Valkey.
2. **RT-1 — безпечний gateway.** Zod-контракти подій, socket-auth (той самий сервіс перевірки JWT,
   що й HTTP-guard), tenant/user rooms, CLS на кожну подію, graceful shutdown, singleton-клієнт на фронті.
3. **RT-2 — presence.** Leases у Valkey + Lua + sweeper, `GET /api/presence` (snapshot+revision),
   `presence.changed.v1`, online-badge на `/users`.
4. **RT-3 — in-app notifications.** Довговічна таблиця + RLS, REST list/unread/read, bell UI,
   `notification.created.v1`, міст із воркера через `realtime.dispatch`.

### 2.2. Налаштування тенанта (System Settings) — [tenant-settings.md](tenant-settings.md)

Перша вертикаль — секція `general` (name + currency), редагована з обох plane-ів, плюс
`GET /system-settings/bootstrap` для «гарячих» налаштувань фронта. Звуження редактора до ADMIN —
разом із RBAC.

### 2.3. RBAC

Мапа role → permissions у `libs/contracts`, `@RequirePermissions('tickets:write')` + guard.
Ставиться поверх готового tenant-контексту; блокує «правильне» закриття доступів у
system-settings і доменних модулях.

### 2.4. Доменні модулі (еталони для форків)

1. `customers` — зразковий CRUD (пишеться вже **без згадок tenantId**: MT невидима для домену).
2. `tickets` — статусний workflow, коментарі, події → черга; перший реальний споживач activities.
3. `billing` — Plan/Subscription/Invoice, інтерфейс `PaymentProvider`, fake-провайдер → Stripe,
   webhooks через чергу (ідемпотентність по `event_id UNIQUE`).

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

- **Error tracking — Sentry або self-hosted GlitchTip** (SDK-сумісний): умовна ініціалізація по
  `SENTRY_DSN` у `main.ts` api/platform-api/worker + `captureException` у гілці ≥500
  `AllExceptionsFilter` (tag `requestId`). Deployment-агностично, можна робити будь-коли.
- **Агрегація логів — Grafana Loki + Alloy** як сервіс того самого swarm-стеку (збирає stdout
  контейнерів; пошук по `requestId`). JSON у stdout уже є — коду не змінюємо.
- **Фікс логера під контейнер:** зараз pino пише файли в `cwd/logs`, і `Dockerfile.node` спеціально
  створює цю теку для non-root юзера — це обхід симптому. У прод-режимі має лишатись **тільки
  stdout**, файловий sink — opt-in через `LOG_FILE` (сценарій «гола VM без оркестрації»).
- **Наскрізний correlationId у чергах:** `req.id` з pino-http не доїжджає до воркера.
  `JobDispatcher.send` бере requestId з CLS і кладе службовим полем поруч із payload,
  `JobWorkerRegistrar` знімає його в `JobContext` + child-логер.
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
