# SaaS Skeleton — CLAUDE.md

Форк-скелетон для мультитенантних CRM/ERP-систем (білінг, кастомери, тікети, черги).
Базові патерни портовані з `/Users/dentiman/dev/projects/fibo-admin` і розширені.
**Фаза 1 завершена і перевірена** (2026-07-11): монорепо, auth + users end-to-end, конвеєр контрактів, CI.
**Фаза 2.1 завершена і перевірена** (2026-07-11): pg-boss + `libs/shared` (JobDispatcher/@JobHandler) + `apps/worker` (шар замінено на `messaging/` в EDA-1, див. нижче).
**Фаза 2.2 завершена і перевірена** (2026-07-12): наскрізна обробка помилок — ApiError envelope + AllExceptionsFilter + toast + fieldErrors у форми.
**I18N-1 завершена і перевірена** (2026-07-12): `libs/i18n` + react-i18next в адмінці, усі рядки UI винесені в ключі.
**I18N-2 завершена і перевірена** (2026-07-12): FieldError.code + переклад toast/fieldErrors/Zod-повідомлень на фронті.
**I18N-3 завершена і перевірена** (2026-07-12): `users.locale` у БД, реальна відправка welcome-email через Mailpit локаллю юзера (закрито й давній пункт фази 2).
**DataGrid-фільтри завершені і перевірені** (2026-07-13): фільтри гріда декларуються масивом (як columns), Search→Filters перейменування, /jobs мігровано на DataGrid (+сортування).
**Files v1 завершена і перевірена** (2026-07-14): S3-сумісне сховище (dev: SeaweedFS у compose), двофазний presigned-upload, magic-bytes валідація, thumbnail (sharp у worker), cron-очистка PENDING, демо — аватар користувача на /users. Перевірено живим прогоном: PUT у SeaweedFS, CORS preflight, відхилення підробленого MIME.
**`pnpm db:reset` завершений і перевірений** (2026-07-17): один деструктивний dev-скрипт
(`libs/database/scripts/reset-db.ts`) — DROP+CREATE DATABASE (як суперюзер, `WITH (FORCE)` рве
активні конекшени) → `db:roles` → `db:migrate:deploy` → `db:seed`; відмовляється працювати
проти нелокального host. **Свідомо НЕ `prisma migrate reset`**: той дропає/перестворює лише
схему `public`, а `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` (`ensure-roles.ts`)
прив'язаний до OID схеми — новий OID після перестворення інвалідує грант, і `saas_app`
лишається без прав на щойно замігровані таблиці; DROP/CREATE усієї БД цього уникає, а ролі й
default-privileges `ensure-roles.ts` перевстановлює явно й ідемпотентно. Дефолтні сід-дані
(`libs/database/prisma/seed.ts`, вже існували з MT-1/MT-3, тепер задокументовані явно):
tenant `slug=default` + tenant-адмін `admin@example.com`/`Admin12345` + platform-оператор
`platform@example.com`/`Platform12345` — обидва upsert, ідемпотентні. Перевірено живим
прогоном: `pnpm db:reset` на dev-БД → усі 7 міграцій застосувались чисто → `saas_app` бачить
свій tenant тільки з контекстом (fail-closed без) і НЕ має прав на `platform_users`
(`permission denied`, не порожній результат) → `saas_platform` бачить усе → логін в обох API
з дефолтними кредами відпрацював.
**apps/platform-web завершений і перевірений** (2026-07-17): UI control plane — клон каркасу `apps/web` (Vite/TanStack Router+Query/Zustand/react-i18next/orval, порт 5174, проксі на :3002; UI-бібліотека тоді була інша — переїзд на shadcn/ui див. `docs/frontend/ui-migration-history.md`). `data-grid/`, `form/`, `theme-switcher.tsx`, `api-error.ts` скопійовані БЕЗ ЗМІН (generic, спільний `ApiError`-конверт). Сторінки: **Tenants** (`/`) — плоска таблиця (НЕ `createDataGrid`: `GET /tenants` без пагінації/фільтрів, заводити фейкову route-search-схему заради переюзання гріда було б зайвим) + `CreateTenantModal` + suspend/resume через `AlertDialog`; **Jobs** (`/jobs`) — перенесено з tenant-web 1:1 (контракт не змінювався, переїхав тільки хост). Auth-стор — свідомий trade-off: access-токен (60m, без refresh) напряму в localStorage, а не тільки в пам'яті (як tenant-web) — інакше сесія губилася б на F5. Грабля: **vite/rollup резолвить workspace-субпаті через `package.json` `exports`, а НЕ через tsconfig `paths`/webpack alias** — `@saas-skeleton/contracts/platform` падав у build із «Rollup failed to resolve import», доки `libs/contracts/package.json` не отримав явний `exports: { ".": ..., "./platform": ... }` (tsc і webpack цю мапу ігнорують, тому раніше проблема не проявлялась). Перевірено живим прогоном у браузері: login оператором → реальний список тенантів із БД → New tenant через форму створює tenant+admin атомарно → Suspend/Resume з AlertDialog-підтвердженням → сесія переживає F5 → Jobs показує реальні джоби з попередніх фаз; консоль без помилок; `pnpm build` 6/6 таргетів.
**MT-3 завершена і перевірена** (2026-07-17): control plane — `apps/platform-api` (порт 3002). Окрема identity `platform_users` (міграція робить `REVOKE ALL FROM saas_app` — tenant-api її навіть не читає), **окремий `PLATFORM_JWT_SECRET`** (без фолбека — токени plane-ів не крос-валідні, перевірено 401 в обидва боки), роль `saas_platform` через `SystemPrismaModule` (TenancyModule/PrismaModule у графі ВІДСУТНІ — §6 плану). Гейт дотримано: **`/jobs` переїхав ПЕРЕД CRUD тенантів** (модуль цілком + web-сторінка/роут/i18n видалені; у tenant-api /jobs → 404). CRUD тенантів: create = `Tenant` + перший admin (пароль від оператора) в одній транзакції, suspend/resume → login у data plane 401. **Slug-login працює end-to-end**: поле `tenant` у Login → `SlugTenantResolver` → `resolve_tenant(slug)`; web — опційне поле Organization. Контракти — `@saas-skeleton/contracts/platform` (subpath, НЕ реекспортується з index; свій openapi.json). `AllExceptionsFilter` переїхав у `libs/shared/errors` (обидва plane-и; subpath-імпорт, щоб не тягнути pg-boss/aws-sdk). Тести: 63 tenant e2e + 11 platform e2e. Живий прогін: operator login → create tenant → slug-login у нього → бачить ЛИШЕ себе; suspend → 401. Граблі: (1) **paths у app-tsconfig мертві** (extends ЗАМІНЮЄ paths, а успадкований baseUrl вказує на корінь репо; резолюція йшла через node_modules-симлінки, subpath так не працює) → у platform-api власний `baseUrl: "."`; (2) **звірка guard-ом «токен vs резолвлений tenant» мусить бути умовною** — введено `TenantResolution.authoritative` (Static/піддомен — завжди; slug — лише коли slug присутній; інакше авторитет у підписаного токена), без цього легальний токен tenant-а B падав на fallback-контексті A.
**MT-2 завершена і перевірена** (2026-07-16): RLS увімкнено — ізоляція тенантів стала enforcement-ом БД. Політики `tenant_isolation` (FOR ALL, USING+WITH CHECK, `(SELECT nullif(current_setting('app.tenant_id', true), ''))` — InitPlan) + ENABLE/FORCE на users/refresh_tokens/files/attachments; `tenants` — політика `own_tenant` БЕЗ FORCE (свідомо: `resolve_tenant(slug)` — SECURITY DEFINER від власника, FORCE осліпив би її); `resolve_tenant()` з `SET search_path`, EXECUTE тільки saas_app (перебір тенантів неможливий). Сід → під `saas_platform` (upsert tenant-а під saas_app падав би на WITH CHECK). Тести: e2e тепер 67 (6 сьютів) — прямі prisma-доступи тестів переведені на `SystemPrismaService` (BYPASSRLS; під saas_app поза CLS вони бачили б 0 рядків), `setup-env.ts` ПЕРЕЗАПИСУЄ `PLATFORM_DATABASE_URL` на тестову БД (інакше тести чистили б dev!); нові `rls.e2e-spec` (fail-closed 0 рядків без контексту, INSERT падає на політиці, transaction-local set_config, авточек `pg_policies` — ловить «забули політику», працює в CI без окремого кроку) і `tenant-isolation.e2e-spec` (list A не бачить B; get/patch/delete чужого ID → 404; JWT tenant-а B у контексті A → 401 від guard-звірки; CLS-конкурентність runWith A/B без перетікання; login юзера B у контексті A → 401). Живий прогін під RLS: login → create user → fan-out → welcome-лист (handler читає юзера крізь tenant-CLS). Доменний код у фазі НЕ змінювався.
**MT-1 завершена і перевірена** (2026-07-16): мультитенантний фундамент БЕЗ RLS (вмикається у MT-2). `Tenant`/`tenants` + `tenant_id NOT NULL` на users/refresh_tokens/files/attachments (експанд→бекфіл→NOT NULL, композитні FK, tenant-префіксні індекси); `TenancyModule.forRoot({ resolver })` у `libs/database/src/tenant/` (CLS + StaticTenantResolver + middleware на всі роути включно з @Public); PrismaService = tenant-extended клієнт (batch-tx `set_config` на кожну операцію; голий клієнт — токен `PRISMA_BASE`); `tenant_id` заповнює DB-default `nullif(current_setting('app.tenant_id'),'')` + `@default(dbgenerated(...))` у схемі (робить поле опційним у Prisma-типах — доменний код його НЕ передає); транзакції — ТІЛЬКИ `TenantTransactions.withTenantTx` (голий `$transaction` заборонено ESLint-ом, бо обходить extension); черги: `defineTenantJob` (схема примусово + tenantId), dispatcher домішує tenantId з CLS, registrar піднімає CLS з payload, дві cron-джоби — scope system під `SystemPrismaService` (BYPASSRLS); `POST /auth/register` видалено ЗОВСІМ (+web-сторінка, контракти, orval); login перевіряє `tenant.isActive`; refresh-токен `tenantId:tokenId:secret`; JWT += tenantId (з рядка БД); tenantId у кожному лог-записі (pino mixin з CLS). Перевірено: 57 e2e, живий фан-аут create user → payload обох джоб з tenantId → worker CLS → welcome-лист; tenantId НЕ витікає у відповіді API. Граблі, спіймані наживо: (1) **Zod 4 `z.uuid()` — строгий RFC** (version-ніббл): well-known id тенанта мусив стати `00000000-0000-4000-8000-000000000001`; (2) **pg-boss install робить `CREATE SCHEMA IF NOT EXISTS`, а Postgres перевіряє ACL ДО існування** → saas_app потребує `GRANT CREATE ON DATABASE`; (3) дві вимушені правки домену (НЕ tenant-логіка): `users.service` findUnique(email)→findFirst (unique тепер композитний), `files.service` buildKey→`storage.buildObjectKey` (tenant-префікс живе в інфрі).
**MT-0 завершена і перевірена** (2026-07-16): три ролі Postgres (`saas_migrator` — власник схеми/міграції з CREATEDB під shadow-DB; `saas_app` — runtime api/worker БЕЗ DDL і BYPASSRLS; `saas_platform` — BYPASSRLS під майбутній control plane). Свіжий volume — `docker/postgres/init/01-roles.sql`; наявна БД/CI/тестова — ідемпотентний `pnpm db:roles` (переприсвоює і власників наявних таблиць, включно з pgboss). `MIGRATE_DATABASE_URL` (prisma.config.ts БЕЗ фолбека на DATABASE_URL — міграція під saas_app має впасти, а не пройти тихо); схема pgboss належить saas_app (pg-boss сам мігрує свої таблиці). Перевірено: свіжий init у throwaway-контейнері, db:roles на живій dev-БД, негативний DDL-тест під saas_app, 61 e2e, живі worker (5 хендлерів) і api (login).
**Activity Log завершений і перевірений** (2026-07-21): журнал бізнес-подій (`docs/activity-log.md`) —
перша реалізація за спецою. Дві таблиці `activities`+`activity_links` (поліморфні лінки як `attachments`,
композитний FK, RLS ENABLE/FORCE за шаблоном MT-2), текст НЕ зберігається — `type`(закритий enum)+`payload`,
рендерить фронт через i18next (i18n-доктрина). `ActivityRecorder` у `libs/shared` (@Global, `record(tx, …)` —
tx перший обовʼязковий аргумент, tenant_id із DB-default CLS, fail-fast валідація payload по типу).
**Перший курсорний ендпоінт** `GET /activities` (keyset `(createdAt,id) DESC`, base64url-курсор, `limit+1`).
Sync-запис: `UsersService.create` переїхав у `withTenantTx` (юзер+активність+fan-out job атомарно; try/catch
«черга некритична» прибрано; контролер передає `@CurrentUser()`). Async-запис: `WelcomeEmailHandler` пише
`email.sent` через `inbox.runOnce` ПІСЛЯ `sendMail` (exactly-once відносно job-а, актор=система). Web: `ActivityDrawer`
(`Sheet`, «Load more» з накопиченням у стані) + `ActivityMessage` (`<Trans>`, generic-fallback на невідомий
тип) + row action «View activity» на `/users`; namespace `activities` у `libs/i18n` (спільний фронтовий — ключі
вкладені, бо `.` у типах = i18next-роздільник). Граблі: (1) **не мішати скалярний `tenantId` з вкладеним
`links.create`** у прямому Prisma-сіді тестів — nested write → checked input, скаляр недоступний (два unchecked-виклики);
(2) `payload as InputJsonValue` — зайва асерція (receiver і так приймає). 69 tenant-e2e (+6: create-records-one,
feed-by-entity, filter-by-type, cursor-no-dupes, bad-cursor-400, recorder-unit) + 11 platform-e2e; lint/typecheck/build
чисті. Живий прогін: create user → `user.created` одразу + `email.sent` після воркера + лист у Mailpit.
**Деплой завершений і перевірений** (2026-07-24…31): GitLab CI → Docker Swarm. Build 6 образів
(`Dockerfile.node` × api/platform-api/worker, `Dockerfile.web` × web/platform-web, `Dockerfile.tools`)
→ `docker stack deploy` через **docker-context по SSH** — на сервер не копіюється жоден файл
(stack читається на раннері, `${...}` інтерполюються з оточення job-а). Стеки `saas-dev` (гілка
`dev`, живий на 172.18.13.101) і `saas-prod` (`main`, manual). Тестовий прод: усе по **http на
IP:port** без reverse-proxy (web :8511, platform-web :8512, S3 :8503 — `mode: host`; api/platform-api
портів НЕ публікують — nginx у контейнері web проксить `/api` по overlay), прикладні секрети
свідомо в комітнутому `docker/deploy.env`. Міграції — в entrypoint api (`saas_migrator` →
старт під `saas_app`); `db_roles`/`seed`/`dump` — manual one-shot джоби через `Dockerfile.tools`.
Граблі: `host_ip` не підтримується схемою stack deploy; `configs.file` резолвиться відносно теки
compose-файлу; для сервісів із host-портом `start-first` НЕМОЖЛИВИЙ (новий таск вічно Pending —
тільки `stop-first`); shell-executor раннера не чистить BuildKit-кеш сам (19.7GB за кілька
пайплайнів → ENOSPC; додано `after_script` з prune). Деталі — `docs/deploy-swarm.md`.
**Деплой посилено після тихого провалу** (2026-08-29): `stack deploy` лише СТАВИТЬ завдання —
образи тягне swarm-агент асинхронно, тож будь-яка невдача pull-а дає `Rejected: No such image`
і `failure_action: rollback` мовчки повертає старий образ, **а джоба лишається зеленою**.
Спіймано двічі поспіль на `saas-dev`: (1) `/var/lib/docker` на 100% від історії білдів
СУСІДНІХ проєктів (раннер і manager — одна машина) → `no space left on device`; (2) креди
протухли разом із джобою → `unauthorized: HTTP Basic: Access denied`, бо `--with-registry-auth`
роздавав нодам **job-token**, дійсний лише поки живе job. Щоразу оновлювалась лише частина
сервісів — хто встиг спулити першим, і стек лишався у змішаному стані. Три запобіжники в
`.deploy_base`: Deploy Token (`read_registry`, змінні `REGISTRY_DEPLOY_USER/PASSWORD`; без них
фолбек на job-token із warning) + синхронний передпул образів у межах джоби (fail-fast, ДО
`stack deploy`) + пост-перевірка фактичного `ContainerSpec.Image` кожного сервісу проти
щойно зібраного тега (`exit 1` при розбіжності); плюс `--detach=false`. Деталі — `docs/deploy-swarm.md` §6.
**EDA-0/EDA-1 завершені і перевірені** (2026-08-04): шар черг перебудований у єдиний конвеєр
повідомлень — `libs/shared/src/jobs/` ВИДАЛЕНО цілком, натомість `libs/shared/src/messaging/`.
Два примітиви (`defineEvent` з обовʼязковою `.vN` у типі імені / `defineCommand`) поверх ОДНОГО
рантайму: спільний конверт (`messageId`, `correlationId`, `causationId`, `actor`, `tenantId`),
спільний runner, inbox, спільна `dlq`. **Fan-out робить `publish`, а не хендлер**: список
підписників живе в статичному маніфесті `MESSAGE_TOPOLOGY`, один `publish(tx, …)` → по job-у в
чергу кожного споживача (`{message}/{consumer}`) у ТІЙ САМІЙ транзакції, послідовно й fail-fast
(рідний `boss.publish` ковтає часткову відмову через `Promise.allSettled` — тому не він).
Розсинхрон маніфесту і класів `@MessageSubscriber` = **краш при старті воркера**, не тихо
недоставлені повідомлення. Ідемпотентність переїхала з job-а на бізнес-факт:
`runOnce(envelope, consumerId, fn)`, ключ `messageId:consumerId`. `UserRegisteredHandler`
(рукописний fan-out) видалений цілком; thumbnail і 2 cron лишилися командами, але переїхали на
той самий конвеєр — другого шляху виконання асинхронної роботи в системі не лишилося.
Граблі: (1) **роздільник черги `/`, а не `#`** — pg-boss `assertQueueName` приймає лише
алфавітно-цифрові, `_`, `-`, `.`, `/`; `#` валив старт воркера, а мок pg-boss у e2e цього не
ловить (валідація імені тепер є і в маніфесті); (2) **політику черги `updateQueue` змінити не
дає** (`Omit<Queue, 'name'|'partition'|'policy'>`) — при drift лише warn; (3) дефолт `req.id` у
pino-http — лічильник від 1 на КОЖНОМУ процесі, тому доданий `genReqId` (uuid + повага до
`X-Request-Id`): цей id тепер їде `correlationId`-ом у довговічні job-рядки. Перевірено живим
прогоном + 16 нових e2e (маніфест, boot-assert розсинхрону, inbox). Деталі —
`docs/event-driven-architecture.md`.
**Realtime завершений і перевірений** (2026-08-15): Valkey 8 (сервіс compose + стеку, порт у
стеку НЕ публікується, `noeviction`, без персистентності) як брокер
`@socket.io/redis-streams-adapter` і сховище presence-leases. Socket.IO **websocket-only**
(`transports: ['websocket']` — sticky sessions не потрібні, Docker VIP балансує по TCP),
namespace `/tenant`, `location /socket.io/` у nginx-шаблоні + `ws: true` у Vite-проксі.
Gateway (`apps/api/src/realtime/`) живе в кожній репліці api на тому самому HTTP-сервері;
handshake бере токен із Socket.IO `auth` і перевіряє його **тим самим `AccessTokenService`,
що й `JwtAuthGuard`** (правила auth не мають розходитись між транспортами), далі —
`isActive` юзера і тенанта в явному `TenantContextService.runWith` (HTTP-middleware CLS для
сокета не піднімає). Цикл довгого зʼєднання: `auth.expiring.v1` → фронт викликає ТОЙ САМИЙ
single-flight `refreshTokens()` → `auth.update.v1` з ack; новий токен з іншим sub/tenantId/role
відхиляється (`IDENTITY_CHANGED`). `connectionStateRecovery.skipMiddlewares: false` —
обовʼязково, інакше заблокований юзер відновив би сесію без перевірки. Presence: локальна
мапа вкладок у памʼяті ноди + lease пари `(user, apiNode)` у Valkey (5 Lua-скриптів,
атомарні переходи, hash tag `{tenantId}` = один slot), `nodeId` — boot UUID (НЕ hostname:
під `start-first` два таски api співіснують), heartbeat batch-ом на тенант, sweeper на
КОЖНІЙ ноді без лідера (ідемпотентність дає `SREM`, який повертає 1 рівно раз), drain
leases на `SIGTERM` (додано `app.enableShutdownHooks()`). Lease звільняється МИТТЄВО лише на
`client namespace disconnect`; `transport close`/`ping timeout` невідрізнювані від зниклої
мережі — там догорає по TTL (бюджет offline = `leaseTtl + sweepInterval` = 65 с на дефолтах).
Snapshot — `GET /api/presence` (`onlineUserIds`+`revision`+`generatedAt`), delta —
`presence.changed.v1`; фронт тримає snapshot у TanStack Query, а socket його ПАТЧИТЬ за
правилом трьох ревізій (`<=` ігнор, `+1` застосувати, `>+1` → resync). Недоступний брокер →
**503, а не порожній список** (порожній читався б як «всі offline»); `PresenceDot` рендериться
ТІЛЬКИ для online (offline і `isUnknown` — без крапки: бачиш крапку — юзер онлайн),
тост придушено `meta.silentError`. Клієнт — singleton ПОЗА
React-деревом (StrictMode створив би другий socket), `socket.disconnect()` на `pagehide`.
Граблі: (1) **приватний метод не можна називати `handleDisconnect`** — Nest шукає хук на
інстансі за іменем (`private` у TS не заважає), підписує сам і кличе з одним аргументом:
приходили ДВА виклики (перший із `reason === undefined`), перший знімав сокет із обліку,
другий не знаходив — lease не звільнявся ніколи; (2) `blockTimeInMs` адаптера = час виходу
процесу (дефолтні 5 с додавались до кожного SIGTERM) → знижено до 1 с; (3) порт 6379 на
dev-машині часто зайнятий іншим проєктом → `REDIS_PORT` у compose + відповідний `REDIS_URL`.
Тести: 96 tenant-e2e (+11 realtime: handshake, чужий секрет, деактивований юзер, дві вкладки,
ревізії, крос-tenant ізоляція snapshot-у і delta, детермінований lease expiry через store з
TTL 50 мс). CI отримав сервіс `valkey`. Перевірено живим прогоном на ДВОХ процесах api
(:3001 і :3011) проти однієї Valkey — cross-instance emit 10/10 — і в браузері: бейдж на
`/users` перемкнувся online→offline від дельти з іншого інстанса без перезавантаження.
Огляд — `docs/realtime.md`, механіка — `docs/realtime-internals.md`.
**In-app сповіщення (EDA-4) завершені і перевірені** (2026-08-16): персональний інбокс за
`docs/notifications.md` (V1 «інбокс»). Три таблиці — `notifications` (мутабельний рядок:
`read_at`/`archived_at`/колапс, на відміну від append-only `activities`),
`notification_states` (`seen_at` + `revision`), `notification_preferences`; усі три з
RLS ENABLE/FORCE за шаблоном MT-2. Текст НЕ зберігається (`type`+`payload`, як activities),
фронт САМ будає посилання на сутність із `{kind,id}` через реєстр `entity-routes.ts` і
вкладає його в текст (`<b>` — акцент, `<a>` — сутність). **Колапс — частковий унікальний
індекс** `(tenant_id, recipient_id, group_key) WHERE group_key IS NOT NULL AND read_at IS
NULL AND archived_at IS NULL` + `INSERT … ON CONFLICT` (Prisma-upsert частковий індекс як
арбітр не бере): доки не прочитано — `group_count++`, прочитав — наступна подія починає
нову групу. Бейдж рахує `newCount` (непрочитані з `updated_at > seen_at`), а не
`unreadCount` — інакше там вічно висіло б «47». **Емісія — after-commit хук у
`withTenantTx`** (`WeakMap` по обʼєкту `tx`, не CLS): до коміту клієнт побачив би стан
«до», а через pg-boss це були б секунди polling-у — тому підписника `realtime` у
`MESSAGE_TOPOLOGY` НЕМАЄ (переглянуто §3.12 EDA). **Міст воркер→браузер — headless
Socket.IO `Server`** без `listen()` на тому самому Valkey-адаптері (`realtime.dispatch`
не заводили); імена room-ів і ключів стріму переїхали в `libs/contracts` — їх формують
два процеси. Адресацію («кому») робить домен через `recipientsByRole`, а «не собі» і
преференси — recorder (властивості інбокса, не домену). UI: дзвінок із бейджем + Drawer

- **тост у стилі macOS**. Тост і рядок у центрі — **один компонент** `NotificationCard`
  (× у лівому верхньому куті, ⋯ у правому; × у тості ховає, × у центрі архівує; `role="button"`
  лише в тості — у центрі всередині є лінк на сутність). Черга тостів окрема, **зверху
  справа під дзвінком**, зміщена вниз на висоту хедера; тости API-помилок переїхали
  **вниз-праворуч** — два регіони, щоб подія і невдала дія не витісняли одна одну.
  Попередній тост закривається явно, при відкритій панелі не показується, тільки на живу
  подію — не на resync; стан панелі — Zustand `notification-ui.store`, бо його читає код
  поза React.
  **Сирий SQL — ТІЛЬКИ колапс**
  (частковий індекс недосяжний з Prisma-API); `notification_states`/`_preferences` ідуть
  звичайним `prisma.upsert` із явним `tenantId` (композитний PK — інакше не скласти `where`;
  для інфра-сервісу це легально, як у `PresenceController`). Спроба писати їх сирим SQL
  відкинута: Prisma дає рівно той самий `INSERT … ON CONFLICT … SET revision = revision + $n`
  (перевірено логом Postgres) — атомарність та сама, типізації більше.
  Перевірено живим прогоном (api+worker+web): бейдж без
  перезавантаження, welcome із воркера в сокет, sync прочитаного між вкладками,
  `summary.revision` == revision із події, лист у Mailpit; 124 tenant-e2e (+21) і 11 platform-e2e.
  **Last seen (RT-3) завершений і перевірений** (2026-08-29): `users.last_seen_at` —
  довговічний слід присутності поруч із ефемерною presence у Valkey. Семантика —
  **high-water mark** «останній момент, коли ТОЧНО знали, що юзер живий», а НЕ «момент
  дисконекту»: у трьох із чотирьох режимів розриву (`transport close`/`ping timeout`,
  `kill -9` ноди, недоступна Valkey) дисконекту не існує взагалі. Тому позначки йдуть із
  **шести** точок — connect (якір на випадок аварійного падіння), graceful disconnect
  останньої вкладки, `forgetSocket`, періодичний mark (`REALTIME_LAST_SEEN_MARK_MS`, 5 хв —
  ЄДИНЕ джерело, що не залежить від брокера), sweep (`now − leaseTtl`, бо юзера немає вже
  щонайменше TTL) і drain на SIGTERM. Друга вкладка позначки не ставить. Запис —
  **write-behind** (`LastSeenWriter`: синхронний `mark()` у буфер `tenant→user→max(ms)`,
  batched злив раз на `REALTIME_LAST_SEEN_FLUSH_MS`; невдалий злив повертає позначки в
  буфер — монотонність робить повтор безпечним), інакше rolling deploy давав би сотні
  окремих UPDATE-ів. **Сирий SQL — другий легальний випадок у проєкті** (після колапсу
  сповіщень) і рівно з двох причин: `prisma.user.update*` підняв би `@updatedAt` (присутність
  виглядала б як редагування профілю), а умову «пиши, лише якщо новіше» треба виконати в
  ОДНОМУ стейтменті. Проти застарілого кеша фронта offline-дельта везе `lastSeenAt`
  (опційне поле — імʼя події лишилось `presence.changed.v1`), накладку тримає
  `last-seen.store.ts`, а `usePresence().lastSeenAt()` віддає пізніше з двох значень.
  UI (тільки tenant-web): колонка в `/users` + рядок «Presence» на картці юзера —
  `Online` / `Last seen 5 minutes ago` (тултіп з абсолютною датою) / `Never signed in`;
  при недоступній Valkey час НЕ ховається (він із Postgres і лишається правдою), зникає лише
  слово «Online». Межа: рахуються ТІЛЬКИ socket-зʼєднання, REST-логін поле не рухає.
  Граблі: (1) **`$executeRaw` обходить tenant-extension** — без явного
  `runWith → withTenantTx` під `saas_app` RLS оновлює нуль рядків МОВЧКИ; (2) `users.id` —
  `text`, а не `uuid` (Prisma тримає id як `String`), тому каст масиву — `::text[]`, інакше
  `operator does not exist: text = uuid`. 130 tenant-e2e (+6) і 11 platform-e2e. Перевірено
  живим прогоном проти dev-БД і dev-Valkey: створений юзер → `null`; логін без сокета не
  рухає; connect ставить якір і НЕ рухає `updated_at`; закриття 1 з 2 вкладок не дає offline;
  періодичний mark рухає значення; час в offline-дельті збігається з тим, що в БД.
  **Account Settings V1 завершений і перевірений** (2026-08-29): розділ `/settings` у
  tenant-web (Profile / Account / Security / Notifications / Appearance) + модуль
  `apps/api/src/account/`. Головне рішення — **списку активних сесій немає, і це не
  спрощення UI**: рядок `refresh_tokens` — не пристрій, ротація робить `delete`+`create`
  з новим id, тож «сесія» як сутність, яку можна показати і вибірково вбити, у моделі
  відсутня. Тому — «рівень 0»: `POST /account/sessions/revoke-all` (все або нічого) і
  чесний підпис «до 15 хвилин» (access-токен stateless, denylist у Valkey свідомо не
  заводили). Закрито давній баг: **`POST /auth/logout`** — до цього вихід був суто
  клієнтським (`clearSession()`), і токен на чужому компʼютері лишався робочим до
  `expiresAt`; роут публічний (протухлий access не має заважати здати refresh) і мовчазно
  ідемпотентний (204 на будь-який непридатний токен — інакше оракул «чи існує tokenId»),
  невірний секрет НЕ вмикає theft-detection. Модуль свідомо окремий від `users`: **id
  немає в жодному шляху** (суб'єкт завжди `@CurrentUser().sub`), доменну роботу виконує
  `UsersService`, а `AccountService` додає рівно те, чого в адмінському флоу немає —
  `argon2.verify` старого пароля (невірний → **400 з `fieldErrors.currentPassword`**, не
  401: 401 викинув би на /login через інтерсептор) і **повернення свіжої пари токенів**
  (обидві security-дії відкликають ВСІ сесії, включно з поточною; нова пара створюється
  ПІСЛЯ коміту, інакше потрапила б під той самий `deleteMany`). `UpdateAccountProfileSchema`
  — підмножина `UpdateUserSchema` без `role`/`isActive`/`email` (Zod відкидає зайве мовчки,
  перевірено e2e). `GET /account` існує окремо від `GET /auth/me` заради живого presigned
  `avatarUrl` (у `/auth/me` він протух би — це лишається дешевим бутстрапом сесії). Новий
  тип активності `user.sessions_revoked`; сповіщення собі при самостійній зміні пароля НЕ
  приходить (recorder відсіює «актор == отримувач» — правило не обходимо). UI — розкладка
  `src/features/settings` шаблону satnaing/shadcn-admin (MIT, звідти ж палітра UI-4):
  `SettingsNav` + `ContentSection`; крихти рендерить КОЖНА сторінка (два `PageBreadcrumbs`
  через портал промалювались би поруч), шляхи розділу — літеральний юніон `SettingsPath`
  (`Link to` типізований роутами); преференси сповіщень — ТОЙ САМИЙ компонент, що в панелі
  дзвінка (`onBack` став опційним). 139 tenant-e2e (+9) і 11 platform-e2e; лінт/тайпчек/білд
  чисті. Живий прогін проти dev-API: `GET /account`, 400 з полем на невірний поточний
  пароль, logout → 204 і мертвий refresh. Деталі — `docs/account-settings.md`.
  **Кастомери (еталонний доменний модуль) завершені і перевірені** (2026-09-01): перша
  бізнес-сутність скелетона за `docs/customers.md` — те, від чого форк розвиває свій напрям.
  Ім'я **`Customer`**, а не `Account` (слово зайняте self-service модулем `apps/api/src/account/`)
  і не party-модель SAP BP / Odoo `res.partner` (правильна кінцева форма для ERP, але без
  другого типу контрагента — рівень непрямості без споживача; `Customer` → `Party` мігрується
  перейменуванням, коли він зʼявиться). Три таблиці: `customers` (дискримінатор `kind`
  ORGANIZATION|PERSON — ЄДИНЕ поле, яке справді дорого додати потім), `customer_contacts`
  (вкладені контактні особи; «рівно один основний» тримає ЧАСТКОВИЙ унікальний індекс, а не
  перевірка в сервісі — інакше гонка двох вкладок) і пара таблиць нумерації —
  **`number_series`** (конфіг тенанта: префікс, нулі, `startValue`, період скидання; рядок
  існує лише коли дефолт змінили — патерн `notification_preferences`) + **`number_sequences`**
  (лічильник, ключ `(tenant, name, scope)`); усі з RLS ENABLE/FORCE за шаблоном MT-2.
  **Номер — ЦІЛЕ число, своє в кожного тенанта; формат (`C-000123`) — presentation, а не
  частина ідентичності**: рядкове сортування ламається на переході через padding, а зміна
  формату вимагала б переписати всі рядки. API віддає `number: 123` + `numberLabel`, який
  рахується на льоту — для ДОКУМЕНТІВ правило дзеркальне, там лейбл заморожується в колонку
  (виданий рахунок не міняється заднім числом). Двигун — **`NumberingService` у `libs/shared`**,
  щоб рахунки не писали його з нуля; **`scope` заведений порожнім з першого дня**, бо
  скидання за періодом — властивість ДОКУМЕНТІВ («рахунок №1 за 2027» — норма, «клієнт №1 за
  2027» — ні), а додати колонку в PK згодом дорожче. **Таблиця-лічильник, а НЕ
  `CREATE SEQUENCE`**: послідовність одна на БД (номери скачуть між тенантами, витікає обсяг
  сусіда), вона поза RLS, і головне — `nextval` НЕ відкочується, тобто дає дірки в нумерації;
  інкремент у тій самій транзакції їх виключає (ціна — серіалізація створення в межах тенанта).
  **І не `MAX(number)+1` під advisory-локом**: після видалення найстаршого рядка номер
  перевикористовується — для рахунка фатально. Номер видається ЯКОМОГА ПІЗНІШЕ: блокування
  тримається до КОМІТУ, тож зовнішнього I/O у такій транзакції бути не може. «Початковий
  номер» — дві РІЗНІ операції: `startValue` у конфігу діє в момент створення бакета, зсув
  живого лічильника — окремий ендпоінт і ТІЛЬКИ вгору (`GREATEST`; спроба знизити — тихий
  no-op, бо попередні номери вже видані); екран — `/settings/numbering`. Патерн свідомо
  обкатаний на дешевій сутності, щоб для рахунків, де пропуск номера — питання від
  податкової, він уже був відпрацьований. **Сирий SQL — третій легальний випадок** (після
  колапсу сповіщень і last-seen): PK лічильника композитний, і Prisma-upsert змусив би
  доменний сервіс скласти `where` з `tenant_id` — усупереч контракту §11 MT-доку; у сирому
  `INSERT … ON CONFLICT` колонки немає взагалі, її ставить DB-default із CLS. **Soft delete
  немає**: «прибрати з очей» — це `status = ARCHIVED` (дефолтний список ховає, за прямим
  посиланням доступний), а `DELETE` лишається виправленням щойно зробленої помилки — від
  справжнього видалення захистить `onDelete: Restrict` майбутніх документів. Статус — окремий
  ендпоінт (подія, не атрибут), у журнал іде ТІЛЬКИ перетин межі архіву (`ACTIVE ↔ INACTIVE`
  засмітив би фід). Унікальні лише `number` і `externalId` (ключ ідемпотентності імпорту);
  `name`/`email`/`taxId` свідомо НІ — жорсткий констрейнт дає «ТОВ Ромашка 2» замість
  правильного запису, дублікати лікує merge (беклог). Сповіщення `customer.assigned` іде
  ВІДПОВІДАЛЬНОМУ, а не всім адмінам (юзерів заводять десятками на рік, кастомерів —
  десятками на день). Фід сутності запрацював БЕЗ нового ендпоінта —
  `GET /activities?entityType=customer` generic від Activity Log. Фронт: `/customers` (грід) і
  `/customers/$customerId` (та сама розкладка, що картка юзера) + **`entityLink(kind,id)`
  замість `entityRoute(kind)`** — реєстр сутностей тепер веде на КАРТКУ, а не на список
  (заодно виправлено для юзерів, чия сторінка існує з 2026-08-26). Дрібне: `normalizePhonePair`
  піднято з `users.service` у `common/phone.ts` (друге використання), у `libs/ui` доданий
  `FormTextareaField`. 162 tenant-e2e (+23) і 11 platform-e2e; лінт/тайпчек/білд чисті.
  Живий прогін проти dev-БД: сід дає 1…3 → API продовжує з 4, порожній email із форми → null,
  `+380…` → `phoneCountry=UA`, архів зникає з дефолтного списку але доступний за посиланням,
  журнал показує `customer.created` і `customer.archived` з реальним актором; зміна формату
  на `K`+4 перемалювала ВЖЕ створених (`C-000001` → `K0001`) не чіпаючи `number`, зсув
  лічильника на 5000 дав рівно 5000, спроба знизити — no-op, пошук `K5000`/`5000`/`005000`
  знаходить той самий запис. **Грабля міграції: Prisma на зміну типу колонки генерує
  DROP + ADD** (мовчазна втрата даних) — замінено на `ALTER … TYPE INTEGER USING
regexp_replace(...)`; разом із колонкою переживає й унікальний індекс, тому згенерований
  `CREATE UNIQUE INDEX` із міграції прибраний.
  **Settings організації завершені і перевірені** (2026-09-01): налаштування КОМПАНІЇ
  відокремлені від особистих. Межа — не UI, а власність даних: «якщо юзер піде з компанії,
  налаштування піде з ним?» так → **User settings** (`/user-settings`, API `/account/*`),
  ні → **Settings** (`/settings`, API `/settings/*`). **Словом «Settings» володіє
  ОРГАНІЗАЦІЯ** — домінантний патерн B2B (GitLab, Stripe, Notion, HubSpot, Salesforce):
  людина йде в «налаштування», коли треба налаштувати бізнес, а не власну тему. Особисте
  отримує кваліфікатор «User settings» (буквально як у GitLab); «Preferences» НЕ взяли —
  пароль і сесії не преференції. «Workspace» відкинуто: слово зайняте фронтом (підзаголовок
  бренду + майбутній перемикач контексту), «Organization» — доменом (`CustomerKind`).
  **Входи рознесені**, щоб два «Settings» не стикались: організаційний — пункт ГОЛОВНОЇ
  навігації (лише ADMIN), особистий — під аватаром. **Форму API визначають два питання**:
  (1) хто суб'єкт — `/account` = «я», `/settings` = «моя організація», **id у шляху немає в
  обох** (відсутність id і є твердженням «чуже недосяжне»); (2) що це за формою — секція-
  ДОКУМЕНТ (`GET/PUT /settings/general`, повна заміна), КОЛЕКЦІЯ (`GET /settings/numbering`,
  `PATCH /settings/numbering/:name`) чи ОПЕРАЦІЯ, яку станом поля не виразиш
  (`POST /settings/numbering/:name/next-number` — монотонний зсув). Нумерація свідомо НЕ
  секція: `PUT` не вміє «тільки вгору». Плюс `GET /settings/bootstrap` (курований зріз для
  SPA, усім ролям) і `GET /settings/activity` — окремий фід, бо id організації клієнту не
  віддається і парою `{entityType,entityId}` його не адресувати (у БД `entityType` лишається
  технічним `'tenant'`). **Запис — тільки ADMIN**: введений зародок RBAC —
  `@Roles(Role.ADMIN)` + глобальний `RolesGuard` (другий APP_GUARD після Jwt; хендлер без
  декоратора пропускається — гейт opt-in, інакше довелося б розмітити всі наявні ендпоінти
  одночасно). Повний RBAC (`@RequirePermissions`) ЗАМІНИТЬ його, а не додасться поруч. Нове
  в БД — `Tenant.currency` (колонка, а не `settings Json`: закритий формат, і платформа
  колись питатиме «усі тенанти з EUR»); дефолт валюти нового кастомера тепер із налаштувань
  організації, а не з константи контракту; довідник валюти переїхав у
  `libs/contracts/src/money/`. Каркас обох розділів спільний — `components/section/`
  (`SectionNav` + `ContentSection`). 171 tenant-e2e (+9) і 11 platform-e2e.
  **Грабля, яку спіймали тести: вичерпання пулу конекшенів** — e2e піднімає десяток
  Nest-апок в ОДНОМУ jest-процесі, по два Prisma-клієнти в кожній, дефолт пулу 10 → впирається
  в `max_connections` Postgres-а; симптом неочевидний — випадкові 503 і дивні статуси в
  СУСІДНІХ сьютах (P2024 «timed out fetching a connection»), а не чесна помилка підключення.
  Лікування — `DATABASE_POOL_MAX` (env; у проді не задаємо) = 3 у `setup-env.ts`; там же
  вимкнений keep-alive `http.globalAgent` (сокет до закритої апки давав `ECONNRESET` у
  наступному сьюті). Деталі — `docs/settings.md`.
  **Двоколонковий шел (`apps/web`) завершений** (2026-09-06): один сайдбар замінений на
  **два рівні навігації** — модель VS Code / Slack / JetBrains. `AppRail` (смуга іконок 48px:
  бренд-плитка вгорі, пункти area посередині, профіль у футері — і бренд, і профіль належать
  СЕСІЇ, а не area) + `AreaSidebar` (колонка активного розділу з власною шапкою). Склад — за
  реєстровим блоком `sidebar-09`; **єдине відхилення** знімає його ж обмеження: рядок із двох
  колонок обгортаємо самі, а не трюком `*:data-[sidebar=sidebar]:flex-row`, який на мобільному
  не діє (там `Sheet` із хардкодженим класом) — тому в блоці друга колонка на телефоні просто
  ховається, а в нас `Sheet` 18rem = 3rem рейлу + 15rem панелі, окремого мобільного режиму
  немає. Три `h-14` з `border-b` (шапка рейлу, шапка колонки, хедер контенту) складають одну
  неперервну лінію через усе вікно; шапка колонки тримає два яруси — назва інсталяції і сірим
  під нею активна area (форма старого брендового блоку, тільки другий рядок став динамічним).
  Рейл — 48px із жолобами
  `p-1` і ДВОМА метриками всередині: **пункт area = рівно метрика пункту другої колонки**
  (бокс 32px, стоковий `p-2`, іконка 16px — падінг і розмір іконки не перевизначаються взагалі,
  щоб два рівні навігації читались як одна система), а **якорі смуги — бренд і аватар — свої
  40px** без падінгу (їх завжди рівно два, вони не пункти). **Групи обох колонок тримають стокові `p-2`** — від них
  залежить вертикальна координата першого рядка (56 шапки + 1 межа + 8 = 65px, центр іконки
  81px), і 4px власного падінгу в рейлі читались як видима сходинка між рівнями навігації.
  **`--sidebar-width` задається ЧЕРЕЗ ширину панелі**
  (`calc(14rem + var(--sidebar-width-icon) + 2px)`), а не навпаки: стандартна тут панель — 14rem
  (224px, нижня межа класичного діапазону 224…256px: 240px у Linear/Notion, 256px у Material 2
  і в стоку shadcn), а рейл лише фіксована обшивка, яку до неї додають; `+2px` компенсує дві
  межі по 1px (контейнера і рейла). Виміряний урок: **рейл сприймається за розміром
  ІКОНКИ, а не за шириною смуги** — спроба зробити його більшим через смугу (56px, іконка 18px)
  оком не читалась узагалі при цілком правильному CSS; спрацювало навпаки — смуга тісніша,
  вміст більший. Розмір знака в якорі задає `[&_svg]` на кнопці: селектор нащадка
  специфічніший за клас на елементі, тож «на місці» його не перебити без `!`. І ще з тієї ж
  перевірки: `p-2`/`w-full` із варіанта tailwind-merge НЕ знімає (різна важливість) — виграє
  `!important`, тому важливо лише щоб класи з `!` стояли пізніше.
  Грабля, спіймана на згорнутому стані: **кожне перевизначення геометрії кнопки рейлу треба
  дублювати з модифікатором `group-data-[collapsible=icon]:`** — у `sidebarMenuButtonVariants`
  є `:size-8!` і `:p-2!` під цим модифікатором, а голі `size-9!`/`p-0!` їм не конкуренти (різні
  модифікатори → tailwind-merge лишає обидва), тож у згорнутому стані плитка й аватар
  стискались і з'їжджали вправо; іконки симптому не показували. Там же перевірено, що `p-2` із
  варіанта tailwind-merge НЕ знімає (різна важливість) — виграє `!important`, і це причина, чому
  реєстр ставить `!`. Чотири area в рейлі —
  **Workspace** (наявна навігація: Dashboard / Users / Customers), **Chat** (порожня, перша
  area, чия колонка НЕ меню — там буде список розмов, і саме через неї контракт
  `AppArea.Sidebar` — компонент, а не масив пунктів), **Settings** і **Playground**; плюс
  **User settings** без пункту (вхід із дропдауна аватара). Settings і User settings при цьому
  ЗАБРАЛИ свої під-розділи з контенту в колонку шела: `SectionNav` знятий, бо той самий рівень
  навігації існував двічі й у двох різних виглядах. **Кожна area володіє префіксом URL**
  (симетрично: `/workspace`, `/chat`, `/settings`, `/playground`, `/user-settings`), активна =
  ЧИСТА ФУНКЦІЯ від pathname (`resolveArea`), дубльованого стану «яка area вибрана» немає.
  Асиметричний варіант («workspace = все інше», нуль переносу URL) відкинутий: три з чотирьох
  area вже мали власний префікс, тож симетрія коштувала переносу лише `/users` і `/customers` —
  за таку ціну вона купується. Переїзд прикрив нормалізатор у `rootRoute.beforeLoad` (`href` +
  обов'язковий `searchStr`, інакше редірект губив би фільтри гріда) — тимчасовий, до кінця 2026.
  `SidebarTrigger`/Cmd+B і cookie `sidebar_state` лишились тими самими, просто тепер ховають
  ДРУГУ колонку (рейл не згортається — він і є згорнутий стан). Граблі: (1) **tooltip у рейлі
  мусить бути `{children, hidden: isMobile}`** — реєстровий `SidebarMenuButton` показує його
  лише при `state === 'collapsed'`, а `useSidebar()` віддає стан ЗОВНІШНЬОГО сайдбара, тож при
  розгорнутій панелі підказки не було б, хоча підписів у рейлі не видно НІКОЛИ; (2) активний
  пункт рейлу — `button`, неактивний — `Link` (перехід на префікс із `/workspace/users` викинув
  би на дашборд; робити це одним `Link` із `preventDefault` не можна — порядок склеювання
  обробників між `useRender` і `Link` не гарантований); (3) **`useParams({ from })` бере ID
  роуту** і TS його перевіряє (`/app/users/$userId` → `/app/workspace/users/$userId`), а от
  `Crumb.to` типізований як `string` — крихти компілятор НЕ ловить, їх правили руками.
  Деталі — `docs/frontend/app-shell.md`.
  **Календар CAL-1 завершений і перевірений** (2026-09-07): події користувача за
  `docs/calendar.md` — друга бізнес-сутність після кастомерів і перша, де зʼявився ЧАС.
  Ім'я **`CalendarEvent`**, а не `Event`: слово зайняте messaging-повідомленнями
  (`defineEvent`), socket-подіями і журналом, тож доменна сутність під ним зробила б
  нечитабельним кожне друге речення (та сама історія, що `Account` → `Customer`).
  Три таблиці — `calendar_events` (пів-відкритий інтервал `[starts_at, ends_at)` за
  RFC 5545 + IANA-`time_zone` ПОРУЧ з UTC-інстантом, `all_day` із рендером у зоні ПОДІЇ,
  а не глядача), `calendar_event_attendees` (RSVP-`PARTSTAT`; **організатор — теж рядок
  учасника**, як у Google/Graph) і `calendar_reminders` (ДЕКЛАРАЦІЯ «за N хв», персональна) —
  плюс `users.time_zone`; усі з RLS ENABLE/FORCE за шаблоном MT-2. **Читання ВІКНОМ**
  (`from`/`to`, стеля 62 дні, без `page`/`total` — «сторінка 7 календаря» не означає
  нічого), курсорна `GET /calendar/agenda` окремо. **Елемент відповіді — ВХОДЖЕННЯ**
  (`occurrenceStart`/`occurrenceEnd`, `recurringEventId: null`) з першого дня: з появою
  повторень (CAL-4) один рядок почне давати N елементів, і без цих полів довелося б міняти
  контракт. **Доступ визначає УЧАСТЬ, а не роль** — єдиний модуль, де `@Roles` не годиться:
  `CalendarAccessService` (одне місце на фільтр списку і на перевірку рядка), сторонньому
  404 а не 403, учаснику 403 на редагування, ADMIN бачить лише БЕЗХАЗЯЙНІ події
  (`owner_id IS NULL` після видалення юзера) і НЕ бачить чужих приватних; подія, привʼязана
  до кастомера, видима колегам — інакше «Історія зустрічей» на картці клієнта показувала б
  кожному лише його власні дзвінки. **Нагадування end-to-end без email**: спільна
  `scheduled_notifications` (та сама, що планувалась у roadmap §2.1 — жодного `calendar_` у
  назвах) + cron `notifications.dispatch-scheduled` раз на хвилину зі scope `system`,
  атомарний `claim` (`FOR UPDATE SKIP LOCKED`) як єдине джерело exactly-once (inbox не
  потрібен), перепланування/скасування в ТІЙ САМІЙ транзакції, що доменна зміна, і політика
  `stale` (10 хв) проти доставки «навздогін» після простою. **Чому не `pg-boss startAfter`**:
  `pgboss.*` поза RLS (той самий аргумент, що переніс `/jobs` у platform-api), ретеншн черги,
  скасування як друге джерело правди, гонки при перепрануванні. Інтеграції — без жодного
  нового наскрізного механізму: 8 типів активностей із лінком `role: 'context'` на кастомера
  (його фід отримує зустрічі БЕЗ нового ендпоінта), 5 типів сповіщень і нова категорія
  `calendar` (`cancelled` — немутабельний), дифування складу учасників (той самий склад =
  нуль сповіщень), секція `/settings/calendar` у `Tenant.settings` JSON — перший реальний
  споживач гібридного сховища. Фронт: пʼята area `/calendar` (друга колонка — контейнер
  вигляду з міні-місяцем, як у чата), Day/Week/Month/Agenda на ВЛАСНИХ `TimeGrid`/`MonthGrid`
  (готові бібліотеки приносять другий движок і другу тему; `react-day-picker` — рівно як
  date-picker), панель події з RSVP і вкладкою Activity (у `Sheet`; на **контекстну
  панель шела** переїхала 2026-09-08 — див. нижче), блок «Upcoming» на картці
  кастомера, таймзона в Profile. `date-fns` + `@date-fns/tz` — ТІЛЬКИ на фронті; бекенд
  тримає 30 рядків на `Intl` (`calendar-time.ts`).
  **CAL-2 зроблена того ж дня, скоуп закритий** (сім блоків нижче). (а) **Перетягування і resize** на власних pointer-подіях
  (без `@dnd-kit`: у часовій сітці немає зон і колізій — є координата, яку заокруглюють до
  15 хв): порог 4px, прилипання, прев'ю через `translate`, дні через `addDays` у зоні
  глядача (не «+24 год» — доба переходу має 25 годин), тягнеться лише `canEdit`,
  оптимістичний патч кеша з відкатом зі снапшота, `undo`-тост через `actionProps` Base UI
  (закривається на клік, інакше бреше). (б) **realtime-дельти**: `calendar.event-changed.v1` в особисті
  room-и УЧАСНИКІВ (не broadcast у tenant-room: інакше час і факт існування чужої
  зустрічі летіли б усьому тенанту), payload БЕЗ стану (`{eventId, change, startsAt,
  endsAt}` — клієнт лише вирішує, чи чіпає зміна відкрите вікно, і перечитує його
  цілком), **перенесення шле ДВІ дельти** (нова межа + стара, інакше на старому місці
  лишалась би дірка), прибраний учасник отримує дельту через обʼєднання складів, клієнт
  інвалідує ЛИШЕ перетнуті вікна (`predicate` по живих ключах кеша).
  (в) **Створення протягуванням** (`use-range-draft.ts`) — ОКРЕМИЙ хук, а не режим
  перетягування: там жест зсуває наявні межі, тут народжує інтервал із двох координат.
  Рівно ОДНА колонка (через межу дня прямокутник означав би не те, що видно; багатоденну
  подію робить форма), тягнути вгору можна (`draftRange` міняє межі місцями), хвилина
  рахується від ПОВНОЇ висоти колонки, а не від висоти години (сітка позиціонує у відсотках
  від `minutesInDay` — у добу переходу там 1500 хв на ті самі 24 ряди), верх колонки
  перечитується на кожному русі (сітка у власному скролі — прокрутка колесом посеред жесту
  зсунула б координати). `pointerup` відкриває ту саму панель події з готовими межами;
  quick-create поповера свідомо НЕМАЄ — другий редактор = друга форма з тими ж полями.
  **Грабля: гвард «це хвіст жесту, а не клік» мусить перевіряти джерело події.** Якщо
  `pointerup` стався над іншою коміркою, `click` іде на спільного предка, обробник комірки
  не викликається — і прапорець лишається піднятим; наступний `Enter` на комірці він би
  зʼїв. Тому гвард працює лише при `event.detail > 0` (у клавіатурного кліку `detail === 0`);
  плитка отримала другим аргументом `fromKeyboard`.
  (г) **Гарячі клавіші** (`use-calendar-hotkeys.ts`, Google-сумісні): `T`, `D`/`W`/`M`/`A`,
  `←`/`→`, `N` (і `C`), `?` — довідка окремим діалогом на новому примітиві `kbd`
  (38-й у `libs/ui`; та сама грабля CLI `import { cn } from "cn"` + зайвий npm-пакет `cn`
  у залежностях — вважаємо її постійною поведінкою `shadcn add`). Слухач ОДИН і на `window`
  (вимагати фокус на комірці = клавіші не працюють на щойно відкритій сторінці), тому два
  фільтри: `enabled` (гаситься, доки відкрита панель або довідка) і `isEditableTarget`
  (фокус у полі — модалка не єдиний шлях в інпут). `event.key`, а не `code`, ПЛЮС окрема
  гілка на `Shift`+`/` (у частині розкладок і в автоматизації `key` лишається `/`);
  будь-який `Ctrl`/`Cmd`/`Alt` знімає обробку (`Cmd+D` — закладка браузера), а
  `preventDefault` — лише для розпізнаної клавіші. Побічно виправлено: `N` і кнопка
  «New event» відкривали форму на сирій хвилині («13:33 – 14:03») — тепер
  `defaultCreateStart`: сьогодні найближчий слот угору, інша доба — початок робочого дня.
  (д) **Попередження про накладання** (`find-conflicts.ts`): `alert` під полями часу в панелі
  події, оновлюється живо. Перевірка СВІДОМО на фронті — «попередження, не заборона», у
  бекенда немає правила, яке можна порушити (дві зустрічі в один час легальні), тому й гонка
  «конфлікт зʼявився поки я редагував» нічого не ламає. Вікно запиту — РІВНО доба (свій ключ
  кешу, перевикористовується між відкриттями), дефолт `mine` дає потрібну семантику «моя
  зайнятість». Не конфліктують: сам рядок (`excludeId` — він приїжджає в тому самому вікні),
  скасовані, `busy: false` (`TRANSP`), all-day (накрила б кожну подію дня) і мій `DECLINED`.
  Межі пів-відкриті: 11:00–12:00 і 12:00–12:30 конфліктом не є.
  **Сусідній баг, знайдений тим же ходом: множина i18next не працювала** — ключі
  `*_plural` (форма v3) версія 26 без `compatibilityJSON` не резолвить узагалі й мовчки
  падає на базовий ключ («2 hour before»). Правильні суфікси — `_one`/`_other`, базовий
  ключ поруч НЕ тримаємо (він і сховав помилку); перевіряти — трьома рядками на
  `i18next.init` у Node, а не оком. Записано в `docs/i18n-plan.md`.
  (е) **Peek по наведенню** (`event-peek.tsx`) — і СВІДОМО не так, як в ескізі: не «клік →
  поповер із RSVP-кнопками → Edit → панель», а **наведення → картка тільки для читання,
  клік → одразу панель**. Картка по наведенню з кнопками — пастка: щоб натиснути, треба
  вести курсор коридором між тригером і поповером; дії лишаються там, де не тікають з-під
  руки (панель і майбутнє контекстне меню). `HoverCard` реєстру — це Base UI
  **`PreviewCard`**: `Trigger` малює `<a>` (плитка йде через `render={chip}`), затримки
  живуть на ТРИГЕРІ, а корінь контрольований — картка гаситься на `pointerdown` (інакше
  висіла б над плиткою, що вже поїхала) і на клік (інакше лишалась би позаду панелі).
  **Грабля перевірки, не коду**: у ФОНОВІЙ вкладці мишачі drag-жести автоматизації не
  доставляються (одиночні кліки і DOM-читання — працюють), і це виглядало як регресія від
  обгортки; контрольний жест по порожній сітці провалився так само → перед пошуком
  регресії дивимось `document.visibilityState`.
  (ж) **Контекстне меню на правий клік** (`event-context-menu.tsx`): Open / RSVP-трійка /
  Duplicate / Cancel-Restore / Delete. **Меню не виконує нічого саме — воно піднімає
  ІНТЕНТ, а виконує сторінка**: кожна дія це мутація з тостом, а видалення ще й із
  підтвердженням, і тримати це в кожній із тридцяти плиток означало б тридцять копій стану
  і тридцять `alert-dialog`. RSVP — `radio-group` (поточна відповідь мусить бути видна
  галочкою) і лише в учасника. `Duplicate` відкриває ФОРМУ, а не створює тихо (у дубліката
  майже завжди міняють час), несе поля оригіналу через `draft.template`, але НЕ несе id,
  статусу і чужих RSVP. `Delete` — єдина дія через `alert-dialog` (скасування зворотне,
  видалення ні). Дві реєстрові частини на одній плитці складаються ланцюжком `render`
  (`ContextMenuTrigger` → `HoverCardTrigger` → кнопка), і **корені обох мусять бути ВИЩЕ за
  свої тригери** — вони не рендерять елементів, тому покладені на них DOM-пропси тихо
  зникають. `ContextMenuLabel` без `ContextMenuGroup` падає в рантаймі (та сама пастка, що
  з `DropdownMenuLabel`).
  **Третій випадок «інструмент, а не код» за день**: `right_click` автоматизації не
  доставляє нативний `contextmenu` — жест перевірявся через `dispatchEvent`.
  (з) **Присутність учасників (F-18)** — зелена крапка на аватарі гостя в панелі події.
  Перший ДОМЕННИЙ споживач presence (до того вона була демо в `/users`).
  **Рішення переглянуто того ж дня, і це важливіше за саму фічу**: спершу присутність
  прокидалась пропом `renderBadge` зі споживача, і в пісочниці того самого компонента
  (`/playground/multi-user-select`) крапок не було — бо автор тієї сторінки про realtime не
  згадав. Отже присутність помилково зробили властивістю СПОЖИВАЧА, а вона властивість
  факту «ми малюємо людину». Тепер її ставить сама родина компонентів вибору юзера — усі
  ЧОТИРИ поверхні (`UserMultiSelect` чипи, `UserMultiList` рядки, `UserPickerList`
  випадайка, одиночний `UserSelect` — і тригер, і список), слот прибраний, споживачі не
  пишуть нічого. Механізм — підключений `UserPresenceBadge` (`components/presence-dot.tsx`):
  сам бере `usePresence()` і віддає ту саму крапку в `UserIdentity badge`. Хук на КОЖЕН
  значок свідомо: снапшот — один запит зі `staleTime: Infinity`, тож N значків = N
  спостерігачів одного кеша, а не N запитів. Правило поділу слотів лишилось: на аватарі те,
  що людина про юзера ДІЗНАЄТЬСЯ, у правому краю рядка — те, що вона йому ЗАДАЄ (RSVP).
  Підпис «Online now» переїхав у спільний `common` неймспейс (`libs/i18n`), бо його тепер
  рендерить компонент, а не сторінка.
  **Скоуп CAL-2 на цьому закритий.**
  203 tenant-e2e (+32) і 11 platform-e2e;
  лінт/тайпчек/білд чисті. **Браузерна перевірка (2026-09-07) знайшла 12 дефектів,
  яких не бачили ні типи, ні 203 e2e** — головний блокував увесь екран:
  **`TZDate.toISOString()` віддає час ЗІ ЗСУВОМ** (`…+03:00`), а `z.iso.datetime()`
  приймає лише `Z` → кожен вікновий запит 400. Тепер дати виходять на дріт ЛИШЕ
  через `toInstantIso()`. Решта: міні-місяць підсвічував сусідній день
  (`TZDate` проти локальних днів `react-day-picker`), сторінка не вміщалась у вікно
  (шел скролить ВІКНО — сітка мусить обмежити себе сама, ідіом `ActivityPanel`),
  підпис місяця брався з країв сітки («October» над вереснем), agenda показувала
  вигаданий діапазон, нативні `type="time"` у вузькій панелі обрізали «14:00» до
  «14:», у 30-хвилинній плитці обрізався рядок часу, а на холодному старті летіли ДВА
  запити вікна (до bootstrap-у зона — фолбек на пристрій; тепер запит притримує `isReady`). Живий прогін:
  нагадування «за 1 хв» матеріалізувалось,
  cron-тік доставив його в інбокс (`1 delivered, 0 stale`), all-day 10–12.09 у Києві дав
  `[09.09 21:00Z, 11.09 21:00Z)`, перенесення переставило нагадування і НЕ зачепило вже
  доставлений рядок. Розбіжності з дизайном — `docs/calendar.md` §18.
  Документи: `docs/architecture-proposal.md` (усі рішення з обґрунтуванням), `docs/roadmap.md` (фази),
  `docs/error-handling.md` (наскрізна обробка помилок: таблиці нормалізації і каналів реакції),
  `docs/i18n-plan.md` (мультиязичність: зафіксовані рішення + фази I18N-1…4),
  `docs/file-storage.md` (файлова підсистема: структура, presigned-флоу, приклад end-to-end на аватарі,
  формати запитів/відповідей),
  `docs/database-seed.md` (стандартні seed-ідентичності — дефолтні tenant/tenant-адмін/platform-оператор
  — і `pnpm db:reset`: чому НЕ `prisma migrate reset`; винесено окремо від MT-доків, бо стосується
  всього проєкту, не тільки мультитенантності),
  `docs/multi-tenancy-architecture.md` (мультитенантність — єдиний довідник: топологія
  5 застосунків, схема БД, RLS, механіка контексту, auth обох plane-ів, черги, наскрізний
  приклад, контракт для нового доменного модуля, обґрунтування ключових рішень і MT-4/беклог
  з дизайном ще не реалізованих шматків — invite-флоу, піддомени, довідники, білінг),
  `docs/activity-log.md` (журнал бізнес-подій: РЕАЛІЗОВАНО й перевірено 2026-07-21 —
  activities+activity_links, код типу+payload замість тексту, рендер через i18next на фронті,
  sync-запис у withTenantTx / async через inbox, перший курсорний ендпоінт),
  `docs/commands.md` (довідник усіх команд `package.json` з прикладами й описом, включно
  з посиланнями на профільні доки — напр. `db:roles` → `docs/multi-tenancy-architecture.md`;
  там же — мінімальний впорядкований набір JetBrains Run Configurations для dev),
  `docs/deploy-swarm.md` (РЕАЛІЗОВАНО 2026-07-24…31: GitLab CI → Docker Swarm через
  docker-context по SSH; топологія стеку, образи, one-shot db-джоби, рунбук),
  `docs/event-driven-architecture.md` (асинхронний шар — єдиний довідник: діагноз 10 розривів
  старого jobs-шару, цільовий конвеєр подій/команд, конверт, маніфест підписок, DLQ і
  класифікація помилок, гроші/email/зовнішні системи/realtime як підписники, наскрізний приклад
  оплати інвойса, фази EDA-0…EDA-4; EDA-0/EDA-1 РЕАЛІЗОВАНО 2026-08-04, EDA-4 — 2026-08-16
  (§3.12 переглянуто: realtime НЕ підписник), EDA-2 і EDA-3 — попереду)
- `docs/event-driven-scenario.md` (вхідна постановка, з якої виріс дизайн),
  `docs/realtime.md` (realtime — РЕАЛІЗОВАНО й перевірено 2026-08-15, last-seen —
  2026-08-29: огляд, стек, межа з event-driven шаром, зафіксовані рішення, що лишилось) +
  `docs/realtime-internals.md` (механіка: протокол, ключі Valkey, Lua, § «Last seen:
  довговічний слід присутності» — шість точок позначки, write-behind, обґрунтування сирого
  SQL, точність за сценаріями; конфіг, режими відмов, тести, граблі)
- `docs/realtime-questions.md` (чек-лист розуміння),
  `docs/notifications.md` (in-app сповіщення / Notification Center — РЕАЛІЗОВАНО й перевірено
  2026-08-16: скоуп V1 «інбокс», модель даних, контракти, recorder, socket-протокол, REST,
  UI, тести, таблиця «що змінилось під час реалізації»; нагадування — окремий наступний хід.
  Містить **перегляд плану EDA §3.12**: realtime НЕ став підписником у `MESSAGE_TOPOLOGY`,
  міст воркер→браузер — headless Socket.IO Server, стрім `realtime.dispatch` не заводили.
  Синхронізовано з `docs/roadmap.md`, `docs/realtime.md`,
  `docs/event-driven-architecture.md` §3.12 і `docs/realtime-questions.md` (п. 76, 79)),
  `docs/account-settings.md` (self-service акаунт — РЕАЛІЗОВАНО й перевірено 2026-08-29:
  скоуп V1, чому немає списку сесій і три рівні розвитку, бекенд-модуль без id у шляхах,
  фронт на шаблоні shadcn-admin, тести, що далі),
  `docs/customers.md` (кастомери — РЕАЛІЗОВАНО й перевірено 2026-09-01: як сутність зветься
  в SAP/Salesforce/Odoo/NetSuite і чому в нас `Customer`, поля з обґрунтуванням кожного і
  переліком свідомо ВІДКИНУТИХ, механіка людського номера, логіка створення, життєвий цикл,
  16 підводних каменів SaaS CRM/ERP із рішенням для скелетона, беклог сутності),
  `docs/settings.md` (налаштування ОРГАНІЗАЦІЇ — РЕАЛІЗОВАНО й перевірено 2026-09-01: межа
  «особисте vs організаційне», огляд ринкових патернів іменування і чому «Settings» належить
  компанії, форма API (документ / колекція / операція), доступ і зародок RBAC, гібридне
  сховище колонка-vs-JSON, історія перейменувань),
  `docs/calendar.md` (календар і події користувача — **CAL-1 РЕАЛІЗОВАНО й перевірено
  2026-09-07**: як сутність зветься в RFC 5545 / Google / Graph / Cal.com і чому в нас
  `CalendarEvent`, 50 фіч розкладені по фазах CAL-1…CAL-4, пів-відкритий інтервал і зони
  (§6 — найдорожчий розділ), дизайн повторень і чому вони окремою фазою, механіка
  нагадувань і чому НЕ `pg-boss startAfter` (§8), інтеграція з activities/notifications/
  realtime/settings/customers (§9), поверхня API, фронт із добіркою shadcn-компонентів і
  власними сітками (§11), 17 підводних каменів, 10 рішень §15.1 і **§18 — 20 розбіжностей
  із дизайном, спійманих реалізацією**),
  **`docs/frontend/`** — уся документація UI-шару, ВИНЕСЕНА ОКРЕМО (2026-08-26):
  `README.md` (вхідна точка + **єдиний список відкритих питань фронту**: репозиторний
  `pnpm format`, вага `country-flag-icons`, ліцензія ReUI, хардкод «Close», відсутність
  фронтових тестів, дві конвенції імпорту в `libs/ui`, `baseColor` neutral проти slate-палітри,
  реєстр `@coss`; плюс готовий код без споживача — `selection` гріда в platform-web, проп
  `actions` тулбара, підзаголовок сайдбара під MT-4),
  `app-shell.md` (**два рівні навігації в `apps/web`**, реалізовано 2026-09-06: термінологія
  індустрії і наша — `AppRail` / area / `AreaSidebar`; реєстр area і `resolveArea`; дерево
  роутів із префіксом на кожну area, legacy-редіректи; розкладка з брендом над колонками і
  два відхилення від блоку `sidebar-09`; клікова поведінка рейлу; граблі),
  `ui-stack.md` (**головний довідник**: стек, склад `libs/ui` і що лишається в застосунку,
  тема з двома свідомими відхиленнями від стоку, семантична мапа «роль у UI → токен»,
  конвенції коду й форм, розкладка шела/крихт/списків, регіони тостів, оновлення примітивів
  через `add --diff`, реєстр локальних правок вендореного коду, граблі),
  `ui-registry.md` (**куди дивитись, коли треба новий компонент або блок**: порядок вибору
  `@shadcn` → `@coss` (Cal.com, той самий Base UI) → `@reui` (платні блоки) → референси; що
  вже вендеровано; таблиці «який примітив де є»; каталог сторінкових блоків; чекліст, як
  безпечно взяти компонент НЕ з `@shadcn`),
  `ui-migration-history.md` (**факт міграції на shadcn/ui, завершеної 2026-08-24** — UI-0…UI-8:
  що і коли, чому пішли з попередньої бібліотеки, 10 чинних рішень, реєстр 14 кустарних місць
  і чим кожне замінено, граблі свіпу токенів, виміряний результат; плани й покрокові журнали
  видалені разом із завершенням роботи),
  `ui-known-issues.md` (журнал проблем UI-бібліотеки і обходів — щоб обхід був один і названий;
  **відкритих записів немає**, лишається формат і правило, коли запис заводити),
  `README.md` (quickstart).

## Команди

```bash
pnpm docker:up            # PostgreSQL 17 + Mailpit + Valkey + SeaweedFS (OrbStack, не Docker Desktop)
                          # Valkey: брокер Socket.IO + presence-leases; :6379 (REDIS_PORT якщо
                          # порт зайнятий іншим проєктом — тоді й REDIS_URL у .env)
                          # Mailpit UI: http://localhost:8025 (SMTP :1025 — дефолти MailerService)
                          # SeaweedFS S3: http://localhost:8333 (креденшели — docker/seaweedfs/s3.json,
                          # дефолти StorageService збігаються; бакет+CORS створює сам API на старті)
pnpm db:generate          # Prisma client → libs/database/src/generated (gitignored)
pnpm db:migrate:dev       # міграції (dev; НЕ передавати ім'я через `pnpm ... -- --name X` —
                          # pnpm дублює `--`, prisma йде в інтерактивний prompt і висить;
                          # `cd libs/database && pnpm exec prisma migrate dev --name X`)
pnpm db:seed              # дефолтні сід-дані: tenant "default" + admin@example.com/Admin12345
                          # (tenant-адмін) + platform@example.com/Platform12345 (platform-оператор);
                          # ідемпотентний upsert — можна ганяти повторно на живій БД
pnpm api:dev              # API: http://localhost:3001, Swagger: /api/docs
pnpm platform:dev         # Control plane: http://localhost:3002 (MT-3; свій Swagger /api/docs,
                          # окремий JWT-secret; юзер — platform@example.com / Platform12345 із сіда)
pnpm worker:dev           # Worker: pg-boss споживачі + cron + welcome-email (окремий процес, без HTTP)
pnpm web:dev              # Web: http://localhost:5173 (Vite проксі /api → 3001)
pnpm platform:web:dev     # Platform web: http://localhost:5174 (Vite проксі /api → 3002)
pnpm openapi:generate     # apps/api/openapi.json (ts-node, потрібен .env з JWT_SECRET)
pnpm web:codegen          # orval: openapi.json → apps/web/src/api/generated
pnpm platform:web:codegen # orval: apps/platform-api/openapi.json → apps/platform-web/src/api/generated
pnpm lint && pnpm typecheck && pnpm build
pnpm api:test:e2e         # 199 тестів tenant-api (rls, tenant-isolation, slug-login, messaging,
                          # realtime + last-seen, notifications, account, customers, numbering,
                          # settings, calendar + scheduled-нагадування);
                          # ВИМАГАЄ Postgres І Valkey (presence-тести ходять до живих Lua-скриптів;
                          # ізоляція — окремий REALTIME_KEY_PREFIX на jest-worker, не окреме сховище).
                          # В ОКРЕМІЙ БД saas_skeleton_test (globalSetup сам створює її, гарантує ролі
                          # і мігрує під saas_migrator; тести ходять під saas_app) — dev-дані не чіпає.
                          # НЕ ганяти з піднятим dev-стеком: 14 сьютів × 2 клієнти впираються в
                          # max_connections разом із api/worker, і падає ВИПАДКОВИЙ сусідній сьют
                          # (спіймано 2026-09-07: 3 падіння → після pkill api/worker 203/203)
pnpm platform:test:e2e    # 11 тестів control plane (operator auth, tenants CRUD, jobs, cross-plane 401)
pnpm db:roles             # MT-0: ідемпотентно створює ролі saas_migrator/saas_app/saas_platform і гранти
                          # (для НАЯВНОЇ БД; свіжий volume отримує їх сам з docker/postgres/init)
pnpm db:reset             # ДЕСТРУКТИВНО (dev-only, відмовляє на нелокальному host): DROP+CREATE
                          # DATABASE → db:roles → db:migrate:deploy → db:seed за одну команду.
                          # СВІДОМО не `prisma migrate reset` — той дропає/перестворює тільки схему
                          # public, а ALTER DEFAULT PRIVILEGES прив'язаний до OID схеми: новий OID
                          # після перестворення інвалідує грант saas_app і воно лишається без прав
                          # (libs/database/scripts/reset-db.ts)
```

Після зміни контрактів/контролерів завжди: `openapi:generate` → `web:codegen` (обидва артефакти комітяться).

## Архітектура

```
apps/api        NestJS 11 (webpack-збірка). Модулі: auth, users, account (self-service «мій
                акаунт»: профіль/пароль/«вийти звідусіль»; id у шляхах НЕМАЄ),
                customers (ЕТАЛОННИЙ доменний модуль: контрагенти + контактні особи;
                написаний без жодної згадки tenantId), settings (налаштування ОРГАНІЗАЦІЇ:
                секції general і calendar + нумерація + журнал змін; запис під @Roles(ADMIN)),
                files (presigned upload/download),
                activities, notifications (персональний інбокс: курсорний список, summary,
                стани, преференси), realtime (Socket.IO-gateway namespace /tenant + presence + last-seen
                + емісія сповіщень в особистий room),
                calendar (події користувача: вікновий GET + курсорна agenda, учасники з
                RSVP, персональні нагадування; доступ за УЧАСТЮ через CalendarAccessService,
                а не через @Roles),
                health (jobs-моніторинг переїхав у platform-api на MT-3).
                Pino, AllExceptionsFilter (configureApp() в app.setup.ts — спільний сетап для main.ts і e2e)
apps/platform-api  NestJS 11 (MT-3, control plane, :3002): platform-auth (platform_users, окремий
                JWT-secret), tenants CRUD (create+перший admin атомарно, suspend/resume),
                jobs (моніторинг черг — переїхав СЮДИ з tenant-api: pgboss.* поза RLS).
                SystemPrismaModule (saas_platform, BYPASSRLS); TenancyModule НЕ імпортує (§6 плану).
                Контракти — @saas-skeleton/contracts/platform (subpath), свій openapi.json
apps/worker     NestJS 11 без HTTP (createApplicationContext). Підписники повідомлень
                (`src/subscribers/`) + cron через pg-boss, MailerService (nodemailer → Mailpit),
                плейн i18next для email-контенту
apps/web        React 19 + Vite 7, TanStack Router/Query v5, Zustand, Tailwind 4, react-hook-form,
                shadcn/ui на Base UI через libs/ui +
                next-themes (light/dark/system), react-i18next. Власного components/ui немає;
                локальним лишилось телефонне поле (libphonenumber-js + country-flag-icons).
                **Контекстна панель** (`libs/ui/.../context-panel-slot.tsx`, 2026-09-08) —
                ТРЕТЯ колонка шела, дзеркальна до сайдбара: сусід `SidebarInset`, а не його
                дитина, тож іде від верху вікна до низу і ПІДРІЗАЄ хедер справа (варіант
                «під хедером» зроблено першим і знято — панель читалась як частина сторінки).
                Її шапка — четверта `h-14` неперервної лінії шела, і хрестик закриття стоїть
                у ній справа зверху. **Поверхня — `--sidebar`** (обидві бічні колонки це
                шасі, полотном лишається тільки центр), **ширина — `--context-panel-width`
                = 18rem/288px**: крок шкали (`w-72`) і константа реєстру
                (`SIDEBAR_WIDTH_MOBILE`). Симетрія з лівою парою (274px) була другим
                значенням і знята — вмісту забракло місця; симетрія це аргумент, а не
                вимір. Змінна, а не клас, бо панель заплановано зробити тягучою.
                **Поля панелі — власна метрика `p-2` (8px), удвічі тісніша за сторінку**:
                у 288px колонці кожні 8px по краях це 6% ширини поля вводу. Тримають її
                ВСІ частини (шапка `px-2`, таби `mx-2`, вміст `p-2`), і перевіряється це
                однією вертикаллю — назва в шапці і ліва межа полів форми на одному
                піксельному стовпчику. **Горизонтального скролу в панелі не буває** —
                кожен скролер несе `overflow-x-hidden` (інакше `overflow-y-auto` вмикає
                `overflow-x: auto` сам): у 288px переповнення лікується вмістом. Два джерела,
                спіймані живим прогоном: футер форми з трьома кнопками в рядок (полагоджено
                розкладкою — головна дія на всю ширину зверху, вторинні під нею) і фантомні
                63px прихованого нативного `<input>` усередині `Switch`
                (`docs/frontend/ui-known-issues.md` UI-2 — перший відкритий запис журналу). Сторінка кладе вміст порталом (той самий
                механізм, що `page-header-slot`), кнопка показу — у правому куті хедера.
                Карта «де вже є і куди ще заводити» — `docs/frontend/app-shell.md` §5.6.
                Вона СТИСКАЄ контент, а не накриває його — тому подія календаря і зустріч
                на картці кастомера переїхали туди з `Sheet`. `Sheet` лишається для свого
                класу задач (`ActivityDrawer`, сповіщення): вікна, після якого сторінка під
                ним не потрібна. Деталі — `docs/frontend/app-shell.md` §5.6.
                **Шел — ДВА рівні навігації** (`src/app-shell/`, 2026-09-06): бренд-смуга
                над колонками + `AppRail` (смуга іконок area) + `AreaSidebar` (колонка
                активної area). Чотири area в рейлі — Workspace / Chat / Settings (лише
                ADMIN) / Playground — плюс User settings без пункту (вхід із дропдауна
                аватара). Кожна area володіє префіксом URL, активна = чиста функція від
                pathname. Довідник — `docs/frontend/app-shell.md`.
                Сторінки: Dashboard (`/workspace`), Users (грід) і **картка юзера
                `/workspace/users/$userId`** —
                окремий роут (можна дати посилання), шапка з ідентичністю/статусами/діями +
                дві колонки: зліва картки даних, справа — ПОСТІЙНА стрічка подій
                (`ActivityPanel`: власна висота, свій скрол, `sticky` з `lg`). Вкладок у
                юзера немає — після переїзду Activity у колонку лишався б один розділ.
                Стрічка — спільний `ActivityFeed` (панель картки, драйвер зі списку,
                журнал налаштувань); довантаження ЛІНИВЕ — маркер кінця списку в
                IntersectionObserver без `root`, тож вкладений скрол панелі працює сам.
                **Customers** (грід) і картка `/workspace/customers/$customerId` — та сама розкладка,
                вкладки лишились (Overview | Contacts: контактні особи — окремий розділ,
                а не блок); форк копіює її, а не вигадує.
                **Календар** — area `/calendar/$view` (day|week|month|agenda; період у
                `?date=`) + deep link `/calendar/events/$eventId`. Сітки ВЛАСНІ
                (`components/calendar/`: `TimeGrid`, `MonthGrid`, чиста `layoutOverlaps`);
                вигляд звірено з Notion Calendar (2026-09-08): лінія ГОДИНИ слабша за межу дня
                (`--calendar-grid-line`, рівень 100 проти 200), індикатор «зараз» іде через увесь
                період із однією міткою-бейджем у жолобі, заливка плитки ВИВОДИТЬСЯ з кольору
                смужки (`color-mix(… -line 22%, --card)`) і тому оголошена один раз,
                `react-day-picker` — тільки міні-місяць і поля дати. **Міні-місяць звірено з
                Notion Calendar** (2026-09-08; він теж на `react-day-picker`, тому конструкція
                переноситься один в один): смуга відкритого тижня йде краями КЛІТИНКИ, а
                позначка дня — псевдоелемент `before:` з інсетом усередині кнопки, тож вибір
                читається вкладеним у смугу; `today` більше НЕ малює заливку (реєстровий
                `bg-muted` лежав на тому самому шарі, що смуга, і вирізав у ній дірку) —
                «сьогодні» лишилось кольором цифри, заливка належить вибору. Панель події
                (`EventPanel`, з RSVP, учасниками, нагадуваннями і вкладкою Activity) живе в
                **контекстній панелі шела**, а не в `Sheet` (2026-09-08): драйвер закривав
                рівно те, заради чого подію й відкривають — сусідні зустрічі того ж дня;
                на картці кастомера — блок «Upcoming» тим самим agenda-ендпоінтом
                (і тією ж контекстною панеллю). Арифметика дат —
                `date-fns` + `@date-fns/tz` (`lib/calendar-date.ts`), форматування — `Intl`.
                **Особисті `/user-settings`** (Profile — індексний, з таймзоною; Account,
                Security, Notifications, Appearance) і **`/settings` організації**
                (General / Calendar / Numbering / Activity, гейт `requireAdmin`) — тепер ОКРЕМІ area: їхні під-розділи
                рендеряться в КОЛОНЦІ ШЕЛА, а не бічною навігацією всередині сторінки
                (`SectionNav` знятий, від `components/section/` лишився `ContentSection`)
apps/platform-web  Той самий каркас, що apps/web (MT-3, :5174, проксі на :3002), АЛЕ інша
                UI-бібліотека: shadcn/ui на Base UI (стиль base-nova, lucide-react) — див.
                правило 12 і docs/frontend/. Власного `components/ui/`
                НЕМАЄ: примітиви, грід, форми і тема живуть у libs/ui (UI-0, 2026-08-24).
                Сторінки: Tenants (плоска таблиця — GET /tenants без пагінації,
                DataGrid не потрібен) + CreateTenantModal + suspend/resume; **картка тенанта
                `/tenants/$tenantId`** (та сама розкладка, що `/users/$userId` у web: шапка +
                вкладки Overview | Access + колонка стану). Стрічки подій там НЕМАЄ навмисно:
                activities живуть у tenant-плані під RLS, платформа їх не читає; лічильника
                юзерів і джоб тенанта теж немає — відповідних ендпоінтів у platform-api не
                існує. Jobs (перенесено з web 1:1, createDataGrid). Auth-стор: access-токен (60m, без refresh) напряму в
                localStorage (не тільки в пам'яті, як web) — інакше сесія губилась би на F5
libs/contracts  Zod 4 схеми + z.infer типи — ЄДИНЕ джерело правди типів API (залежить лише від zod).
                `time/` — примітиви часу (IANA-зона перевіряється самим `Intl`, «HH:mm»,
                перший день тижня): спільні для календаря і налаштувань, тому окремий
                модуль, а не поле в `calendar.schema` (взаємні імпорти секцій = цикл)
libs/database   Prisma 7 (adapter-pg): schema, migrations, seed, PrismaService/PrismaModule (@Global).
                MT: `src/tenant/` — TenancyModule.forRoot({resolver}), TenantContextService (CLS),
                TenantTransactions.withTenantTx, tenant-extension (set_config); SystemPrismaService (BYPASSRLS)
libs/i18n       Спільні i18next-ресурси для web (common/errors/validation); worker НЕ споживає —
                свій контент локально (apps/worker/src/locales), спільного поки немає
libs/ui         Спільний UI-шар фронтів (UI-0, 2026-08-24; source-only пакет із exports-мапою,
                як libs/i18n): `styles.css` — ЄДИНА тема обох фронтів (:root/.dark, @theme inline);
                `components/ui/**` — вендорені примітиви shadcn (оновлення перевіряються через
                `pnpm dlx shadcn@4.19.0 diff <name>`, components.json лежить у пакеті);
                `components/data-grid/**`, `components/form/**`,
                `theme-switcher`, `page-header-slot` + `page-breadcrumbs` (крихти через портал у
                хедер), `user-identity`; `api/api-error.ts` (нормалізація ApiError) і
                `lib/{utils,page-items,format,error-toast}`. i18n береться з дефолтного синглтона
                `i18next` (обидва фронти конфігурують саме його, не `createInstance`), тому пакет не
                знає про неймспейси застосунків. **Споживають обидва фронти** (2026-08-26); локальним
                у застосунку лишається тільки те, що справді різне: `app-layout` (навігація й бренд),
                `toast-host` (у web два регіони тостів, у platform-web один), `api/http-client`,
                `i18n/index`, `init-auth`, стор і роутер
libs/shared     Відкладені сповіщення (`notifications/scheduled-notification.service.ts`,
                CAL-1): ScheduledNotificationService — schedule/cancel/claimDue/markDelivered
                поверх СПІЛЬНОЇ `scheduled_notifications` (не календарної). Ключ
                ідемпотентності матеріалізації — `dedupeKey` домену; exactly-once дає
                атомарний claim, а не черга.
                Нумерація (`numbering/`): NumberingService — цілі людські номери, свої в
                кожного тенанта, безрозривні (конфіг серії + лічильник із бакетом періоду);
                перший споживач — customers, наступний — документи.
                Повідомлення (`messaging/`, EDA-1): defineEvent/defineCommand (Zod payload),
                MESSAGE_TOPOLOGY (маніфест підписок), MessagePublisher.publish(tx, …) —
                транзакційний fan-out, @MessageSubscriber + DiscoveryService-автореєстрація,
                конверт, MessageInboxService (processed_jobs), спільна dlq, PgBossService.
                Сховище: StorageService (@aws-sdk/client-s3: presign PUT/GET, head/get/put/delete,
                ensureBucket+CORS на старті) + StorageModule (@Global).
                Сповіщення (`notifications/`): NotificationRecorder.notify(tx, …) + recipientsByRole,
                NotificationStateService (revision/seen/summary), NotificationDispatcherRegistry
                (транспорт реєструє процес: api — RealtimeEmitter, worker — headless Server),
                спільний мапер (той самий рядок їде і в REST, і в socket)
docker/         compose (name: saas-skeleton — namespaced volume, НЕ прибирати name!): Postgres 17,
                Mailpit (SMTP :1025, UI :8025), SeaweedFS (S3 :8333, creds — seaweedfs/s3.json).
                docker-compose.prod.yml (перевірений димовим прогоном): self-hosted прод на одному
                сервері — дані в замаплених хостових директоріях ${SAAS_DATA_DIR}/{postgres,seaweedfs}
                (бекапити узгоджено!), теги запінені, порти тільки 127.0.0.1 (назовні — reverse proxy
                з TLS, для S3 зберігати Host — він у SigV4-підписі), без Mailpit. Креденшели:
                seaweedfs/s3.prod.json + .env.production (обидва gitignored, є .example);
                `pnpm docker:prod:up/down`
```

**Конвеєр типів:** Zod-схема (`libs/contracts`) → `createZodDto` (nestjs-zod v5) → Swagger
(`@ApiOkResponse({ type: Dto.Output })`, `cleanupOpenApiDoc`) → `openapi.json` → orval →
TanStack Query hooks (`useAuthLogin`, `useUsersFindAll`, …). Ручних типів API не існує.

**Auth (порт із fibo-admin, MT-1 2026-07-16):** access JWT 15m (`{ sub, email, role, tenantId }` —
tenantId ЗАВЖДИ з рядка БД) + refresh **`tenantId:tokenId:secret`** (тенант на /refresh резолвиться
з префікса токена; secret → argon2-хеш у `refresh_tokens`), ротація на кожен refresh,
theft detection (невірний secret при валідному tokenId → відкликання всіх сесій юзера).
**register ВИДАЛЕНО зовсім** — юзерів створює tenant-адмін (create user), тенантів — platform-api (MT-3).
Login шукає юзера findFirst у резолвленому tenant-і й перевіряє і `user.isActive`, і `tenant.isActive`
(однаковий 401). Глобальний `JwtAuthGuard` (APP_GUARD, без Passport) звіряє `payload.tenantId`
з резолвленим контекстом і перезаписує CLS; відкриті роути — `@Public()`.
**`POST /auth/logout`** (публічний, ідемпотентний 204) — клієнт здає свій refresh-токен, рядок
зникає; «вийти звідусіль» — `POST /account/sessions/revoke-all` (див. `docs/account-settings.md`).
Фронт: access-токен тільки в пам'яті (Zustand), refresh у localStorage `saas_refresh_token`,
axios-інтерсептор із single-flight refresh на 401 (`apps/web/src/api/http-client.ts`).

**Помилки (фаза 2.2, наскрізний контракт):** єдиний envelope `ApiError` у `libs/contracts/src/error/`:
`{ statusCode, code (закритий enum), message, fieldErrors?: [{field, message}], requestId }` — фронт імпортує
тип напряму з contracts (без OpenAPI-шляху). Бекенд: `AllExceptionsFilter` (`@Catch()`) нормалізує ВСЕ:
ZodValidationException → 400 VALIDATION_ERROR + fieldErrors з issue paths; Prisma P2002 → 409 + поле
(УВАГА: Prisma 7 + adapter-pg кладе поля в `meta.driverAdapterError.cause.constraint.fields`, НЕ в
`meta.target`; а при недоступній БД кидає код `ECONNREFUSED`, НЕ P1001 — обидва перевірені на живо);
P2025 → 404; ECONNREFUSED/P1xxx/P2024 → 503; будь-який 5xx-message маскується ("Internal server error",
деталі тільки в лог з requestId). Явний 409 з полем — `fieldConflictException()` (`common/errors.ts`).
Фронт: `parseApiError()`/`isGlobalApiError()` (`libs/ui/src/api/api-error.ts` — спільний для обох
фронтів із UI-0); network/5xx/403 → `toast.add({ type: 'error' })` (глобальні QueryCache/MutationCache
onError у main.tsx, дедуп 5с; регіони тостів задає `ToastHost` застосунку);
401 → refresh-інтерсептор; 4xx у формах — `applyServerError(error, form)`: fieldErrors → setError по
імені поля (звірка з getValues, тому форми МУСЯТЬ мати повні defaultValues), решта → errors.root.server.

**Асинхронні повідомлення (EDA-0/EDA-1, `libs/shared/src/messaging/`):** ЄДИНИЙ шлях виконання
асинхронної роботи — другого немає. Два примітиви, один рантайм:
`defineEvent('x.y.v1', schema)` — факт, 0..N підписників, версія в імені **на рівні типу**
(`` `${string}.v${number}` ``); `defineCommand('x.y', schema)` — наказ, РІВНО один споживач, без
версії. Обидва беруть `{ scope: 'tenant' | 'system' }` (system = cron/крос-tenant, БД через
`SystemPrismaService`); `tenantId` у схемі НЕ оголошується — він у конверті.

- **Продюсер** (`MessagingModule.forProducer()` у api/platform-api) → інжект `MessagePublisher` →
  `publish(tx, def, data, { actor?, singletonKey?, startAfterSeconds?, priority? })`. **`tx` —
  перший обовʼязковий аргумент** (те саме правило, що в `ActivityRecorder.record`): опублікувати
  повідомлення поза транзакцією доменної зміни фізично неможливо.
- **Fan-out робить publish, а не хендлер.** `MESSAGE_TOPOLOGY` (`topology.ts`) — єдине місце, де
  видно всю асинхронну топологію: повідомлення → його споживачі (`{ id, retryLimit?, policy? }`)
  → `cron?`. Один `publish` = по `INSERT` у чергу кожного споживача в тій самій транзакції,
  послідовно і fail-fast. Черга на споживача — `{message}/{consumer}` (роздільник `/`: pg-boss
  приймає лише `[a-zA-Z0-9_\-./]`). Додати підписника = рядок у маніфесті + новий клас; жоден
  наявний файл не редагується.
- **Споживач** (`MessagingModule.forWorker()`): `@Injectable() @MessageSubscriber({ definition, id })
class X implements MessageSubscriberContract<typeof def.schema>` із `handle(data, envelope)`.
  Знаходиться через DiscoveryService; **розсинхрон із маніфестом валить старт воркера** в обидва
  боки (оголошений споживач без класу → job-и копичились би в нечитаній черзі; клас без
  оголошення → мертвий код).
- **Конверт** (`message-envelope.ts`, однаковий для подій і команд): `messageId` (ключ
  ідемпотентності бізнес-факту), `name`, `occurredAt`, `tenantId`, `actor` (та сама форма, що
  `ActivityActor` — реальна людина доїжджає до підписника), `correlationId` (на HTTP-вході =
  pino `req.id`, він же `ApiError.requestId`), `causationId`. CLS не перетинає межу процесу —
  registrar відновлює з конверта і tenant-контекст (RLS), і ланцюг (похідна публікація всередині
  споживача успадковує correlation/causation автоматично).
- **Ідемпотентність — по бізнес-факту, не по job-у:** `MessageInboxService.runOnce(envelope,
consumerId, fn)`, ключ `messageId:consumerId` у `processed_jobs`. Захищає не лише від ретраю
  job-а, а й від повторної ПУБЛІКАЦІЇ того самого факту; суфікс consumerId — щоб підписники не
  блокували один одного. Маркери чистить cron `maintenance.cleanup-processed-jobs` (30 днів —
  свідомо більше за retention pg-boss).
- **Помилки:** `NonRetryableMessageError` (невалідний конверт, порушене бізнес-правило) → одразу
  у спільну `dlq`, не спалюючи retry-ліміт; решта (БД/SMTP/мережа) ретраїться з backoff. DLQ
  одна на всю систему.
- Еталон fan-out-у: `users.user-registered.v1` → підписник `welcome-email` (0 проміжних хопів;
  рукописний `UserRegisteredHandler` видалено). Команди: `files.generate-thumbnail`,
  `auth.cleanup-expired-tokens`, `files.cleanup-orphans`, `maintenance.cleanup-processed-jobs`.

Історія job-ів — стандартний retention pg-boss ~7 днів (рішення користувача, окремої таблиці немає).
Моніторинг — сторінка /jobs у platform-web (фільтри state/queue в URL, автооновлення 5s);
екран DLQ і replay — EDA-2, ще попереду.

**Email (I18N-3, `apps/worker`):** `WelcomeEmailSubscriber` — реальна відправка (не заглушка): читає
`locale`+`name` СВІЖИМИ з БД по `data.userId` (не з payload — стан міг змінитися між публікацією
і обробкою), рендерить subject/body через плейн `i18next` (`apps/worker/src/i18n`,
`{ lng: locale }`) з `apps/worker/src/locales/en/notifications.json`, шле через `MailerService`
(nodemailer, дефолти на Mailpit). Це at-least-once side effect (не exactly-once як БД-ефекти
через `MessageInboxService`) — pg-boss retry після падіння ПІСЛЯ успішного sendMail надішле лист
повторно; прийнятно для welcome-листа, для платіжних/юридичних листів треба claim-before-send
(`docs/event-driven-architecture.md` §3.10). Активність `email.sent` пишеться ПІСЛЯ `sendMail`
через inbox, актором із конверта (реальний адмін, не система).

**Файли (Files v1, зафіксовані рішення):** S3 API = абстракція сховища (окремого StorageDriver
немає, аналогічно pg-boss): dev — SeaweedFS з compose, прод — будь-який S3 через env `S3_*`.
MinIO НЕ використовувати (репо заархівовано 04/2026). Флоу двофазний: `POST /files` (Zod-валідація
allowlist MIME/розміру → PENDING-рядок у `files` + presigned PUT, TTL 10 хв) → браузер PUT напряму
в сховище (минаючи API; байти через NestJS не течуть, контракти лишаються JSON-only) →
`POST /files/:id/complete` (HeadObject: об'єкт існує + розмір збігається; magic bytes через
`file-type` звіряються з заявленим MIME — Content-Type клієнта недовірений; невалідний вміст →
видалення об'єкта і рядка + 400; повторний complete — ідемпотентний no-op) → READY. Ключі
`{yyyy}/{mm}/{uuid}.ext` (префікс під майбутній tenantId), назовні НЕ віддаються — доступ до байтів
тільки `GET /files/:id/download-url` (presigned GET, TTL 5 хв, тільки READY; `?variant=thumbnail`
з fallback на оригінал). Після complete зображень — джоба `files.generate-thumbnail` (worker, sharp
256px webp, ідемпотентна без inbox); покинуті PENDING чистить cron `files.cleanup-orphans` (24h,
спершу S3-об'єкт, потім рядок). `attachments` (полиморфні fileId+entityType+entityId) — таблиця під
майбутні домени, API поки немає. Демо-споживач: `users.avatarFileId` (PATCH валідує READY+image) →
`UserResponse.avatarUrl` = presigned GET мініатюри (в JSON, бо `<img>` не шле Authorization; auth-роути
аватар не пресайнять — тільки users). Фронт: `useFileUpload` (create→PUT з progress→complete, сирий
axios без інтерсепторів) + `FileDropzone` (свій — дропзони немає і в реєстрі shadcn; оболонка
складена з `Empty`+`Button`) + `ChangeAvatarModal` (row action
на /users). E2E: StorageService підміняється in-memory фейком (`overrideProvider`), file-type замокано
міні-детектором magic bytes — живий SeaweedFS тестам не потрібен.

**DataGrid (`apps/web/src/components/data-grid/`, обидві сторінки /users і /jobs на ньому):**
публічний API — фабрика `createDataGrid<TFilters, TItem>()` на рівні модуля сторінки (аналог
defineFilters: замикання фіксує типи один раз, свій createContext на виклик → усе типізовано без
кастів). Повертає компаунд-набір: `Grid.Root` (тримає ВЕСЬ стан — фільтри в URL, query, selection —
і роздає контекстом), `Grid.Filters` (тулбар; фільтри масивом як columns), `Grid.Table`,
`Grid.SelectionSummary` («N selected» + Clear + опційний render-prop для bulk-дій), `Grid.filter`
(фабрики `search()`/`select({ key, options })`). Фетчинг: сторінка декларує «як фетчити» пропом
`useListQuery={(params, gridOptions) => useUsersFindAll(params, { query: gridOptions })}` —
замикання виконується ЯК ХУК усередині Root (мусить безумовно кликати той самий orval-хук; імʼя
пропа use* — вимога rules-of-hooks); Root сам домішує keepPreviousData і нормалізує page;
розширення — спред `{ ...gridOptions, refetchInterval }` (еталон — jobs.tsx). Саме замикання, а НЕ
queryOptions-обʼєкт: orval-хуки мають 4 перевантаження + DataTag, generic-over-hook плутає
виведення типів. Вибір рядків: `selection` на Root — `true` (внутрішній стан) або зовнішній
`useDataGridSelection()` (controlled); Root сам скидає вибір при зміні ЗВУЖУВАЛЬНИХ фільтрів
(пошук/доменні — вибрані рядки могли випасти з результату), але НЕ при page (накопичення між
сторінками — фіча) і НЕ при сортуванні (склад результату той самий). Кастомний бізнес-фільтр = обʼєкт `{ id, render(grid) }`
(еталон — `userStatusFilter` в users.tsx). Headless-нутрощі експортовані як escape hatch:
`useDataGridFilters` (validateSearch роуту = runtime-гарантія TFilters; debounce пошуку, скидання
page), `toGridQueryResult` (затемнення по `isPlaceholderData`, НЕ `isFetching` — інакше
refetchInterval блимає). Boolean-фільтри в URL/query їдуть РЯДКОМ `'true'/'false'` (wire-формат;
не reuse transform-схем contracts, що дають boolean). «Search» у назвах TanStack Router = URL
query, не текстовий пошук — у гріді все зветься Filters. Інвалідація списку після мутацій — за
сторінкою (queryClient + `getUsersFindAllQueryKey()`), грід нею не володіє.

**Шари backend-модуля (обов'язково):** DTO (`createZodDto` зі схеми contracts) → Service
(логіка + Prisma) → Mapper (явний мапінг Prisma→response; не витікають `passwordHash` тощо) →
Controller (HTTP + Swagger-метадані). Відповіді: сутність — плоский об'єкт;
список — `{ items, total, page, limit, totalPages }`.
**Юзер у відповіді — ВКЛАДЕНИЙ `{id, email, name}`, якщо це жива сутність із FK**
(`customer.owner`, `calendarEvent.owner`, `attendees[].user`); плоска трійка
`actorType`/`actorId`/`actorLabel` лишається ТІЛЬКИ для снапшотів без FK (activities,
notifications — юзера могли видалити, а актором буває `system`). Плоскі `userId`/`email`
на вкладеному ресурсі — запах: кожне нове поле юзера доводиться дописувати префіксом
(`userAvatarUrl`…). На ВХІД натомість ідуть плоскі id (`attendees: [{ userId, role }]`):
запит адресує, відповідь описує. Дубль `ownerId` поруч із `owner` легальний там, де ним
фільтрує грід (`customers`), і зайвий там, де ні.

## Критичні правила та підводні камені

1. **Нова shared-ліба** = три місця: `tsconfig.base.json` paths + `apps/api/tsconfig.json` paths +
   `apps/api/webpack.config.js` alias/allowlist (tsc НЕ переписує aliases — саме тому webpack).
2. **Zod 4**: нормалізація ДО валідації — `z.string().trim().toLowerCase().pipe(z.email())`
   (формат-перевірки виконуються до transform-ів). Не використовувати `z.coerce.date()` у
   response-схемах — **дати в контрактах тільки `z.iso.datetime()`** (ISO-рядки, wire-формат);
   мапери роблять `date.toISOString()`.
3. **Response-DTO**: `Dto.Output` працює лише із Zod 4; для OpenAPI обов'язковий
   `cleanupOpenApiDoc()` (nestjs-zod v5; `patchNestJsSwagger` — застарілий v4 API).
4. `operationIdFactory` у `apps/api/src/openapi.config.ts` дає `authLogin`/`usersFindAll` —
   з них orval генерує назви хуків. Не змінювати без регенерації фронта.
5. Логи пишуться в `join(process.cwd(), 'logs')` — команди api запускати з cwd `apps/api`
   (pnpm --filter це гарантує).
6. ESLint: strict-type-checked всюди; для `apps/web` вимкнено explicit-return-type;
   `throw redirect()` TanStack Router — легальний виняток only-throw-error (інлайн-disable).
7. pnpm 10 блокує build-скрипти — список дозволених у root `package.json` → `pnpm.onlyBuiltDependencies`.
8. **pg-boss v12 — ESM-only**: (а) він external у webpack-збірках → має бути ПРЯМОЮ залежністю
   apps/api і apps/worker (pnpm-строгість); runtime ок — Node 24 вміє require(esm);
   (б) Jest його не вантажить (потрібні Node ≥24.9 + experimental-vm-modules) → у e2e
   він замокан через `moduleNameMapper` (`apps/api/test/__mocks__/pg-boss.ts`); зникне з міграцією на Vitest.
9. **pg-boss send-опції**: не передавати ключі зі значенням `undefined` — його attorney-валідація
   падає (`priority must be an integer`). Опції збирати умовно (див. `MessagePublisher.publish`).
10. **@aws-sdk/client-s3 + presigned PUT**: обов'язково `requestChecksumCalculation: 'WHEN_REQUIRED'`
    (+ response-аналог) у конфігу S3Client — інакше SDK вшиває в presigned URL CRC32-чексуму
    ПОРОЖНЬОГО payload (`x-amz-checksum-crc32=AAAAAA==`), сховище валідує її проти реального тіла
    і відхиляє upload 400-кою (спіймано на живому SeaweedFS). SDK — пряма залежність apps/api,
    apps/worker і libs/shared (webpack externals, як pg-boss).
11. **file-type — ESM-only** (та сама категорія, що pg-boss): types не резолвляться під
    moduleResolution=node10 → ручна декларація `apps/api/src/types/file-type.d.ts`; ts-node її бачить
    лише з `"ts-node": {"files": true}` у tsconfig (без цього openapi:generate падає); у e2e замокано
    через moduleNameMapper (`test/__mocks__/file-type.ts`). Runtime ок — Node 24 require(esm).
12. **UI — один стек на обидва фронти: shadcn/ui на Base UI** (стиль `base-nova`, CLI 4.19.0).
    **Повний довідник — `docs/frontend/ui-stack.md`**; нижче — те, що мусить бути під рукою.
    Спільний код живе в **`libs/ui`** (див. блок про нього в «Архітектурі»): вендорені примітиви
    `components/ui/**`, грід, форми, `theme-switcher`, `api/api-error.ts`, тема `styles.css`.
    Оновлення примітивів — `pnpm dlx shadcn@4.19.0 diff <name>` У ПАКЕТІ (`components.json` є
    і в пакеті, і в кожному застосунку; app-конфіг тримає `components`/`lib`/`hooks` локально,
    а `ui`/`utils` і CSS теми спрямовує в `libs/ui` — блоки не потрапляють у пакет);
    імпорти всередині пакета — самопосилання `@saas-skeleton/ui/…`.
    `index.css` застосунку = `@import 'tailwindcss'` + `@import '@saas-skeleton/ui/styles.css'` +
    `@source '../../../libs/ui/src'` (без `@source` Tailwind не бачить класи пакета).
    Аліас `@/*` (локальний код застосунку) дублюється в `tsconfig.json` І `vite.config.ts` —
    vite не читає tsconfig paths. Тема — лише `class` (`attribute="class"`; storageKey
    `saas_theme` / `saas_platform_theme`).
    Композиція замість compound-неймспейсів (`DialogContent`/`DialogTitle`, `TableHead`/`TableCell`,
    `DropdownMenuItem`), підміна елемента — `render={<Button/>}` (Base UI), НЕ `asChild`.
    Іконки — `lucide-react` (перегляд правила «без пакетів іконок»). Семантичні токени:
    `bg-background/bg-card/bg-sidebar/bg-popover`, `text-foreground/text-muted-foreground/text-destructive`,
    `border-border`, `bg-accent` = наведення І вибране (один фон на обидва стани — див. нижче),
    (НЕ бренд — бренд це `primary`); окремого «сильнішого» рівня в темі НЕМАЄ навмисно —
    `--accent-strong` прожив кілька годин і був знятий, щойно його єдиний споживач перейшов на
    `--accent`: токен на один випадок це не рівень шкали, а виняток із неї. **`accent` — ПРОЗОРА накладка, а не поверхня**
    (2026-09-08): суцільний колір програвав за визначенням — у шела три поверхні на різній
    світлоті, а в темряві попап ще й світліший за картку, тож значення, підібране під полотно,
    на сайдбарі зливалося. Накладка дає однакову різницю до БУДЬ-ЯКОГО фону під нею. Технічно —
    `color-mix(in oklab, var(--foreground) N%, transparent)` на рівнях парної шкали Notion
    Calendar `--ca-palTraGra*` (300 — наведення, вибране й активне разом); база `--foreground`, а не
    чистий чорний/білий, бо нейтралі теми теплі. **Межа застосування**: тільки елементи БЕЗ
    власного фону (ghost/outline/toolbar-кнопка, іконкова кнопка, пункт меню й навігації, рядок
    таблиці, комірка календаря, `Badge` ghost/outline, `Toggle` outline); там, де фон Є
    (`--field`, `--secondary`), накладка-заміна показала б полотно замість поверхні елемента —
    ті місця лишаються на суцільних `*-hover`. Зони календаря (`--calendar-*`) — та сама шкала,
    рівні 75/100. **Тінь оверлея не заводить власного кольору межі**: hairline у
    `--overlay-shadow` бере `var(--border)` — доки він був суцільним `#383836`, кожен оверлей із
    власним `border` (тост помилки, картка сповіщення) малював ДВА кільця різних відтінків, і це
    читалось як «межа 2px і розмита». Деталі — `docs/frontend/theming.md` §1.3.3 і §1.3.5;
    `success`/`warning` — наше розширення теми (варіанти в cva `ui/badge.tsx`).
    **`--segment` у темряві — ІНВЕРСІЯ, а не світліший сірий** (2026-09-08): у світлі активний
    сегмент це біла плитка з обводкою й тінню на сірому жолобі, у темряві та сама роль вимагає
    протилежного ходу, бо тіні на темному не працюють і підняття передається СВІТЛОМ — 96%
    кольору тексту з темним написом (не 100%: чиста біла на темному ріже око). Патерн Notion.
    Той самий матеріал доступний як `Button variant="elevated"`; жолоб табів при цьому —
    прозора накладка `bg-accent`, бо таби стоять і на картці, і на полотні, і в тулбарі.
    **Іконки мають ВЛАСНУ шкалу з ТРЬОХ рівнів, а не колір тексту** (правило Notion: там поруч зі
    шкалою `--c-tex*` живе окрема `--c-ico*`): суцільна форма знака важить оком більше за штрихи
    літер, тож зрівняні в кольорі вони перетягують увагу. `--icon-strong` — знак під ВЗАЄМОДІЄЮ
    (наведення АБО активний пункт), `--icon` — звичайний знак поруч із текстом, `--icon-muted` —
    службовий (шеврон селекта, адорн поля). **Знак реагує на взаємодію КОЛЬОРОМ** — це єдине
    місце в темі, де стан елемента міняє колір ЗНАКА, а не лише фон під ним, і саме воно робить
    навігацію живою при майже невидимій накладці фону. Наслідок: наведення і вибране мають
    ОДНАКОВИЙ фон (`--accent`) — два різні відтінки сірого поруч читались як дві різні речі,
    тоді як різницю несе знак (46% у спокої проти 87% під курсором). **Ставлять токен
    ПРИМІТИВИ `libs/ui`, не сторінки** — `button` (лише нейтральні варіанти
    `outline`/`secondary`/`ghost`/`toolbar`: у суцільних `default`/`destructive` знак мусить
    лишатись кольором foreground заливки), `sidebar` (обидва рівні навігації, `data-active`
    перемикає на `--icon-strong`), пункти `dropdown-menu`/`context-menu`/`select`/`combobox`,
    шеврон селекта і адорни `input-group`. Селектор скрізь
    `[&_svg:not([class*='text-'])]:text-icon` — `:not` лишає недоторканими знаки з власним
    кольором. **У навігації колірне правило звужене до ПРЯМОГО нащадка** (`[&>svg]`; розмір
    лишився на `[&_svg]`): селектор нащадка перебиває успадкування, тож ширший варіант фарбував
    сірим і логотип у бренд-плитці рейлу — а він лежить на СИНІЙ підкладці й мусить брати її
    `foreground`. Правило: на кольоровій підкладці знак бере foreground цієї підкладки.
    **Джерела двох режимів РІЗНІ, і це не недогляд**: світло — суцільні сірі `app.notion.com`
    (`icoPri`/`icoSec`/`icoTer`), темрява — білий З АЛЬФОЮ з `calendar.notion.so`
    (`--nds-translucentGray-700/600/500` = 56.5/44.5/28.3%, де `-600` це одночасно `--text-body`
    і `--nds-icon-contr-graySecondary`, тобто буквально іконка їхнього меню). У двох продуктах
    Notion щільність знака відрізняється ВДВІЧІ (`#ada9a3` проти 0.445), і на нашому темному
    полотні правильно виглядає календарна. Альфу кладемо на ТЕПЛИЙ білий теми (`#f0efed`), не на
    чистий `#fff` — інакше знаки поїхали б у холодний сірий; і альфа тут не стилістика: вона
    тримає знак у правильному відношенні до полотна, картки й попапа (він світліший за картку)
    одночасно, чого суцільний hex не вміє. Наслідок, який легко проґавити: `bg-border` для
    ПОВЗУНКА скролбара після цього перестав працювати (5.5% — це невидимість), тому
    `scroll-area.tsx` бере `bg-icon-muted`. Деталі — `docs/frontend/theming.md` §1.3.2.
    **Дефолтна тема — `gray`, і її два режими взяті з РІЗНИХ джерел** (2026-09-08,
    рішення користувача; живе в `:root`/`.dark` файла `libs/ui/src/styles.css`).
    **Світло** — zinc-нейтралі HeroUI v3 (попередня тема `gray`, її файл видалений і
    переїхав у `:root`): усі три поверхні шела однакові (`--sidebar` = `--background`),
    глибину дають межі й тіні. **Темрява — темний Notion ЦІЛКОМ**: не «схоже на», а
    ВЛАСНІ токени з живого CSS-бандла `app.notion.com` (`/_assets/84388-*.css`, 265
    перевизначень `--c-*` у `.notion-dark-theme`), кожен рядок підписаний іменем
    токена-джерела. Полотно `#191919`, сайдбар і картки `#202020`, muted `#262626`,
    наведення `#2c2c2b`, розділювач `#2c2c2b` (`borSec`), обводка поля `#383836`
    (`borPri`), текст `#f0efed`/`#ada9a3`, primary `#2383e2` (hover `#0077d4`),
    destructive `#de5550`;
    а **попап СВІТЛІШИЙ за картку — `#252525`** (у Notion висота передається світлом, не
    тінню; в обох попередніх темах `--popover` дорівнював `--card`). Асиметрія свідома:
    тема — це контракт РОЛЕЙ, а не одна палітра на два режими (їх ніхто не бачить
    одночасно), тому похідні токени одного режиму НЕ виводяться з іншого — обидва блоки
    оголошують повний набір. Світла палітра Notion була дефолтом кілька годин того ж дня
    і **відкинута**; окремої теми `notion` у реєстрі немає. `--radius: 0.625rem` і шрифт
    **Inter** — без змін. Альтернативна тема одна — `slate` під `data-theme` (палітра
    `satnaing/shadcn-admin`, `baseColor: "slate"`). Контракт тем, таблиця мапінгу і
    компроміс `success`/`warning` — `docs/frontend/theming.md` §3.1.
    **Свідоме відхилення від стоку** (рішення користувача, НЕ переглядати без запиту):
    метрика однорядкових контролів 36px — Notion щільніший (28–32px), але метрики в тему НЕ
    переїжджають (рішення 2026-09-08: беремо кольори, тіні й радіус, компоненти не чіпаємо). `textarea` лишається `min-h-16`. Висота/padding/focus geometry — рецепт
    компонента, не тема; тема тримає semantic color pairs, typography і radius.
    `--success`/`--warning` — наше розширення (у shadcn таких ролей немає), а кожна суцільна
    semantic pair використовує свій `*-foreground`, не хардкод `text-white`.
    RHF: `useController` → `Field`+`FieldLabel htmlFor`+`Input id` (`useId()`)+`FieldError`, стан
    через `data-invalid` на `Field` і `aria-invalid` на контролі; `FormSelect` мусить діставати
    `items` (без мапи value→label Base UI малює в тригері сире значення).
    **Крихти сторінок — через портал** (UI-5): сторінка рендерить `PageBreadcrumbs`, а
    `PageHeaderPortal` (`libs/ui/src/components/page-header-slot.tsx`) телепортує розмітку
    в слот хедера layout-а. Портал міняє лише місце в DOM — дерево React те саме, тож
    `Link` роутера й контексти сторінки працюють як звичайно. Новий вміст хедера додається
    без зміни контракту layout-а.
    **Розкладка шела різна у двох фронтах.** `apps/platform-web` — патерн `sidebar-07`
    реєстру (UI-3): бренд-плитка + назва + підзаголовок у `SidebarHeader`, профіль юзера
    з дропдауном у `SidebarFooter` (`UserIdentity` живе в `libs/ui`), у хедері лише
    `SidebarTrigger` + дзвінок + тема; `collapsible="icon"`. `apps/web` — **два рівні
    навігації** за патерном `sidebar-09` (2026-09-06): смуга іконок area (бренд угорі,
    профіль у футері) + колонка активної area зі своєю шапкою; `SidebarTrigger`/Cmd+B
    тепер ховають ДРУГУ колонку, рейл лишається. Правила, метрики і граблі —
    **`docs/frontend/app-shell.md`** (там же — єдине свідоме відхилення від блоку). **Звідки брати нові компоненти й блоки — `docs/frontend/ui-registry.md`**
    (порядок `@shadcn` → `@coss` → `@reui` → референси + чекліст). Чужу обгортку над тим самим
    примітивом НЕ ставимо поверх нашої: імена файлів збігаються, а частини звуться інакше
    (`SelectPopup` у Cal.com проти нашого `SelectContent`).
    **Кустарних обгорток над примітивами не заводимо**: медіа-обʼєкт — `Item*`, порожні стани —
    `Empty*`, індикатор на аватарі — `AvatarBadge`, набір фільтрів — `ToggleGroup`, бокова панель —
    `Sheet` (а якщо сторінка під нею мусить лишитись видимою — `ContextPanelPortal`, див.
    `docs/frontend/app-shell.md` §5.6), навігація — `Sidebar*`, прокрутка — `ScrollArea`.
    Якщо примітив є в реєстрі, свій не пишемо
    (виняток — `FileDropzone`: дропзони в реєстрі немає, але його оболонка теж складена з `Empty`+`Button`).
    **Вкладеність HTML**: `AlertDialogDescription`/`ItemDescription` уже є `<p>`, а `Item render={<button/>}`
    уже є `<button>` — не класти всередину ще один абзац/кнопку (React пише про це в консоль).
    **Частини, що вимагають батька, Base UI перевіряє в РАНТАЙМІ**: `DropdownMenuLabel` — це
    `MenuPrimitive.GroupLabel`, без `DropdownMenuGroup` навколо падає з `MenuGroupContext is
    missing` уже в браузері. Головна пастка переносу блоків реєстру (вони писались під Radix,
    де лейбл лежить прямо в `DropdownMenuContent` — див. `nav-user`), і компілятор її не бачить:
    кожен перенесений дропдаун ВІДКРИВАТИ руками.
    **Бекендні tsconfig-и НЕ мають підбирати фронтові ліби**: `include` у
    `apps/{api,platform-api,worker}/tsconfig*.json` перелічує `libs/{contracts,database,shared}`
    ЯВНО — колишній wildcard `libs/*/src/**/*` затягнув `libs/ui` у webpack-збірку і дав 353
    помилки `TS17004` (turbo при цьому віддавав закешований зелений typecheck — перевіряти `--force`).
    **Метрика однорядкових контролів — 36px** (друге з двох відхилень від стоку): `default`
    кнопка, `input`, `select`, `input-group` мають 36px; кнопки `sm` 32, `xs` 28, `lg` 40,
    іконкові `size-7/8/9/10`; `textarea` лишається `min-h-16`, відступи полів `px-3`.
    Фокус — **суцільне `ring-2`** кольору `--ring`: у кнопок із `ring-offset-2` кольору фону,
    у полів без відступу. Нову висоту не задавати класом на місці використання — вона дефолтна.
    **Прокрутка — оверлейна смуга, що згасає** (2026-09-09, еталон — список чатів Telegram
    Web): `ScrollArea` з `libs/ui` замість нативного `overflow-y-auto` скрізь, де скрол бачить
    людина. Рецепт Telegram (`scrollbar-color: transparent` + `:hover`) СВІДОМО не копіювали:
    він не дає оверлея (місце резервує `overflow: scroll`, «накладання» імітує відʼємний
    падінг), у Chrome не анімується (переходів на `::-webkit-scrollbar-*` немає) і не має
    тригера «під час прокрутки». Base UI ховає нативну смугу і малює свою `div`-ом: `absolute`
    → справжній оверлей, `opacity` → плавність скрізь, `data-scrolling` + `data-hovering` →
    обидва тригери. **Тривалості асиметричні**: поява 75–100 мс (супроводжує дію), згасання
    500 мс (не супроводжує) — базовий клас тримає довгу `duration`, станові перебивають
    короткою. Невидима смуга — `pointer-events-none`, інакше крала б кліки в останніх 8px
    рядка. Керована прокрутка (`scrollTo`, автоскрол перетягування) — через `viewportRef`.
    **Вісь `vertical` за замовчуванням**: горизонталь глушиться ІНЛАЙНОВИМ стилем на viewport
    (клас не переб'є інлайновий `overflow: scroll` від Base UI), тож ручні `overflow-x-hidden`
    більше не потрібні — так у примітиві оселилась політика «вузька поверхня не скролиться
    вбік» разом із обходом фантомних пікселів `Switch` (UI-2). **Висота — через flex**
    (корінь `flex flex-col`, viewport `min-h-0 flex-1`), а НЕ `h-full` і не `absolute inset-0`:
    перший мовчки стає `height: auto` під предком з `max-height` (відсоток резолвиться проти
    SPECIFIED висоти, а `flex-1` передає розмір без його визначеності) — у діалозі це давало
    viewport 1953px замість 602, скрол не вмикався і `overflow-hidden` різав половину форми;
    другий ламає протилежне — корінь у контейнері з `max-height` отримує нуль. **Товщина —
    `size`**: `default` 8px, `lg` 10px тільки для головного скролу сторінки (перша спроба
    12px читалась як елемент інтерфейсу, а не службовий індикатор — оверлейна смуга забирає
    зайві пікселі не в розкладки, а в уваги).
    **Скрол сторінки теж переїхав** (2026-09-09): `SidebarInset` став `h-svh overflow-hidden`
    + `ScrollArea size="lg"`, вікно не скролиться, хедер вийшов зі скролера (більше не
    `sticky`, фон суцільний), а `sticky` всередині контенту рахується від верху СКРОЛЕРА —
    `ActivityPanel` через це переїхав з `lg:top-[4.5rem]` на `lg:top-4`; **прокрутку при
    переході між сторінками скидає `scrollTo({top:0})` на зміну `pathname`** — доки скролило
    вікно, це робив браузер. **Обгортка `ScrollAreaPrimitive.Content` ОБОВʼЯЗКОВА** (у
    реєстровому shadcn її немає): без неї зміна ВИСОТИ ВМІСТУ без зміни розміру viewport не
    перераховується, і смуга залипає після переходу з високої сторінки на коротку; класи
    вмісту йдуть у `contentClassName`. Граблі перевірки: **Chrome морозить `ResizeObserver`
    у фоновій вкладці** (layout рахується, колбеки не йдуть) — перед пошуком регресії
    дивимось `document.visibilityState`. Застосовано також у
    сітках календаря і в контекстній панелі; стенд для перевірки діалогів —
    `/playground/dialog` (високий і короткий діалог тією самою розміткою). Готовий шаблон
    панелі — `docs/frontend/app-shell.md` §5.6, карта решти скролерів —
    `ui-stack.md` § «Прокрутка».
    **Регіони тостів** (позиції спільні для обох фронтів, склад різний): помилки API — знизу
    праворуч, живі сповіщення — зверху праворуч під дзвінком, `/login` — знизу по центру.
    **Правки вендореного коду позначаються коментарем «ЛОКАЛЬНА ПРАВКА реєстру»**: позиція
    тостів у `ui/toast.tsx`, indeterminate-іконка в `ui/checkbox.tsx`, `success`/`warning` і
    доступні soft-фони в `ui/badge.tsx`, суцільний `destructive` + метрика/фокус у
    `ui/button.tsx`, метрика в `ui/{input,textarea,select,input-group}.tsx`; у `ui/select.tsx` —
    `alignItemWithTrigger: false` (попап відкривається ПІД тригером, а не накриває його);
    у `ui/input.tsx` — глушник autofill і скидання `::-webkit-search-cancel-button`;
    фокус-кільце `ring-2` — наскрізна заміна в інтерактивних примітивах, не точкова.

## Зафіксовані рішення (НЕ переглядати без запиту користувача)

| Питання           | Рішення                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORM               | **Prisma 7** (Drizzle розглянуто й відхилено)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Черги             | **pg-boss v12** поверх Postgres (BullMQ відхилено; Kafka/NATS/RabbitMQ свідомо поза скоупом). Фаза 2.1 — `JobDispatcher`; **EDA-1 (2026-08-04) замінила його на `messaging/`**: подія/команда, конверт, маніфест підписок, спільна DLQ. Транзакційна постановка через `fromPrisma` лишається — `publish(tx, …)` у тій самій БД, що й дані, і це вже повноцінний transactional outbox (окрема `domain_events` + relay НЕ потрібні). Власний publisher, а не рідний `boss.publish` — той ковтає часткову відмову fan-out-у. Event sourcing, saga-двигун, schema registry — поза скоупом (`docs/event-driven-architecture.md` §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Мультитенантність | **MT-0…MT-3 реалізовано й перевірено 2026-07-16/17** (деталі — `docs/multi-tenancy-architecture.md`; лишилась тільки MT-4/беклог). Shared schema + `tenant_id` + **Postgres RLS як ОСНОВНИЙ enforcement** (перегляд рішення «RLS не вмикаємо»). Принцип: MT **невидима для бізнес-коду** — extension робить лише `set_config` (НЕ `where: { tenantId }`), колонку заповнює DB-default; поява `tenantId` у доменному сервісі = запах. `users.tenant_id NOT NULL` (User в одному tenant-і; **Membership/Invitations скасовано**). Два plane-и, ОБИДВА з UI: `apps/api`+`apps/web` (tenant) і `apps/platform-api`+`apps/platform-web` (control plane, окремі identity/JWT/DB-роль). Single-tenant = **N=1** тієї самої схеми, не форк                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Auth              | Власна реалізація fibo-admin as-is (better-auth/Keycloak/Clerk розглянуті й відхилені)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Zod               | v4 (закрито у фазі 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Монорепо          | pnpm + Turborepo (Nx відхилено)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| UI-бібліотека     | **shadcn/ui (Base UI, стиль base-nova) — єдиний стек платформи, обидва фронти.** Міграція завершена й прийнята 2026-08-24; попередня бібліотека видалена з репо повністю (ні імпортів, ні залежностей, ні MCP-сервера, ні скіла, ні токенів у розмітці). Причина переходу — не смаки, а два костилі, які її бета-версія змушувала тримати в гріді (інертний чекбокс під прозорим нативним input + `createPortal` хедер-чекбокса в `thead`); обидва зняті. **`libs/ui` — спільний шар обох фронтів**: витягнутий ПЕРЕД міграцією web, бо 13 файлів у двох застосунках були побайтово однакові — так пакет перевірявся проти вже прийнятого platform-web. Іконки — `lucide-react` (перегляд правила «без пакетів іконок»). ReUI не використовуємо, але реєстр `@reui` прописаний у `components.json`. Історія, чинні рішення і граблі — `docs/frontend/ui-migration-history.md`; правила стека — `docs/frontend/ui-stack.md`                                                                                                                                                                                                                                                                                           |
| Форми (web)       | **RHF + zodResolver + обгортки** в `apps/web/src/components/form/` (FormTextField/FormSelect через useController; applyServerError: 409 → setError поля, решта → errors.root.server). TanStack Form розглянуто — свідомий кандидат на майбутню міграцію, поки форм мало                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Create user (API) | Пароль **обов'язковий** — адмін задає початковий (argon2-хеш у UsersService, у Prisma йде тільки passwordHash). Зміна пароля — НЕ через users PATCH (окремий security-флоу)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Файли             | **S3 API як абстракція** (dev: SeaweedFS, Apache 2.0; Garage відхилено — AGPL, RustFS — alpha, MinIO — репо заархівовано). **Presigned двофазний upload** (proxy через API відхилено). Віддача — тільки короткоживучі presigned GET після authz. ClamAV — беклог                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Деплой            | **Docker Swarm single-node + GitLab CI** (docker-context по SSH, без файлів на сервері). Kubernetes/Helm НЕ розглядаємо. Зараз тестовий прод: http на IP:port, секрети в репо; шлях до справжнього проду — `docs/roadmap.md` §2.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Realtime          | **Socket.IO 4 + Valkey** (Redis Streams adapter), transports **websocket-only** (sticky sessions не потрібні — Docker VIP балансує по TCP-зʼєднанню). Presence — ефемерні leases у Valkey, не таблиця. **Реалізовано й перевірено 2026-08-15**; in-app сповіщення поверх того самого транспорту — 2026-08-16 (`docs/notifications.md`), realtime підписником у `MESSAGE_TOPOLOGY` НЕ став: емісія after-commit у процесі, що записав рядок. **Last seen (RT-3, 2026-08-29)** — `users.last_seen_at` у Postgres поруч із ефемерною presence: питання «коли був востаннє» переживає рестарт брокера, тому колонка, а не Valkey. `lastSeenAt` СВІДОМО додано в `UserResponse` (на відміну від `isOnline`): це довговічний факт про юзера, який змінюється рідко, а не проєкція, що застаріває за секунди. Сортування/фільтр за ним — поза скоупом (потребує поля в `UserQuerySchema` та індексу). Postgres-адаптер (`LISTEN/NOTIFY`) переглянуто повторно 2026-08-15 і **відхилено знову**: він не вирішує presence (TTL-сховище потрібне все одно, тому економія нульова), а черга NOTIFY — глобальний ресурс кластера, здатний заблокувати коміти всій БД. Обґрунтування — `docs/realtime.md` § «Зафіксовані рішення» |
| Кольорова тема    | **Дефолт — тема `gray`, зібрана з ДВОХ джерел** (2026-09-08, рішення користувача): світло — zinc-нейтралі HeroUI, темрява — власні токени темного Notion, причому з ДВОХ їхніх продуктів: поверхні й текст із `app.notion.com`, а шкала ІКОНОК і МЕЖІ — з `calendar.notion.so`, де вони напівпрозорі (білий з альфою) і вдвічі тьмяніші. Асиметрія свідома: тема це контракт РОЛЕЙ, а не одна палітра на два режими — їх ніхто не бачить одночасно, тож кожен бере найкращі для себе значення (наслідок: похідні токени одного режиму не виводимо з іншого, обидва блоки повні). Світла палітра Notion була дефолтом кілька годин того ж дня і відкинута — окремої теми `notion` у реєстрі немає, `themes/gray.css` видалений (переїхав у `:root`/`.dark`). Дві осі лишаються роздільними — режим (`.dark`, next-themes) і палітра (`data-theme`, наш провайдер); альтернатива одна — `slate` (попередній дефолт), вибір живе в `localStorage`. Беремо КОЛЬОРИ, ТІНІ й РАДІУС — метрики (36px) і компоненти не чіпаємо: інакше тема стає окремим дизайном. `--popover` ≠ `--card` у темряві (попап світліший — так Notion передає висоту). `--event-*` спільні для всіх тем, `--calendar-*` — частина теми. Компроміс `success`/`warning`: один токен на роль обслуговує і заливку, і текст, тому контраст `warning` у світлі нижчий за WCAG AA — лікується парами `*-soft-*` + правкою `badge.tsx`. `docs/frontend/theming.md` §3.1 |
| Навігація (`web`) | **Два рівні: смуга іконок area + колонка активної area** (модель VS Code / Slack / JetBrains, реєстровий предок `sidebar-09`). Імена: `AppShell` / `AppRail` / **area** / `AreaSidebar` — «Activity Bar» відпадає (`Activity` = журнал подій), `Section` зайняте `components/section/`, `Panel` — `ActivityPanel`, `Workspace` — назвою однієї з area. **Друга колонка — контейнер вигляду, а не підменю**: area віддає компонент, тому чат малює там список розмов; хто є меню — беруть спільний `AreaNav`. **Префікс URL на кожну area**, активна area = чиста функція від pathname, дубльованого стану немає; «останній роут в area» і окремий стан згортання на area свідомо НЕ робимо. Бренд і профіль — у рейлі (належать сесії, не area), назва продукту — в підказці плитки. У `platform-web` лишається один рівень: одна area, рейл був би декорацією. Реалізовано 2026-09-06, `docs/frontend/app-shell.md` |
| Налаштування      | **Дві різні сутності, а не один розділ**: організаційне (`/settings` + API `/settings/*`) лишається КОМПАНІЇ, особисте (`/user-settings` + API `/account/*`) йде за ЛЮДИНОЮ; тест межі — «якщо юзер піде, налаштування піде з ним?». **Словом «Settings» володіє організація** — домінантний B2B-патерн (GitLab, Stripe, Notion, HubSpot); особисте — «User settings», а не «Preferences» (пароль і сесії не преференції). «Workspace» відкинуто (зайняте фронтом), «Organization» — теж (зайняте `CustomerKind`). **Id у шляху немає в обох** — суб'єкт із токена. Дієслова диктує форма ресурсу: документ → `GET/PUT`, колекція → REST, операція → `POST` на дієслівний під-ресурс. Запис — ADMIN через `@Roles`+`RolesGuard` (зародок, який ЗАМІНИТЬ повний RBAC). Реалізовано й перевірено 2026-09-01, `docs/settings.md`                                                                                                                                                                                                                                                                                                                                                                                        |
| Кастомери         | **`Customer` + `kind` (ORGANIZATION\|PERSON) + вкладені `CustomerContact`** — не `Account` (ім'я зайняте self-service модулем `apps/api/src/account/`) і не party-модель (SAP BP / Odoo `res.partner`: правильна кінцева форма для ERP, але заводиться разом із ДРУГИМ типом контрагента, не наперед). Стадій продажу в `status` немає — воронка це стан УГОДИ, не контрагента. Людський номер — ЦІЛЕ число, своє в кожного тенанта, видається таблицею-лічильником (НЕ `SEQUENCE`: та поза RLS, спільна на БД і дає дірки через невідкатний `nextval`; і не `MAX+1`: після видалення номер перевикористався б). Префікс/нулі — конфіг тенанта, не частина ідентичності; для документів лейбл заморожуватиметься в колонку. Початковий номер задається, зсув живого лічильника — тільки вгору. Soft delete НЕ робимо — архів це `status`, а цілісність боронить `Restrict` з документів. Кастомних полів на тенанта немає: скелетон форкають, форк додає КОЛОНКИ. Реалізовано й перевірено 2026-09-01, `docs/customers.md`                                                                                                                                                                                           |
| Календар          | **`CalendarEvent` + учасники з RSVP + персональні нагадування** (`docs/calendar.md`, CAL-1 2026-09-07). Ім'я з кваліфікатором — слово `Event` зайняте messaging/socket/журналом. Інтервал ПІВ-ВІДКРИТИЙ `[starts_at, ends_at)` (RFC 5545), UTC-інстант + окрема IANA-зона (не offset — він властивість моменту), all-day рендериться в зоні ПОДІЇ. Читання ВІКНОМ, не сторінками; елемент — ВХОДЖЕННЯ з першого дня (інакше повторення зламають контракт). Доступ — за УЧАСТЮ, не за роллю: ADMIN не бачить чужих приватних подій (асиметрія в часі — видати доступ потім легко, забрати ні). Скасування ≠ видалення. Нагадування — «декларація → матеріалізація → cron-сканер із атомарним claim» у СПІЛЬНІЙ `scheduled_notifications`; НЕ `pg-boss startAfter` (`pgboss.*` поза RLS, ретеншн, скасування як друге джерело правди). Повторення (RRULE) — окрема фаза CAL-4, бо її помилки не лікуються міграцією. Календарні сітки — власні, зовнішні бібліотеки приносять другий движок і другу тему |
| i18n              | **Бекенд — коди, текст рендерить споживач** (API не читає Accept-Language; ApiError.message — en-діагностика, юзеру не показується). i18next: react-i18next на фронтах + той самий i18next у worker (email). JSON у репо: спільне — `libs/i18n`, фічеве — `apps/*/locales`; TMS відкладено до другої мови. Стартово тільки `en`. Деталі і фази — `docs/i18n-plan.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Беклог фази 2 (пріоритети — див. docs/roadmap.md)

- ✅ pg-boss + `apps/worker` — зроблено (2.1). ✅ notifications (welcome-email через Mailpit,
  локалізовано) — зроблено (I18N-3). ✅ EDA-0/EDA-1 (єдиний конвеєр повідомлень) — зроблено
  2026-08-04; **EDA-2** (вкладка DLQ + replay у `/jobs`, фільтр за correlationId, лаг/глибина
  черг) — наступний: без нього конвеєр працює наосліп. Деталі — `docs/event-driven-architecture.md`.
- **Безпека auth**: (а) reuse-detection ротованих refresh-токенів — зараз повторне використання
  ротованого токена дає 401, але НЕ відкликає інші сесії (рядок видалено; треба `revokedAt`
  замість delete) — той самий рефакторинг дає «рівень 1» налаштувань (список пристроїв,
  вибірковий revoke), див. `docs/account-settings.md` §2; (б) refresh у httpOnly cookie
  замість localStorage. ✅ logout на бекенді і «вийти звідусіль» — зроблено 2026-08-29.
- **Мультитенантність (фази MT-0…MT-4)**: деталі — `docs/multi-tenancy-architecture.md`.
  ✅ MT-0 (ролі БД), ✅ MT-1 (фундамент без RLS),
  ✅ MT-2 (RLS увімкнено), ✅ MT-3 (`apps/platform-api` + `apps/platform-web`) — зроблені
  й перевірені 2026-07-16/17 (див. шапку). Лишилась тільки MT-4/беклог (піддомени, invite-флоу,
  білінг, рівень 3 довідників).
  Еталонний домен для обкатки — ✅ customers, написаний БЕЗ згадок tenantId (2026-09-01). Відкриті питання
  закриті 2026-07-15…17: `/jobs` переїхав у platform-api на MT-3 (гейт дотримано — ДО CRUD
  тенантів, бо `pgboss.*` поза RLS); сутність tenant-а = **`Tenant`/`tenants`** (перейменовано
  з Organization — «організація» лишається вільним доменним словом); **register видалено
  зовсім** (MT-1); refresh-токен → `tenantId:tokenId:secret`; login перевіряє `tenant.isActive`;
  slug — у MT-1, логін по slug (ручне поле, MT-3) працює end-to-end у tenant-web; invite
  першого admin-а — відкладено на MT-4 (тимчасово пароль задає оператор, платформа задає
  через `apps/platform-web`).
- RBAC: permissions-рядки (`tickets:write`) + `@RequirePermissions()` guard (після MT-2, поверх
  готового tenant-контексту).
- Доменні модулі: ✅ customers (еталонний CRUD) — зроблено 2026-09-01 (`docs/customers.md`,
  беклог сутності — §12 там же); ✅ calendar CAL-1 (події користувача + нагадування) —
  зроблено 2026-09-07 (`docs/calendar.md`; CAL-2 частково — realtime-дельти,
  перетягування/resize з undo, створення протягуванням, гарячі клавіші, попередження про
  накладання, peek по наведенню, контекстне меню з Duplicate, присутність учасників —
  скоуп фази закритий; далі CAL-3 і CAL-4); далі tickets (workflow + події) → billing
  (PaymentProvider інтерфейс + fake-провайдер → Stripe). Пишуться вже на шарі `messaging`:
  billing — це EDA-3, еталон події з 5 підписниками (`invoice.paid.v1`, `ledger_entries`,
  claim-before-send для листів, relay-підписник). Окремого `audit-log` НЕ робимо —
  його роль виконує Activity Log; in-app notifications — `docs/notifications.md`.
- ✅ Realtime (Valkey + gateway + presence) — зроблено 2026-08-15; ✅ in-app сповіщення
  (EDA-4) — зроблено 2026-08-16; ✅ **заплановані сповіщення** (`scheduled_notifications` +
  cron-сканер) — зроблено 2026-09-07 разом із календарем, який і був їхнім першим
  споживачем. Лишився **email як другий канал** (схема преференсів несе `channel`,
  відкладений тригер уже є — бракує доставки і claim-before-send), далі System Settings,
  див. `docs/roadmap.md`.
