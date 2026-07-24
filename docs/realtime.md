# Realtime-підсистема: Socket.IO, presence і notifications

> Статус: архітектурне рішення, ще не реалізовано. Дата: 2026-07-22.
>
> Перший вертикальний сценарій — online presence користувачів tenant CRM. Наступний
> сценарій — in-app notifications. Наявні email jobs у `libs/shared/src/jobs/definitions/notifications.jobs.ts`
> не є in-app Notification-модулем: таблиці повідомлень, REST API, unread state і UI поки немає.

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
| Load balancer               | WebSocket upgrade + cookie-based sticky sessions, бо лишаємо polling fallback                |
| Control plane               | Не підключаємо. Якщо знадобиться — окремий gateway/auth/key prefix у `platform-api`          |

Redis/Valkey тут не замінює pg-boss. pg-boss лишається механізмом довговічних фонових
робіт із retry та транзакційним dispatch. Valkey обслуговує короткоживучий fan-out,
connection recovery і presence leases.

## Чому Socket.IO

### Розглянуті варіанти

| Варіант                            | Переваги                                                                                              | Чому не обираємо                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native WebSocket (`ws`)            | Мінімальний протокол і overhead                                                                       | Доведеться самим будувати reconnect, rooms, acknowledgements, fallback і multi-node fan-out                                                                        |
| SSE                                | Простий server → browser stream                                                                       | Односпрямований; `EventSource` незручний із access token у пам'яті; гірша база для майбутніх інтерактивних сценаріїв                                               |
| PostgreSQL `LISTEN/NOTIFY` adapter | Немає нового сервісу                                                                                  | Немає connection state recovery; великі/binary payload-и йдуть через додаткову таблицю; presence все одно потребує TTL store; realtime churn навантажує основну БД |
| Classic/sharded Redis adapter      | Зрілий multi-node broadcast                                                                           | Немає connection state recovery; при розриві з Redis міжнодові пакети губляться                                                                                    |
| **Redis Streams adapter**          | Multi-node rooms, bounded stream, connection recovery, відновлення після тимчасового розриву з broker | Додає один Redis-compatible сервіс і все одно потребує sticky sessions для polling                                                                                 |

Socket.IO за замовчуванням гарантує порядок подій, але delivery — **at most once**.
Connection state recovery зменшує кількість пропусків при коротких розривах, але не
скасовує потреби у snapshot/resync. Тому жоден критичний бізнес-стан не живе тільки в
socket event.

Valkey обраний як self-hosted Redis-compatible broker: він використовує RESP, сумісний
із Redis OSS API і підтримується Redis Streams adapter-ом Socket.IO. Це зберігає
fork-friendly open-source інфраструктуру. Назви env і клієнтський npm-пакет можуть
залишатися `REDIS_URL` / `redis`, бо це назва протоколу та екосистемного API, а не
жорстка прив'язка до конкретного server image.

## Топологія

```text
                                   ┌──────────────────────┐
Browser A ──┐                      │ Valkey / managed     │
            ├─ TLS reverse proxy ──┤ Redis-compatible     │
Browser B ──┘       │              │                      │
                    │              │ Socket.IO stream     │
             sticky │              │ presence leases      │
             cookie │              │ recovery sessions    │
          ┌─────────┴─────────┐    └──────┬───────────────┘
          │ load balancer     │           │
          └──────┬──────┬─────┘           │
                 │      │                 │
          ┌──────▼───┐ ┌▼─────────┐       │
          │ API #1   │ │ API #2   │◀──────┘
          │ REST +   │ │ REST +   │  Redis Streams adapter
          │ gateway  │ │ gateway  │
          └──────┬───┘ └───┬──────┘
                 └────┬────┘
                      ▼
                PostgreSQL 17
                durable domain state,
                future notifications, RLS
```

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

До dev compose додається Valkey, доступний apps лише по внутрішній/localhost мережі. У
self-hosted production він не публікується назовні. Presence ефемерний, але bounded
Socket.IO stream і короткі recovery sessions займають пам'ять, тому потрібні memory
limit, `maxLen` і алерти. Для цього workload бажана `noeviction`: тиха eviction presence
ключів гірша за явну degraded помилку.

Орієнтовні env:

```dotenv
REDIS_URL=redis://:password@localhost:6379
REALTIME_KEY_PREFIX=saas:rt
REALTIME_ALLOWED_ORIGINS=https://crm.example.com
REALTIME_LEASE_TTL_MS=60000
REALTIME_HEARTBEAT_MS=20000
REALTIME_RECOVERY_MS=120000
```

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

Обраний режим лишає Socket.IO polling fallback, тому multi-node deployment **вимагає
cookie-based session affinity**. Redis adapter не зберігає Engine.IO session конкретної
API-ноди. Альтернатива — `transports: ['websocket']`, тоді sticky sessions не потрібні,
але CRM втратить fallback для корпоративних proxy; це не default.

Proxy має:

- передавати `Upgrade` / `Connection` headers для `/socket.io`;
- не кешувати endpoint;
- мати idle timeout більший за `pingInterval + pingTimeout`;
- проксувати `/api` і `/socket.io` на той самий tenant API pool;
- термінувати TLS; production socket працює лише через `wss`;
- виставляти affinity cookie як `Secure`, `HttpOnly`, `SameSite=Lax` для same-origin CRM.

Vite dev proxy також отримує окреме правило `/socket.io` з `ws: true`.

## Failure modes

| Подія                        | Очікувана поведінка                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Закрита остання вкладка      | Normal disconnect → immediate lease release → offline delta                                               |
| Втрачена мережа              | Socket.IO reconnect; offline лише після lease timeout, щоб не миготіти на короткому розриві               |
| Crash API-ноди               | Її leases expire; інші ноди sweeper-ом публікують offline, якщо інших leases немає                        |
| Rolling deploy               | Readiness off, drain, release leases; clients reconnect до живих реплік                                   |
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

### RT-0 — інфраструктурний spike

1. Додати Valkey у dev/prod Compose, env validation і health/metrics.
2. Додати Socket.IO server/client та Redis Streams adapter.
3. Підняти дві tenant API репліки на різних портах і перевірити cross-node room emit,
   sticky routing, Redis restart і connection recovery.

Spike є гейтом: не починати presence UI, доки дві ноди не обмінюються event-ами.

### RT-1 — secure gateway

1. `libs/contracts/src/realtime`: Zod payload-и та typed event maps.
2. `apps/api/src/realtime`: adapter lifecycle, gateway, socket auth/error filter,
   tenant/user rooms, graceful shutdown.
3. Винести перевірку access JWT у спільний auth service для HTTP guard і socket
   middleware, не дублювати правила.
4. `apps/web/src/realtime`: singleton client поза React tree, auth refresh/update,
   reconnect/resync integration. React StrictMode не повинен створювати два sockets.

### RT-2 — presence vertical slice

1. Lease store + Lua scripts + sweeper.
2. Zod contract і `GET /api/presence` за стандартним DTO → Service → Mapper → Controller.
3. `presence.changed.v1`, revision/gap logic і TanStack Query integration.
4. Online badge на `/users`; UI text через i18next.
5. OpenAPI/orval artifacts, tests і документація.

### RT-3 — in-app notifications

Окреме бізнесове рішення: модель/міграція/RLS, REST list/unread/read API, permissions,
retention, event type/payload schemas, bell UI, transactional creation, worker bridge та
`notification.created.v1`. Realtime foundation не повинна наперед вигадувати ці доменні
правила.

## Перевірки й acceptance criteria

Мінімальний integration suite запускає дві API репліки та одну Valkey instance:

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
