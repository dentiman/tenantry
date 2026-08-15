# Realtime-підсистема: Socket.IO, presence і notifications

> Статус: **RT-0, RT-1 і RT-2 реалізовані й перевірені 2026-08-15** (зведення — § «Що
> реалізовано»); RT-3 (in-app notifications) — попереду. Дизайн: 2026-07-22,
> **переглянуто 2026-08-02** під відомий деплой (Docker Swarm + GitLab CI, див.
> [deploy-swarm.md](deploy-swarm.md)) — зведення змін у § «Що змінив відомий деплой».
>
> Перший вертикальний сценарій — online presence користувачів tenant CRM — працює
> end-to-end. Наступний сценарій — in-app notifications. Наявний welcome-лист (підписник
> `welcome-email` події `users.user-registered.v1`) не є in-app Notification-модулем:
> таблиці повідомлень, REST API, unread state і UI поки немає.

## Що реалізовано (2026-08-15)

Дизайн нижче лишився чинним — реалізація не переглянула жодного зафіксованого рішення.
Тут — де що лежить і чим фактичний код відрізняється від тексту.

| Шар             | Файли                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Контракти       | `libs/contracts/src/realtime/` — Zod-схеми подій і snapshot-у + typed event maps (`ServerToClientEvents`/`ClientToServerEvents`)                                                                                                                |
| Gateway         | `apps/api/src/realtime/`: `realtime.gateway.ts` (namespace `/tenant`, rooms, цикл auth), `socket-auth.service.ts`, `realtime-io.adapter.ts` (websocket-only + Redis Streams), `realtime.emitter.ts`, `realtime.config.ts` (валідація env на старті) |
| Presence        | `apps/api/src/realtime/presence/`: `presence.lua.ts` (5 атомарних скриптів), `presence.store.ts`, `presence.service.ts` (локальна мапа + heartbeat + sweeper + drain), `presence.controller.ts` (`GET /api/presence`)                            |
| Спільна auth    | `apps/api/src/auth/access-token.service.ts` — ОДНА перевірка access-токена для HTTP-guard і socket-middleware                                                                                                                                   |
| Фронт           | `apps/web/src/realtime/`: `socket.ts` (singleton поза React-деревом), `presence-sync.ts` (delta → TanStack Query з revision-логікою), `use-presence.ts`; `components/presence-dot.tsx`; бейдж у колонці avatar на `/users`                       |
| Інфраструктура  | сервіс `valkey` у `docker/docker-compose.yml` і `docker/docker-compose.stack.yml`, `x-realtime-env`, `location /socket.io/` у nginx-шаблоні, `ws: true` у Vite-проксі, сервіс `valkey` у GitHub Actions                                          |
| Тести           | `apps/api/test/realtime.e2e-spec.ts` — 11 тестів (handshake, дві вкладки, ревізії, крос-tenant ізоляція snapshot-у і delta, детермінований lease expiry)                                                                                        |

**Живий прогін** (2026-08-15, два процеси `api` на :3001 і :3011 проти однієї Valkey):
cross-instance emit, дві вкладки, закриття останньої вкладки, snapshot-ізоляція — 10/10;
у браузері бейдж на `/users` перемкнувся online→offline від дельти з _іншого_ інстанса
без перезавантаження сторінки.

### Уточнення, які дала реалізація

- **Бюджет offline-детекції — 65 с, а не 45–60 с.** При дефолтах `LEASE_TTL=60000` і
  `SWEEP=5000` найгірший випадок = `leaseTtl + sweepInterval`. Дефолти лишені як
  зафіксовані в цьому документі; щоб вкластись у ціль, потрібні `REALTIME_LEASE_TTL_MS=40000`
  + `REALTIME_HEARTBEAT_MS=15000` (конфіг це дозволяє й перевіряє інваріант
  `heartbeat * 2 ≤ leaseTtl` на старті).
- **Розрив ≠ розрив.** Lease віддається МИТТЄВО лише на `client namespace disconnect`
  (навмисне закриття). `transport close` / `ping timeout` невідрізнювані від зниклої
  мережі, тому там lease догорає по TTL — і швидкий reconnect не дає флікера. Щоб
  закриття вкладки читалось як навмисне, фронт явно робить `socket.disconnect()` на
  `pagehide`.
- **`GET /presence` при недоступному брокері віддає 503, а не порожній список.** Порожній
  список фронт відрендерив би як «всі offline» — застосунок стверджував би те, чого не
  знає. `PresenceDot` при `isUnknown` не рендериться взагалі; тост придушено через
  `meta.silentError` у TanStack Query.
- **Sweeper обходить усі тенанти з індексу** `{prefix}:presence:tenants` (SET поза
  hash-тегом), а не лише локальні: якщо впала нода з єдиним юзером тенанта, локально
  про цей тенант не знає ніхто.

### Граблі, спіймані живим прогоном

1. **Приватний метод не можна називати `handleDisconnect`.** Nest шукає хук на інстансі
   за іменем (`if (instance.handleDisconnect)`) — `private` у TS на це не впливає, —
   підписує його САМ і викликає з одним аргументом. На кожен розрив приходили два
   виклики: спершу Nest-івський із `reason === undefined`, потім наш зі справжньою
   причиною. Перший знімав сокет із локального обліку, другий уже не знаходив його —
   **lease не звільнявся ніколи**, і юзер лишався online після закриття вкладки.
   Симптом виглядав як «баг presence», причина була в іменуванні.
2. **`blockTimeInMs` адаптера = час виходу процесу.** Дефолтні 5 с блокуючого XREAD
   додаються до кожного `SIGTERM` (а в тестах давали «Jest did not exit»). Знижено до
   1 с: у простої це один зайвий round-trip на секунду, зате drain при `stop-first`
   на 4 секунди коротший.
3. **Порт 6379 на dev-машині часто вже зайнятий** іншим проєктом. `docker-compose.yml`
   приймає `REDIS_PORT`; тоді `REDIS_URL` у `.env` має вказувати на той самий порт.

## Рішення коротко

| Питання                     | Рішення                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Транспорт браузер ↔ backend | **Socket.IO 4.x** у `apps/api`, namespace `/tenant`                                          |
| Multi-node fan-out          | **`@socket.io/redis-streams-adapter`** через Redis-compatible broker                         |
| Self-hosted broker          | **Valkey 8** у Compose; managed Redis/Valkey — без зміни коду                                |
| Presence                    | Ефемерні distributed leases у Valkey, не Prisma-таблиця                                      |
| Snapshot presence           | `GET /api/presence`; socket надсилає лише delta-події                                        |
| UI cache                    | TanStack Query; socket patch/invalidate, не окреме джерело server state у Zustand            |
| Tenant isolation            | `tenantId` тільки з перевіреного tenant JWT; room-и й ключі ізольовані по tenant             |
| Notifications               | PostgreSQL — source of truth; socket event — best-effort wake-up hint                        |
| Розміщення gateway          | Спочатку в кожній репліці `apps/api`; межа модуля дозволяє винести в `apps/realtime` пізніше |
| **Транспорт Socket.IO**     | **`transports: ['websocket']`** — без polling fallback, тому sticky sessions не потрібні (2026-08-02) |
| Load balancer               | nginx у контейнері `web` (`/api` + `/socket.io` → `api:3001` по overlay). Affinity не потрібна, поки транспорт — тільки WebSocket |
| TLS                         | Тестовий прод — `ws://` по http на IP:port. `wss` стає обовʼязковим разом із TLS-проксі (розділ 2.7 roadmap) |
| Деплой Valkey               | Сервіс swarm-стеку `valkey` (порт НЕ публікується, лише overlay), у dev — сервіс `docker-compose.yml` |
| Control plane               | Не підключаємо. Якщо знадобиться — окремий gateway/auth/key prefix у `platform-api`          |

Redis/Valkey тут не замінює pg-boss. pg-boss лишається механізмом довговічних фонових
робіт із retry та транзакційним dispatch. Valkey обслуговує короткоживучий fan-out,
connection recovery і presence leases.

## Що змінив відомий деплой (2026-08-02)

Документ писався до деплою — «reverse proxy з TLS і cookie-affinity» був гіпотезою. Реальна
цільова інфраструктура ([deploy-swarm.md](deploy-swarm.md)): **Docker Swarm, одна manager-нода**,
усі сервіси `replicas: 1`, `api` **взагалі не публікує порт** — браузер ходить на nginx у
контейнері `web` (`mode: host`, `0.0.0.0:8511`), а той проксить `/api` на `api:3001` по overlay.
Зовнішнього reverse-proxy і TLS немає: тестовий прод — http на IP:port.

| Було в дизайні                              | Стало                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| polling fallback + cookie-based sticky      | **`transports: ['websocket']`.** Docker VIP балансує **по TCP-зʼєднанню**, cookie-affinity у цій схемі просто немає де взяти; websocket-only знімає вимогу повністю |
| «Proxy має…» (гіпотетичний edge)            | Конкретний файл: `docker/nginx/default.conf.template` — окремий `location /socket.io/` (див. нижче)                                          |
| production socket лише `wss`                | У тестовому проді — `ws://` (усе по http, mixed-content не виникає). `wss` — обовʼязково разом із TLS-проксі, не раніше                      |
| «додається Valkey у compose»                | Два конкретні місця: `docker/docker-compose.yml` (dev) і `docker/docker-compose.stack.yml` (swarm), env — у `docker/deploy.env`               |
| RT-0: «підняти дві репліки на різних портах» | `docker service scale saas-dev_api=2` на живому dev-стеку — api без published-порту, конфлікту немає                                          |

**Чому adapter потрібен уже при `replicas: 1`** (інакше спокуса «поки одна нода — обійдемось мапою в памʼяті»):

1. `x-update-stateless` для `api` — `order: start-first`: під час кожного деплою **два таски `api`
   співіснують** десятки секунд. Без adapter-а половина клієнтів опиниться в іншому процесі й
   presence розʼїдеться саме тоді, коли всі перепідключаються.
2. `worker` — **окремий контейнер без HTTP**. Notification, створена джобою, не має способу
   потрапити в socket без брокера (стрім `realtime.dispatch`, § «Майбутній Notification-модуль»).
3. `docker service scale api=N` має лишатись операційним рішенням, а не міграцією архітектури.

**Що додати в інфраструктуру (обсяг RT-0):**

- сервіс `valkey` у dev-compose і в стеку: `valkey/valkey:8-alpine`, порт **не публікується**,
  `--maxmemory` + `--maxmemory-policy noeviction`, `--requirepass`, персистентність не потрібна
  (presence ефемерна, adapter-стрім bounded); у стеку — `x-update-stateful` (`stop-first`),
  бо інстанс один;
- `x-realtime-env` anchor: `REDIS_URL`, `REALTIME_KEY_PREFIX`, `REALTIME_ALLOWED_ORIGINS`,
  `REALTIME_LEASE_TTL_MS`, `REALTIME_HEARTBEAT_MS`, `REALTIME_RECOVERY_MS` → у сервіси `api` і
  (для `realtime.dispatch`) `worker`;
- `REDIS_PASSWORD` і `REALTIME_ALLOWED_ORIGINS` у `docker/deploy.env` — origin збігається з уже
  наявним `S3_CORS_ALLOWED_ORIGINS` (`http://<node-ip>:8511`);
- `location /socket.io/` у `docker/nginx/default.conf.template` — той самий `resolver`/`set
  $backend` патерн, що й `/api/`, плюс:

  ```nginx
  location /socket.io/ {
      set $backend "${API_UPSTREAM}";
      proxy_pass $backend;
      proxy_http_version 1.1;
      proxy_set_header Upgrade    $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host       $host;
      proxy_buffering off;
      proxy_read_timeout 300s;   # > pingInterval + pingTimeout
      proxy_send_timeout 300s;
  }
  ```

- `apps/web/vite.config.ts` — правило `/socket.io` з `ws: true` для dev;
- health/readiness: `api` уже має healthcheck на `/api/health`; graceful shutdown має **встигнути
  звільнити leases** до того, як swarm уб'є старий таск (`stop_grace_period`, дефолт 10 с —
  перевірити на RT-1).

**Що НЕ змінилось:** вибір Socket.IO + Redis Streams adapter, модель presence-leases,
snapshot+delta з revision, ізоляція тенантів, auth-цикл `auth.expiring.v1` / `auth.update.v1`,
межа з pg-boss.

## Чому Socket.IO

### Розглянуті варіанти

| Варіант                            | Переваги                                                                                              | Чому не обираємо                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native WebSocket (`ws`)            | Мінімальний протокол і overhead                                                                       | Доведеться самим будувати reconnect, rooms, acknowledgements, fallback і multi-node fan-out                                                                        |
| SSE                                | Простий server → browser stream                                                                       | Односпрямований; `EventSource` незручний із access token у пам'яті; гірша база для майбутніх інтерактивних сценаріїв                                               |
| PostgreSQL `LISTEN/NOTIFY` adapter | Немає нового сервісу                                                                                  | Немає connection state recovery; великі/binary payload-и йдуть через додаткову таблицю; presence все одно потребує TTL store; realtime churn навантажує основну БД |
| Classic/sharded Redis adapter      | Зрілий multi-node broadcast                                                                           | Немає connection state recovery; при розриві з Redis міжнодові пакети губляться                                                                                    |
| **Redis Streams adapter**          | Multi-node rooms, bounded stream, connection recovery, відновлення після тимчасового розриву з broker | Додає один Redis-compatible сервіс у стек (sticky sessions відпали разом із polling — див. «Що змінив відомий деплой»)                                             |

Socket.IO за замовчуванням гарантує порядок подій, але delivery — **at most once**.
Connection state recovery зменшує кількість пропусків при коротких розривах, але не
скасовує потреби у snapshot/resync. Тому жоден критичний бізнес-стан не живе тільки в
socket event.

Valkey обраний як self-hosted Redis-compatible broker: він використовує RESP, сумісний
із Redis OSS API і підтримується Redis Streams adapter-ом Socket.IO. Це зберігає
fork-friendly open-source інфраструктуру. Назви env і клієнтський npm-пакет можуть
залишатися `REDIS_URL` / `redis`, бо це назва протоколу та екосистемного API, а не
жорстка прив'язка до конкретного server image.

### Чому НЕ Postgres-адаптер (перегляд рішення, 2026-08-15)

Спокуса очевидна: `@socket.io/postgres-adapter` прибрав би цілий сервіс зі стеку, а це
скелетон для форків — кожна runtime-залежність множиться на кожен форк. Плюси реальні:
`NOTIFY` доставляється **на COMMIT**, тобто лягає рівно на нашу доктрину `publish(tx, …)`
(для RT-3 це нульове вікно між `INSERT notification` і emit), а міст `worker → socket`
став би тривіальним — воркер робив би `NOTIFY` у своїй транзакції, без окремого стріму
`realtime.dispatch`.

Рішення все одно на користь Valkey, і вирішує **не fan-out, а presence**:

1. **Адаптер не вирішує presence взагалі.** Він покриває лише розсилку. Leases усе одно
   потребують TTL-сховища: довелося б завести `presence_leases` (щонайменше UNLOGGED),
   heartbeat-UPDATE кожні 20 с на кожного онлайн-юзера, власний sweeper і атомарність
   через advisory lock замість Lua — тобто НАШ код замість готового примітиву плюс
   постійний dead-tuple churn на primary. Заміна адаптера в Socket.IO — це один рядок
   (`io.adapter(...)`), а от presence прибита до сховища; якщо воно все одно потрібне,
   економія від Postgres-адаптера дорівнює нулю.
2. **Черга NOTIFY — глобальний ресурс кластера.** Залиплий LISTEN-консюмер роздуває її, і
   `NOTIFY` починає валитись/блокуватись у **всіх** транзакціях БД; коміти з `NOTIFY`
   до того ж серіалізуються на спільному локу черги. Це прямо суперечить вимозі з
   § «Failure modes»: відмова realtime не має чіпати REST/auth.
3. **Немає connection state recovery** — офіційно не підтримується. Для нас це не
   фундамент (snapshot+revision resync є в будь-якому разі), але кількість resync-ів
   зросла б на кожному короткому розриві.
4. **Немає bounded stream і видимості лагу**: ні `maxLen`, ні offset — метрики «глибина
   черги / лаг доставки» з § «Спостережуваність» узяти нізвідки.
5. **DDL у нашій БД під роллю без DDL-прав.** Адаптер створює `socket_io_attachments`
   (payload > 8000 байт). Це повторення граблі pg-boss із MT-0 (`GRANT CREATE ON DATABASE`
   для `saas_app`) — ще один виняток у рольовій моделі.

**Коли Postgres-адаптер виграв би:** форк, якому потрібні лише notifications і НЕ потрібна
presence. Там немає TTL-сховища, payload-и крихітні, транзакційність `NOTIFY` — чистий
виграш, і другий сервіс справді зайвий.

## Топологія

Поточна цільова топологія — swarm-стек `saas-dev`/`saas-prod` на одній ноді. Балансувальник —
nginx усередині контейнера `web`; зовнішнього edge поки немає (додасться разом із TLS).

```text
                     swarm node (mode: host 0.0.0.0:8511)
Browser A ──┐   ┌──────────────────────┐        ┌──────────────────────┐
            ├──▶│ web (nginx)          │        │ valkey               │
Browser B ──┘   │  /  → SPA            │        │  Socket.IO stream    │
   http/ws      │  /api      → api     │        │  presence leases     │
                │  /socket.io → api    │        │  recovery sessions   │
                └───────┬──────────────┘        └──────┬───────────────┘
                        │ overlay saas_net              │
             ┌──────────┴──────────┐                    │
             │ Docker DNS VIP      │                    │
             └────┬───────────┬────┘                    │
                  │           │                         │
           ┌──────▼───┐  ┌────▼─────┐                   │
           │ api #1   │  │ api #2   │◀──────────────────┘
           │ REST +   │  │ (scale / │   Redis Streams adapter
           │ gateway  │  │ deploy)  │
           └──────┬───┘  └────┬─────┘        ┌──────────┐
                  └─────┬─────┘              │ worker   │─▶ realtime.dispatch
                        ▼                    └────┬─────┘   (стрім у valkey)
                  PostgreSQL 17 ◀─────────────────┘
                  durable domain state,
                  future notifications, RLS
```

`api #2` існує постійно під час rolling update (`order: start-first`) і за потреби —
через `docker service scale`. TLS-проксі перед `web` зʼявиться на етапі 2.7 roadmap;
тоді ж `ws://` стане `wss://`.

Gateway запускається разом із кожною tenant API реплікою на тому самому HTTP server і
public origin. Окремий `apps/realtime` зараз не потрібен: він змусив би дублювати auth,
tenant context, deployment і observability до появи окремої потреби масштабувати socket
connections незалежно від REST. `RealtimeModule` не повинен залежати від доменних
модулів, тому винесення лишається механічним.

## Протокол і rooms

- Engine path: `/socket.io`.
- Tenant namespace: `/tenant`. Не створюємо namespace на кожного tenant-а.
- Tenant room: `tenant:{tenantId}`.
- Особистий room: `tenant:{tenantId}:user:{userId}`.
- У room names немає email, імені чи інших PII.
- Platform JWT ніколи не приймається tenant gateway-єм. Окремий
  `PLATFORM_JWT_SECRET` лишається жорсткою межею control plane.

Початкові контракти:

| Напрямок        | Event                         | Payload / призначення                                                   |
| --------------- | ----------------------------- | ----------------------------------------------------------------------- |
| server → client | `presence.changed.v1`         | `{ userId, status, revision, occurredAt }`                              |
| server → client | `auth.expiring.v1`            | Просить оновити access token до завершення `exp`                        |
| client → server | `auth.update.v1`              | Новий access token + acknowledgement                                    |
| server → client | `notification.created.v1`     | `{ notificationId, occurredAt }`; клієнт інвалідує notification queries |
| server → client | `realtime.resync-required.v1` | Connection recovery не вдалася або знайдено gap revision                |

Схеми payload-ів і типи event maps живуть у `libs/contracts/src/realtime/` як Zod 4
схеми. Усі client → server payload-и проходять runtime validation. Socket помилки мають
окремий нормалізований envelope з закритим code; HTTP `AllExceptionsFilter` WebSocket
події автоматично не охоплює.

Не додаємо `isOnline` до `UserResponse` або Prisma `User`: це швидко застарілий
ефемерний projection, а не властивість користувача.

## Автентифікація і tenant context

1. `apps/web` передає поточний access token через Socket.IO `auth` callback. Callback
   читає Zustand store безпосередньо, тому reconnect завжди бере найновіший token.
2. Socket middleware перевіряє підпис, `exp` і tenant JWT schema. `tenantId`, `sub`,
   `role` беруться тільки з verified payload і кладуться у typed `socket.data`.
3. Під час handshake перевіряються `user.isActive` і `tenant.isActive`, як у login/refresh.
4. Socket входить лише у власні tenant/user rooms. Клієнт не надсилає room або tenantId.
5. Для будь-якої DB-операції та кожного application event виконується
   `TenantContextService.runWith(jwt.tenantId, fn)`. HTTP
   `TenantResolutionMiddleware` і поточний `JwtAuthGuard` не можна механічно застосувати
   до gateway: HTTP middleware не створює CLS-контекст для socket handler-а.
6. Доменний код, як і зараз, не отримує `tenantId` аргументом. Prisma працює через
   `saas_app`, `set_config` і RLS.

Access JWT живе 15 хвилин, а socket може бути відкритий значно довше. Gateway ставить
таймер до `exp` і перед завершенням надсилає `auth.expiring.v1`. Web використовує наявний
single-flight `refreshTokens()`, передає новий token через `auth.update.v1`, server
перевіряє, що `sub` і `tenantId` не змінилися, та переносить expiry timer. При невдачі
socket закривається з auth code; frontend очищає сесію лише якщо звичайний refresh теж
не вдався. Singleton client також підписаний на зміну `accessToken` у Zustand: якщо
REST-interceptor оновив token раніше за `auth.expiring.v1`, socket одразу виконує той
самий in-place auth update без disconnect і без помилкового presence flicker.

`skipMiddlewares` для connection recovery має бути `false`: інакше заблокований user
може відновити socket без повторної перевірки.

## Presence v1

### Бізнесова семантика

Користувач `online`, якщо існує хоча б одне живе socket-з'єднання цього user-а у цьому
tenant-і.

- Дві вкладки або два браузери — один online user.
- Закриття однієї з двох вкладок не робить user-а offline.
- Закриття останньої вкладки при нормальному disconnect дає offline майже одразу.
- При втраті мережі, sleep ноутбука або `kill -9` API-ноди disconnect неможливо знати
  миттєво. Offline настає після heartbeat/lease timeout; ціль v1 — не пізніше 45–60 с.
- Background tab залишається online: вимога — CRM відкрита, а не обов'язково видима.
  Якщо пізніше потрібні `active/away`, це окремий стан на базі Page Visibility та user
  activity, а не зміна значення `online`.
- Presence не є audit/attendance/working-time системою. Історія входів у v1 не зберігається.

### Distributed leases

У кожній API-ноді є локальний map `tenantId + userId → Set<socketId>`. У Valkey
зберігається не кожна вкладка, а lease пари `user + apiNode`, що зменшує heartbeat writes:

```text
rt:presence:{tenantId}:leases:{userId}  ZSET apiNodeId -> expiresAtMs
rt:presence:{tenantId}:online           SET userId
rt:presence:{tenantId}:deadlines        ZSET userId -> latestLeaseExpiryMs
rt:presence:{tenantId}:revision         STRING integer
```

Фігурні дужки — Redis Cluster hash tag: ключі tenant-а потрапляють в один slot, тому Lua
операції над ними атомарні.

- Перша локальна вкладка виконує `acquireLease`.
- Наступні локальні вкладки змінюють тільки in-memory set.
- Останній локальний disconnect виконує `releaseLease`.
- Нода раз на 15–20 с batch/pipeline-ом продовжує leases активних локальних users.
- Кожна нода може запускати idempotent sweeper expired deadlines; окремий leader не
  потрібен.
- Lua script атомарно очищає прострочені leases, змінює `online`, збільшує tenant
  `revision` тільки на глобальному переході `0 → 1` або `1 → 0` і повертає delta для emit.
- На graceful shutdown нода звільняє свої leases. При crash вони догоряють по TTL.

`apiNodeId` — випадковий boot UUID, а не hostname: два процеси на одному host не повинні
перезаписувати lease одне одного.

### Snapshot + delta

`GET /api/presence` повертає:

```json
{
  "onlineUserIds": ["..."],
  "revision": 42,
  "generatedAt": "2026-07-22T12:00:00.000Z"
}
```

Endpoint бере tenant з CLS, читає тільки ключі цього tenant-а й повертає ID без user PII.
Frontend тримає snapshot у TanStack Query. `presence.changed.v1` патчить цей cache:

- `revision <= current` — duplicate/old event, ігноруємо;
- `revision === current + 1` — застосовуємо delta;
- `revision > current + 1` — є gap, інвалідуємо `GET /presence` і робимо resync;
- reconnect без успішного Socket.IO recovery — завжди інвалідуємо snapshot.

На `/users` online badge обчислюється як `onlineUserIds.has(user.id)`. REST users query і
presence query лишаються незалежними; пагінація users не впливає на presence.

## Майбутній Notification-модуль

In-app notification — довговічна бізнес-сутність, тому її не можна реалізувати лише як
socket payload. Орієнтовна tenant-таблиця:

```text
Notification
  id, tenantId, recipientUserId
  type                    # закритий machine-readable code
  payload                 # структуровані параметри, не локалізований текст
  readAt, createdAt
```

Таблиця потребує стандартних composite FK/indexes і RLS `USING` + `WITH CHECK`. Текст
рендерить frontend через i18next, як activities; worker email має власну локалізацію.

Флоу:

```text
domain transaction
  ├─ business change
  ├─ INSERT notification              PostgreSQL = source of truth
  └─ transactional dispatch/outbox
             │
             ▼
      realtime publisher
             │
             ▼
tenant:{tenantId}:user:{userId} ── notification.created.v1
             │
             ▼
frontend invalidates notification list + unread count
```

Якщо notification створює worker, realtime publish виконується після успішного
inbox-protected DB effect. Для producer-а поза `apps/api` додається власний короткий
Redis Stream `realtime.dispatch`: одна API-репліка забирає event, робить Socket.IO emit,
а adapter розносить його на всі ноди. Event має `eventId`; повторна доставка безпечна,
бо клієнт лише інвалідує query, а notification ID стабільний.

Втрата socket event не втрачає notification: reconnect, відкриття bell menu або звичайна
query refetch завжди читає PostgreSQL. Не треба використовувати pg-boss як live transport:
його polling/retry семантика потрібна для робіт, а не для субсекундного fan-out.

## Інфраструктура

### Development / self-hosted

Valkey додається у два місця: `docker/docker-compose.yml` (dev — порт на localhost, як
postgres/mailpit) і `docker/docker-compose.stack.yml` (swarm — **порт не публікується взагалі**,
доступ лише по overlay `saas_net`). Presence ефемерний, але bounded Socket.IO stream і короткі
recovery sessions займають пам'ять, тому потрібні memory limit, `maxLen` і алерти. Для цього
workload бажана `noeviction`: тиха eviction presence ключів гірша за явну degraded помилку.
Персистентність (RDB/AOF) не потрібна — після рестарту стан відбудовується heartbeat-ами.

Env (dev — `.env`; swarm — `docker/deploy.env` → інтерполяція в стек, як `S3_*`):

```dotenv
# dev
REDIS_URL=redis://:password@localhost:6379
# swarm: REDIS_URL=redis://:${REDIS_PASSWORD}@valkey:6379
REALTIME_KEY_PREFIX=saas:rt
# тестовий прод — http-origin ноди, той самий, що S3_CORS_ALLOWED_ORIGINS
REALTIME_ALLOWED_ORIGINS=http://172.18.13.101:8511
REALTIME_LEASE_TTL_MS=60000
REALTIME_HEARTBEAT_MS=20000
REALTIME_RECOVERY_MS=120000
```

`REDIS_URL` потрібен і `api` (adapter + leases), і `worker` (публікація в `realtime.dispatch`
для notifications з RT-3); до RT-3 воркеру він не потрібен.

Redis/Valkey є trusted internal infrastructure: private network, ACL з окремим user,
пароль, TLS між hosts, без public port. Event payload-и не містять токенів або секретів;
adapter traffic сам по собі не підписаний.

Socket gateway приймає лише точний allowlist `REALTIME_ALLOWED_ORIGINS`. Одного CORS
недостатньо: browser CORS захищає HTTP long-polling, але не WebSocket transport, тому той
самий allowlist перевіряється через Socket.IO `allowRequest`. JWT auth залишається
обов'язковим незалежно від Origin. Поточний широкий `app.enableCors()` також потрібно
звузити окремою security-зміною до production rollout.

Для HA — managed Redis/Valkey або primary + replica з автоматичним failover. Одна
self-hosted Valkey-нода прийнятна для початкового deployment: її падіння деградує
presence/realtime, але не REST, auth, PostgreSQL чи pg-boss. Після відновлення heartbeats
перебудують presence, а clients зроблять snapshot resync.

### Reverse proxy / load balancer

**Рішення 2026-08-02: `transports: ['websocket']`** — polling fallback вимкнено, тому
session affinity не потрібна взагалі. Причина не смакова: у swarm-стеку балансує Docker VIP
за overlay-адресою `api`, і він розподіляє **TCP-зʼєднання**, не HTTP-сесії; cookie-affinity
там нема кому виставляти. З polling кожен HTTP-poll міг би приземлятися в інший таск `api`,
а Redis adapter Engine.IO-сесію не переносить. Ціна — клієнти за корпоративними проксі, які
ріжуть WebSocket, лишаться без realtime (REST працює як завжди).

Nginx у контейнері `web` (`docker/nginx/default.conf.template`) — єдиний проксі на шляху:
`location /socket.io/` з `Upgrade`/`Connection: upgrade`, `proxy_buffering off`,
`proxy_read_timeout` більший за `pingInterval + pingTimeout`, і той самий динамічний
`resolver 127.0.0.11` + `set $backend`, що вже використовує `/api/` (інакше IP бекенда
залипне після redeploy). Конкретний блок — у § «Що змінив відомий деплой».

Vite dev proxy отримує окреме правило `/socket.io` з `ws: true`.

Коли перед стеком зʼявиться TLS-проксі (розділ 2.7 roadmap): термінувати TLS, socket стає
`wss://`, ті самі Upgrade-заголовки й idle timeout — на edge. Повертати polling+sticky
доведеться тільки якщо реально знадобиться fallback: тоді edge має виставляти affinity cookie
(`Secure`, `HttpOnly`, `SameSite=Lax`), а `api` — перейти на `endpoint_mode: dnsrr`, бо через
VIP sticky неможлива.

## Failure modes

| Подія                        | Очікувана поведінка                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Закрита остання вкладка      | Normal disconnect → immediate lease release → offline delta                                               |
| Втрачена мережа              | Socket.IO reconnect; offline лише після lease timeout, щоб не миготіти на короткому розриві               |
| Crash API-ноди               | Її leases expire; інші ноди sweeper-ом публікують offline, якщо інших leases немає                        |
| Rolling deploy (`start-first`) | Новий таск `api` стартує ДО зупинки старого — обидва в adapter-і, presence не розʼїжджається; старий на SIGTERM звільняє leases і закриває sockets, клієнти реконектяться в новий (з jitter). `stop_grace_period` має покривати drain |
| Тимчасово недоступний Valkey | REST лишається доступним; UI показує presence `unknown/stale`, не «всі offline»                           |
| Пропущена presence delta     | Revision gap → `GET /presence` resync                                                                     |
| Пропущена notification delta | REST refetch повертає durable notification з PostgreSQL                                                   |
| Redis/Valkey restart         | Presence відбудовується heartbeat-ами; всі clients інвалідують snapshot                                   |
| User/tenant деактивовано     | Новий handshake відхилено; окремий admin event у майбутньому примусово закриває активні user/tenant rooms |

## Спостережуваність

Логи не містять access token, room PII або повний payload notification. Потрібні метрики:

- current socket connections по API instance;
- connect/disconnect/reconnect/recovered totals;
- handshake auth failures за закритим reason code;
- presence lease refresh latency/errors і expired lease count;
- realtime emits, dispatch lag, revision-gap/resync count;
- Redis connection state, command latency, stream length і memory;
- graceful drain duration.

Tenant/user ID не додаються як metric labels через високу cardinality. Для діагностики
вони можуть бути structured log fields із чинною політикою доступу до логів.

## План реалізації

### RT-0 — інфраструктурний spike ✅ (2026-08-15)

1. Valkey у `docker/docker-compose.yml` (dev) і `docker/docker-compose.stack.yml` (swarm:
   без published-порту, `noeviction`, `requirepass`, `stop-first`); `REDIS_PASSWORD` +
   `REALTIME_*` у `docker/deploy.env`; env-валідація при старті і health/metrics.
2. Socket.IO server (`transports: ['websocket']`) + клієнт + Redis Streams adapter.
3. `location /socket.io/` у nginx-шаблоні та правило `ws: true` у Vite dev-proxy.
4. Перевірка на **живому dev-стеку**: `docker service scale saas-dev_api=2` → два клієнти
   приземляються в різні таски (VIP), room emit доходить в обидва; далі — рестарт Valkey,
   connection recovery, і `docker service update --force saas-dev_api` (rolling `start-first`).

Spike є гейтом: не починати presence UI, доки два таски `api` не обмінюються event-ами.

### RT-1 — secure gateway ✅ (2026-08-15)

1. `libs/contracts/src/realtime`: Zod payload-и та typed event maps.
2. `apps/api/src/realtime`: adapter lifecycle, gateway, socket auth/error filter,
   tenant/user rooms, graceful shutdown.
3. Винести перевірку access JWT у спільний auth service для HTTP guard і socket
   middleware, не дублювати правила.
4. `apps/web/src/realtime`: singleton client поза React tree, auth refresh/update,
   reconnect/resync integration. React StrictMode не повинен створювати два sockets.

### RT-2 — presence vertical slice ✅ (2026-08-15)

1. Lease store + Lua scripts + sweeper.
2. Zod contract і `GET /api/presence` за стандартним DTO → Service → Mapper → Controller.
3. `presence.changed.v1`, revision/gap logic і TanStack Query integration.
4. Online badge на `/users`; UI text через i18next.
5. OpenAPI/orval artifacts, tests і документація.

### RT-3 — in-app notifications — попереду

Окреме бізнесове рішення: модель/міграція/RLS, REST list/unread/read API, permissions,
retention, event type/payload schemas, bell UI, transactional creation, worker bridge та
`notification.created.v1`. Realtime foundation не повинна наперед вигадувати ці доменні
правила.

## Перевірки й acceptance criteria

Мінімальний integration suite запускає два процеси `api` та одну Valkey instance (локально —
два порти; на dev-стеку — `docker service scale saas-dev_api=2`):

1. User A на API #1 бачить User B, підключеного до API #2, online.
2. Tenant A ніколи не отримує snapshot/delta tenant B.
3. Invalid, expired і platform token не відкривають socket.
4. Дві вкладки одного user-а: закриття першої не дає offline; закриття останньої дає.
5. `kill -9` API #1 дає offline після lease TTL, якщо user не перепідключився.
6. Reconnect/recovery або revision gap сходиться до правильного REST snapshot.
7. Redis outage не робить tenant REST API unavailable і не показує «всі offline».
8. Access-token refresh не створює помилковий offline/online flicker.
9. E2E автоматично перевіряє cross-tenant isolation і RLS для майбутніх notification rows.
10. Load test визначає фактичний connections-per-node і Redis memory budget; числовий
    production limit не фіксуємо без вимірювання на цільовій інфраструктурі.
11. Rolling deploy (`docker service update --force`) не лишає «привидів» online після drain
    і не дає presence-flicker клієнтам, які перепідключилися в новий таск.

Після контрактів/контролера: `pnpm openapi:generate` + `pnpm web:codegen`. Після
cross-package змін: `pnpm lint`, `pnpm typecheck`, `pnpm build`; presence/auth/multi-node
поведінка потребує tenant e2e та окремого realtime integration suite.

## Первинні джерела

- [Socket.IO: Redis Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/)
- [Socket.IO: using multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/)
- [Socket.IO: connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)
- [Socket.IO: delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Socket.IO: middlewares and auth payload](https://socket.io/docs/v4/middlewares/)
- [Socket.IO: CORS and `allowRequest`](https://socket.io/docs/v4/handling-cors/)
- [Socket.IO: PostgreSQL adapter](https://socket.io/docs/v4/postgres-adapter/)
- [NestJS: WebSocket adapters](https://docs.nestjs.com/websockets/adapter)
- [Valkey: Redis compatibility and migration](https://valkey.io/topics/migration/)
