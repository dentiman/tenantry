# Realtime: технічний довідник

> Оглядовий документ — [realtime.md](realtime.md) (що це дає, стек, зафіксовані рішення,
> що лишилось зробити). Тут — механіка: протокол, ключі, конфіг, режими відмов, тести.

## Карта коду

| Що                                | Де                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Контракти подій і snapshot-у      | `libs/contracts/src/realtime/` — Zod-схеми + typed event maps (`ServerToClientEvents` / `ClientToServerEvents`) |
| Гейтвей                           | `apps/api/src/realtime/realtime.gateway.ts` — namespace, rooms, цикл auth, обробка розривів                     |
| Автентифікація сокета             | `apps/api/src/realtime/socket-auth.service.ts`                                                                  |
| Перевірка токена (спільна з HTTP) | `apps/api/src/auth/access-token.service.ts`                                                                     |
| WebSocket-адаптер Nest            | `apps/api/src/realtime/realtime-io.adapter.ts` — транспорт, CORS/`allowRequest`, Redis Streams                  |
| Емісія в room-и                   | `apps/api/src/realtime/realtime.emitter.ts`                                                                     |
| Конфіг + валідація env            | `apps/api/src/realtime/realtime.config.ts`                                                                      |
| Клієнт Valkey                     | `apps/api/src/redis/redis.module.ts` (`REDIS_CLIENT`; спільний із throttler-ом з AUTH-0)                         |
| Presence: Lua                     | `apps/api/src/realtime/presence/presence.lua.ts`                                                                |
| Presence: сховище                 | `apps/api/src/realtime/presence/presence.store.ts`                                                              |
| Presence: логіка ноди             | `apps/api/src/realtime/presence/presence.service.ts`                                                            |
| Presence: REST                    | `apps/api/src/realtime/presence/presence.controller.ts`                                                         |
| Last seen: запис у БД             | `apps/api/src/realtime/presence/last-seen.writer.ts`                                                            |
| Фронт: socket                     | `apps/web/src/realtime/socket.ts`                                                                               |
| Фронт: delta → кеш                | `apps/web/src/realtime/presence-sync.ts`, `apps/web/src/realtime/last-seen.store.ts`                            |
| Фронт: читання                    | `apps/web/src/realtime/use-presence.ts`, `apps/web/src/components/{presence-dot,last-seen}.tsx`                 |
| Тести                             | `apps/api/test/realtime.e2e-spec.ts`                                                                            |

## Протокол

- Engine path — `/socket.io`, namespace — `/tenant`. Namespace **один**, не по тенанту:
  namespace — це серверний ресурс, а тенантів можуть бути тисячі.
- Room тенанта — `tenant:{tenantId}`; особистий room — `tenant:{tenantId}:user:{userId}`.
- Префікс тенанта в назві room обовʼязковий: адаптер розносить broadcast **за іменем
  room**, не звіряючись із контекстом, тож `user:{userId}` без префікса склеїв би
  однойменні room-и різних тенантів.
- У назвах room немає email, імені чи будь-яких PII: room-и видно в трафіку адаптера і в
  дампах брокера.

| Напрямок        | Подія                         | Призначення                                      |
| --------------- | ----------------------------- | ------------------------------------------------ |
| server → client | `presence.changed.v1`         | `{ userId, status, revision, occurredAt }`       |
| server → client | `auth.expiring.v1`            | Просить оновити access-токен до завершення `exp` |
| client → server | `auth.update.v1`              | Новий токен + acknowledgement із результатом     |
| server → client | `realtime.resync-required.v1` | Стан міг розʼїхатись — перечитай snapshot        |
| server → client | `notification.created.v1` · `notification.changed.v1` | Інбокс: новий рядок / зміна стану (в особистий room) |
| server → client | `calendar.event-changed.v1`   | `{ eventId, change, startsAt, endsAt, occurredAt }` — в особисті room-и УЧАСНИКІВ події |

Версія в імені (`.v1`) — та сама доктрина, що в `defineEvent`: зміна форми payload-у це
**нове імʼя**, а не тихо інша структура під старим.

`calendar.event-changed.v1` — єдина подія, яка йде НЕ в tenant-room і не в room одного
юзера, а в особисті room-и **переліку** людей (учасників події): broadcast розсилав би
всьому тенанту сам факт існування чужої зустрічі разом із її часом. Вона ж єдина, яка
свідомо НЕ везе стан — тільки межі, щоб клієнт вирішив, чи чіпає зміна відкрите вікно
(docs/calendar.md §9.3).

Усі client → server payload-и валідуються Zod-ом рантайму. HTTP-фільтр
`AllExceptionsFilter` socket-події **не охоплює** (він ловить exception-и HTTP-контексту),
тому socket має власний envelope помилки з закритим `code` (`UNAUTHENTICATED`,
`ACCOUNT_INACTIVE`, `IDENTITY_CHANGED`, `INVALID_PAYLOAD`, …) — той самий принцип, що в
`ApiError`: машинний код назовні, англійський текст у лог.

## Автентифікація сокета

1. Клієнт передає токен у Socket.IO `auth` (не в query string: query потрапляє в логи
   проксі й у referrer). Це **функція**, а не обʼєкт — вона виконується на кожен реконект
   і завжди бере найсвіжіший токен зі стору.
2. Middleware namespace-у перевіряє токен через `AccessTokenService` — той самий, що
   `JwtAuthGuard`. Причина відмови не деталізується: «протух» і «підроблений» дають
   однаковий код.
3. `tenantId`, `sub`, `role` беруться **тільки** з verified payload і кладуться в
   `socket.data`.
4. `isActive` юзера і тенанта перевіряються запитом у БД усередині явного
   `TenantContextService.runWith(tenantId, …)`. HTTP-ланцюг `TenantResolutionMiddleware`
   → `JwtAuthGuard` тут не працює: handshake — не express-запит, і CLS для нього ніхто не
   піднімає. RLS при цьому сама відсіче токен, підписаний для іншого тенанта — рядка
   просто не буде.
5. Сервер сам заводить сокет у room-и з перевіреного payload-у.

**Цикл продовження сесії.** На конекті ставляться два таймери: за 60 секунд до `exp` —
`auth.expiring.v1`, на самому `exp` — примусове закриття. Клієнт на попередження викликає
`refreshTokens()` — **той самий single-flight**, що й axios-інтерсептор (два незалежні
refresh-флоу ротували б refresh-токен один в одного і вибили б сесію). Оновлений токен
потрапляє в стор, підписка на стор шле `auth.update.v1`, сервер звіряє `sub`/`tenantId`/`role`
і переносить таймери. Новий токен з іншою identity відхиляється з `IDENTITY_CHANGED` —
сокет уже сидить у room-ах старої, а права могли змінитись, тому це робиться повним
handshake, а не підміною на льоту.

**Connection state recovery** увімкнено з `skipMiddlewares: false`. Це обовʼязково: інакше
заблокований юзер відновив би сесію без повторної перевірки `isActive`, і recovery стала б
обходом автентифікації.

## Presence: дані у Valkey

```text
{prefix}:presence:{tenantId}:leases:{userId}   ZSET  nodeId  → expiresAtMs
{prefix}:presence:{tenantId}:online            SET   userId
{prefix}:presence:{tenantId}:deadlines         ZSET  userId  → максимальний expiry
{prefix}:presence:{tenantId}:revision          STRING лічильник переходів
{prefix}:presence:tenants                      SET   tenantId  (індекс для sweeper-а)
```

Фігурні дужки навколо `tenantId` — hash tag Redis Cluster: усі ключі тенанта потрапляють в
один slot, тому Lua-скрипти над ними лишаються атомарними і в кластері. Індекс тенантів
свідомо **поза** hash-тегом: sweeper мусить знайти тенанта, у якого на цій ноді немає
нікого (нода з його юзерами впала).

`nodeId` — випадковий **boot UUID, а не hostname**. Два процеси `api` на одному хості
(dev-watch або `start-first` під час rolling update) не повинні перезаписувати lease один
одного: інакше drain старого таска зняв би юзера, який уже сидить на новому.

Атомарність усіх переходів забезпечують пʼять Lua-скриптів (`presence.lua.ts`):
`acquire`, `release`, `renew` (batch), `sweep`, `snapshot`. Lua тут не заради швидкості:
перехід `online`↔`offline` і інкремент ревізії мусять статись однією операцією, інакше дві
ноди, що одночасно відпускають останні leases одного юзера, згенерують дві дельти з тією
самою ревізією — і клієнти розсинхронізуються.

## Presence: життєвий цикл

- **Рахунок вкладок — у памʼяті ноди** (`tenantId → userId → Set<socketId>`). Мережа
  зачіпається лише на переходах: перша локальна вкладка робить `acquire`, остання —
  `release`. Юзер із пʼятьма вкладками на двох нодах дає **два** записи у Valkey, а не пʼять.
- **Heartbeat** — раз на `REALTIME_HEARTBEAT_MS` одним викликом на тенант, а не на юзера:
  тенант на 500 онлайн-юзерів інакше давав би 500 round-trip-ів кожні 20 секунд. Heartbeat
  ще й самолікується: якщо sweeper зняв юзера через лаг, наступне продовження поверне його
  і згенерує коректну дельту.
- **Sweeper** крутиться на **кожній** ноді без вибору лідера. Ідемпотентність дає сам
  Redis: `SREM` повертає 1 рівно один раз, скільки б нод не мели одночасно. Обхід іде по
  всіх тенантах з індексу, а не лише по локальних. Тенант, у якому не лишилось нікого,
  прибирається з індексу — інакше він ріс би вічно.
- **Graceful shutdown**: нода віддає свої leases сама, не чекаючи TTL. Без цього кожен
  rolling deploy лишав би «привидів» online на хвилину — рівно тоді, коли всі клієнти
  перепідключаються і дивляться на список. Для цього в `main.ts` увімкнено
  `app.enableShutdownHooks()`, а в swarm-стеку `api` має `stop_grace_period: 30s`.

**Розрив ≠ розрив.** Lease звільняється миттєво **тільки** на навмисному закритті
(`client namespace disconnect`). `transport close`, `ping timeout` і `transport error`
невідрізнювані від зниклої мережі — там локальний облік знімається, а lease догорає по
TTL, тому швидкий реконект не дає жодної дельти замість пари offline/online. Щоб закриття
вкладки читалось як навмисне, фронт явно робить `socket.disconnect()` на `pagehide`.

**Бюджет offline-детекції** = `leaseTtl + sweepInterval`. На дефолтах (60 000 + 5 000) це
**65 секунд** у найгіршому випадку — коли нода померла одразу після продовження lease.
Щоб вкластись у ~50 с, потрібні `REALTIME_LEASE_TTL_MS=40000` і `REALTIME_HEARTBEAT_MS=15000`.
Конфіг перевіряє інваріант `heartbeat * 2 ≤ leaseTtl` на старті: lease мусить пережити
один пропущений heartbeat, інакше здорова нода блимала б юзерами в offline. Другий
інваріант — `lastSeenFlush ≤ lastSeenMark`: зливати рідше, ніж зʼявляються позначки,
означає лише відкласти ті самі записи.

## Last seen: довговічний слід присутності (RT-3)

Presence відповідає на «хто зараз тут» і живе у Valkey — ефемерно, без персистентності.
`users.last_seen_at` відповідає на «коли він був тут востаннє» і мусить пережити рестарт
брокера, тому лежить у Postgres. Це два різні питання, і сховища в них теж різні.

**Семантика — high-water mark**, а не «момент дисконекту»: найпізніший момент, коли
система ТОЧНО знала про живе зʼєднання. Визначення продиктоване режимами відмов — у трьох
із чотирьох шляхів розриву моменту дисконекту не існує взагалі:

| Шлях розриву                                    | Що виконується          | Момент дисконекту |
| ----------------------------------------------- | ----------------------- | ----------------- |
| `client namespace disconnect` (вкладка, logout)  | `onDisconnect`          | є, точний         |
| `transport close` / `ping timeout`               | `forgetSocket`          | немає             |
| `kill -9` ноди                                   | нічого                  | немає             |
| Розрив при недоступній Valkey                    | `releaseLease` мовчки падає | немає         |

Тому позначки надходять із шести точок, і жодна з них не є єдиною:

| Точка                              | Час позначки        | Навіщо саме вона                                                                 |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| **connect** (перша локальна вкладка) | `now`             | Якір: якщо ноду вбʼють через три години при недоступній Valkey, це єдине записане |
| **graceful disconnect** останньої вкладки | `now`        | Найточніше значення — саме його бачить юзер                                       |
| **`forgetSocket`** (мережа зникла)  | `now`               | Найчастіший реальний сценарій (закритий ноутбук); «щойно» тут — правда            |
| **періодичний mark**               | `now`               | Єдине джерело, що НЕ залежить від брокера: читає лише локальну мапу               |
| **sweep** протермінованої lease     | `now − leaseTtl`    | Ловить `kill -9` чужої ноди; юзера немає вже щонайменше TTL, тому не `now`        |
| **drain** на `SIGTERM`             | `now`               | Він і справді був онлайн у цю секунду — рятує від «last seen 4 hours ago» після деплою |

Друга вкладка позначки не ставить (присутність не змінюється — допише періодичний mark),
відхилений handshake — теж (зʼєднання не було).

**Запис — write-behind.** `LastSeenWriter.mark()` синхронний, не кидає і кладе позначку в
буфер `tenantId → userId → max(ms)`; таймер `REALTIME_LAST_SEEN_FLUSH_MS` зливає буфер
одним batched `UPDATE` на тенант. Прямий запис на місці означав би сотні окремих UPDATE-ів
у мить rolling deploy-у — саме тоді, коли база й так під навантаженням. Невдалий злив
повертає позначки в буфер: монотонність робить повтор безпечним.

**Чому сирий SQL** (другий легальний випадок у проєкті після колапсу сповіщень):

1. будь-який `prisma.user.update*` підняв би `@updatedAt`, і кожні пʼять хвилин присутності
   виглядали б як редагування профілю — «Last updated» на картці юзера показував би час, що
   не стосується жодної зміни даних;
2. умову «пиши, лише якщо новіше» треба виконати В ОДНОМУ стейтменті: read-modify-write із
   двох нод дав би відкат значення назад.

```sql
UPDATE users AS u
   SET last_seen_at = to_timestamp(t.seen_ms / 1000.0) AT TIME ZONE 'UTC'
  FROM unnest($1::text[], $2::double precision[]) AS t(id, seen_ms)
 WHERE u.id = t.id
   AND (u.last_seen_at IS NULL OR u.last_seen_at < to_timestamp(t.seen_ms / 1000.0) AT TIME ZONE 'UTC')
```

`WHERE last_seen_at < …` — не дублювання умови, а економія: без нього кожен цикл переписував
би рядок тим самим значенням (dead tuple + WAL на порожньому місці). Час іде
epoch-мілісекундами і перетворюється в БД: node-postgres серіалізує `Date` з **локальним**
зсувом, а колонка — `timestamp` без зони, у якій Prisma зберігає UTC.

**Точність за сценаріями:**

| Сценарій                                | Похибка `lastSeenAt`                     |
| --------------------------------------- | ---------------------------------------- |
| Закрив вкладку / вийшов                 | ≤ `flushMs` (15 с)                       |
| Зникла мережа, ноутбук заснув           | ≤ `flushMs`                              |
| `kill -9` ноди, Valkey жива             | ≤ `leaseTtl + sweepMs + flushMs` (~80 с) |
| `kill -9` ноди **і** Valkey недоступна  | ≤ `markMs + flushMs` (~5 хв)             |

**Застаріле значення в кеші фронта.** Рядок юзера фетчиться один раз, далі присутність живе
дельтами — у мить `offline` поле в кеші застаріле рівно на час від фетчу, і UI написав би
«last seen 12 minutes ago» саме тоді, коли правильно «now». Тому offline-дельта везе
`lastSeenAt` (опційне поле `presence.changed.v1`), а `last-seen.store.ts` тримає накладку
`userId → ISO`; `usePresence().lastSeenAt()` віддає **пізніше** з двох значень — інакше
рефетч списку відкотив би щойно отриманий час.

Імʼя події лишилось `.v1`, хоча доктрина вимагає версію на зміну форми payload-у: її мета —
щоб споживач не прочитав дані інакше, ніж їх записали, а **додавання опційного поля** старий
клієнт може лише проігнорувати.

**Межа фічі:** рахуються тільки socket-зʼєднання. Логін по REST без сокета `last_seen_at`
не рухає — інакше підпис розійшовся б із крапкою присутності, яка теж socket-based. Друге
джерело позначок (наприклад, HTTP-інтерсептор) додається в той самий `mark()`, ламати нічого
не доведеться.

**Що показує UI** (`components/last-seen.tsx`, тільки tenant-web): `Online` → `Last seen
5 minutes ago` (тултіп із абсолютною датою) → `Never signed in` для `null`. При
`isUnknown` (Valkey недоступна) час НЕ ховається — він приїхав із Postgres і лишається
правдою; зникає лише слово «Online». Це краща деградація, ніж у крапки: замість порожнечі
юзер бачить «Last seen 3 minutes ago». Підпис старішає сам — компонент перемальовується
раз на 30 секунд, інакше «5 minutes ago» висіло б до наступного рефетчу.

## Snapshot + delta

`GET /api/presence` бере тенант з CLS і повертає лише ідентифікатори — жодного email чи
імені, бо presence читають усі юзери тенанта, а не тільки ті, хто має право бачити профілі:

```json
{ "onlineUserIds": ["..."], "revision": 42, "generatedAt": "2026-08-15T12:00:00.000Z" }
```

Snapshot і ревізія читаються **одним** скриптом: якби це були дві команди, клієнт міг би
застосувати дельту, вже враховану в snapshot-і.

`revision` рахує **переходи** в межах тенанта (0→1 і 1→0), а не конекти: друга вкладка
присутності не змінює, отже й ревізію не рухає. Фронт тримає snapshot у кеші TanStack
Query, а socket його патчить за трьома випадками:

| Умова                      | Дія                          | Чому                                                                            |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `revision <= current`      | ігнорувати                   | дубль або переставлена подія — застосування зіпсувало б стан                    |
| `revision === current + 1` | застосувати дельту           | рівно наступна зміна                                                            |
| `revision > current + 1`   | інвалідувати `GET /presence` | між snapshot-ом і цією подією загубились інші, і невідомо, кого саме пропустили |

Плюс два безумовні resync: реконект без успішного recovery (`socket.recovered === false`) і
серверна подія `realtime.resync-required.v1`.

**Відмова брокера** → `GET /presence` віддає **503**, а не порожній список: порожній список
фронт відрендерив би як «всі offline», тобто застосунок збрехав би. `PresenceDot` при
такому стані не рендериться взагалі, а глобальний тост придушено через `meta.silentError`
у налаштуваннях запиту — недоступна presence це стан UI, а не подія для юзера.

**Індикатор малюється тільки для «online»** (2026-08-24): «offline» — стан за замовчуванням
у списку, і крапка на кожному другому рядку перетворювала б сигнал на шум. Разом із
`isUnknown` це дає просте правило: **бачиш крапку — юзер онлайн; не бачиш — або офлайн, або
невідомо**, і жодного з цих двох станів застосунок не стверджує окремо.

## Конфігурація

Валідується на старті процесу: помилка в env має впасти одразу, а не проявитись розʼїханою
presence за пів години. Дефолти збігаються з dev-compose, тому `pnpm docker:up` +
`pnpm api:dev` працюють без жодного рядка в `.env`.

| Змінна                     | Дефолт                                  | Призначення                                                        |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `REDIS_URL`                | `redis://:saas-realtime@localhost:6379` | Брокер. У стеку — `redis://:${REDIS_PASSWORD}@valkey:6379`         |
| `REALTIME_KEY_PREFIX`      | `saas:rt`                               | Префікс усіх ключів — дозволяє ділити один Valkey між інсталяціями |
| `REALTIME_ALLOWED_ORIGINS` | `http://localhost:5173`                 | Allowlist origin-ів (через кому)                                   |
| `REALTIME_LEASE_TTL_MS`    | `60000`                                 | Скільки живе lease без продовження                                 |
| `REALTIME_HEARTBEAT_MS`    | `20000`                                 | Період batch-продовження                                           |
| `REALTIME_SWEEP_MS`        | `5000`                                  | Період прибирання протермінованих                                  |
| `REALTIME_RECOVERY_MS`     | `120000`                                | Вікно connection state recovery; `0` — вимкнути                    |
| `REALTIME_LAST_SEEN_MARK_MS`  | `300000`                             | Як часто жива сесія оновлює `users.last_seen_at`                   |
| `REALTIME_LAST_SEEN_FLUSH_MS` | `15000`                              | Період зливу буфера позначок у БД                                  |

**Origin перевіряється через `allowRequest`, а не лише CORS**: browser CORS захищає HTTP,
але **не** WebSocket-транспорт. Відсутній Origin (не-браузерні клієнти, інтеграційні
тести) пропускається свідомо — заголовок усе одно підробний, а перевірка захищає від чужої
_сторінки_ в браузері, де Origin проставляє сам браузер. Справжня автентифікація — JWT,
вона обовʼязкова завжди.

Брокер вважається trusted internal infrastructure: приватна мережа, пароль, без публічного
порту. Payload-и подій не містять токенів або секретів; трафік адаптера сам по собі не
підписаний.

## Інфраструктура

**Dev** (`docker/docker-compose.yml`): сервіс `valkey` на `${REDIS_PORT:-6379}`,
`--requirepass`, `--maxmemory` + `--maxmemory-policy noeviction`, без персистентності
(`--save ''`, `--appendonly no`). `noeviction` — свідомо: тиха eviction presence-ключів
гірша за явну помилку. Якщо 6379 зайнятий іншим проєктом, `REDIS_PORT` і `REDIS_URL`
мають вказувати на один порт.

**Swarm** (`docker/docker-compose.stack.yml`): той самий сервіс, але порт **не
публікується взагалі** — доступ лише по overlay. Volume не потрібен; `update_config` —
`stop-first`, бо інстанс один. Env їде через anchor `x-realtime-env` у сервіс `api`;
`REDIS_PASSWORD` і `REALTIME_ALLOWED_ORIGINS` — у `docker/deploy.env`. Origin збігається з
`S3_CORS_ALLOWED_ORIGINS`.

**nginx** (`docker/nginx/default.conf.template`) — єдиний проксі на шляху:

```nginx
location /socket.io/ {
    set $backend "${API_UPSTREAM}";
    proxy_pass $backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;   # без цих двох заголовків
    proxy_set_header Connection "upgrade";       # Upgrade не відбудеться взагалі
    proxy_buffering off;                          # буферизація ламає стрімінг кадрів
    proxy_read_timeout 300s;                      # > pingInterval + pingTimeout (25s+20s)
    proxy_send_timeout 300s;
}
```

Той самий динамічний `resolver 127.0.0.11` + `set $backend`, що й у `/api/` — інакше IP
бекенда залипне після redeploy.

**Vite** — окреме правило `/socket.io` з `ws: true` (без нього dev-proxy пропускає лише
HTTP і клієнт вічно реконектиться) і **без** `changeOrigin`: підміна origin не пройшла б
allowlist.

**CI** — одноразовий контейнер `valkey` поруч із Postgres у мережі джоби `verify`
(`scripts/ci-verify.sh`). Без пароля: він ефемерний і доступний лише цій мережі.

**Коли зʼявиться TLS-проксі**: термінувати TLS на edge, socket стає `wss://`, ті самі
Upgrade-заголовки й idle timeout переїжджають туди. Повертати polling+sticky доведеться
тільки якщо реально знадобиться fallback — тоді edge має виставляти affinity-cookie
(`Secure`, `HttpOnly`, `SameSite=Lax`), а `api` — перейти на `endpoint_mode: dnsrr`, бо
через VIP sticky неможлива.

## Режими відмов

| Подія                     | Поведінка                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Закрита остання вкладка   | `pagehide` → навмисний disconnect → lease звільняється одразу → offline-дельта                                       |
| Зникла мережа             | Реконект; offline лише після TTL, щоб не блимати на короткому розриві                                                |
| Crash ноди                | Її leases протермінуються; sweeper будь-якої іншої ноди публікує offline                                             |
| Rolling deploy            | Новий таск стартує ДО зупинки старого, обидва в адаптері; старий на SIGTERM віддає leases і закриває сокети          |
| Brokers недоступний       | REST/auth/черги працюють; `GET /presence` → 503, UI показує «невідомо»; після відновлення нода шле `resync-required` |
| Рестарт Valkey            | Presence відбудовується heartbeat-ами за один інтервал; клієнти інвалідують snapshot                                 |
| Пропущена дельта          | Розрив у ревізії → resync із REST                                                                                    |
| Юзера/тенант деактивовано | Новий handshake відхилено. Примусове закриття вже відкритих сесій — окрема майбутня операція                         |

## Спостережуваність

Логи не містять access-токенів, PII у назвах room або повних payload-ів. Метрики, які
варто зняти (у моніторинг ще не виведені):

- поточна кількість зʼєднань на інстанс;
- connect/disconnect/reconnect/recovered totals;
- відмови handshake за закритим кодом причини;
- латентність і помилки продовження leases, кількість протермінованих;
- емісії, лаг доставки, кількість resync через розрив ревізії;
- стан зʼєднання з брокером, латентність команд, довжина стріму і памʼять;
- тривалість drain.

`tenantId`/`userId` **не** можна класти в labels метрик — cardinality explosion. Для
діагностики вони доступні як structured log fields.

## Тести

`apps/api/test/realtime.e2e-spec.ts` піднімає справжній HTTP-сервер (`app.listen(0)`) і
ходить справжнім `socket.io-client`: підміняти транспорт немає сенсу, бо саме він і є
предметом. Valkey потрібен живий — як Postgres; ізоляцію дає окремий
`REALTIME_KEY_PREFIX` на кожен jest-worker, не окреме сховище.

Покрито: handshake без токена / з підробленим / з підписаним чужим секретом (межа
plane-ів) / деактивованого юзера; дві вкладки і закриття кожної з них; монотонність
ревізій; ізоляція snapshot-у і дельт між тенантами; протермінування lease — детерміновано,
через окремий store з TTL 50 мс замість очікування хвилини.

Last seen (RT-3): юзер без жодного конекту → `null`; connect ставить позначку і **не рухає
`updated_at`**; offline-дельта несе рівно той час, що записаний у БД; старіша позначка
(шлях sweeper-а) не відкочує новішу; позначка з контекстом чужого тенанта відсікається RLS.
Детермінізм дає явний `flushNow()`, а не зменшений інтервал таймера.

Не покрито автотестами (перевіряється руками на стеку): поведінка при `docker service
scale` і rolling update, рестарт брокера під навантаженням, навантажувальний профіль.

Після зміни контрактів або контролера: `pnpm openapi:generate` → `pnpm web:codegen`.

## Граблі

1. **Приватний метод не можна називати `handleDisconnect`.** Nest шукає хук на інстансі за
   іменем (`if (instance.handleDisconnect)`) — `private` у TS на це не впливає, — підписує
   його сам і викликає з одним аргументом. Тоді на кожен розрив приходять два виклики:
   спершу Nest-івський із `reason === undefined`, потім свій зі справжньою причиною.
   Перший знімав сокет із локального обліку, другий уже не знаходив його — **lease не
   звільнявся ніколи**, і юзер лишався online після закриття вкладки. Симптом виглядав як
   баг presence, причина була в іменуванні.
2. **`blockTimeInMs` адаптера = час виходу процесу.** Дефолтні 5 с блокуючого XREAD
   додаються до кожного `SIGTERM`. Знижено до 1 с: у простої це один зайвий round-trip на
   секунду, зате drain при `stop-first` на 4 секунди коротший.
3. **Клієнт мусить бути singleton поза React-деревом.** У `useEffect` StrictMode створив би
   другий socket — тобто другу lease, зайвий heartbeat і фантомний online після закриття
   однієї вкладки.
4. **`$executeRaw` обходить tenant-extension.** Extension домішує `set_config` лише до
   операцій над моделями; сирий стейтмент їде без tenant-контексту, і під `saas_app`
   політика `tenant_isolation` оновлює **нуль рядків** — мовчки, без жодної помилки. Тому
   запис last-seen іде в `runWith(tenantId) → withTenantTx`, а не прямим `prisma.$executeRaw`.
5. **`users.id` — `text`, а не `uuid`.** Prisma тримає id як `String`, тож `unnest($1::uuid[])`
   у `WHERE u.id = t.id` падає з `operator does not exist: text = uuid`. Каст мусить бути
   `::text[]`.
6. **Адаптер сам дублює клієнт Valkey** для блокуючого XREAD, тому presence і розсилка
   спокійно ділять один інстанс — блокуюча команда не займе конекшн, на якому виконуються
   presence-скрипти.

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
