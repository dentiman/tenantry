# Realtime: контрольні питання

> Супровідний матеріал до [realtime.md](../realtime.md) і
> [realtime-internals.md](../realtime-internals.md). Мета — пройтися від термінології до
> імплементації і зрозуміти, **чому** рішення саме такі. Питання не мають «правильної
> відповіді у кінці» — це чек-лист розуміння.
>
> Підсистема вже реалізована, тож більшість відповідей є в коді, а не лише в дизайні.
> Найкорисніші місця для звірки: auth-цикл (розділ D) — `socket-auth.service.ts` і
> `realtime.gateway.ts`; CLS і мультитенантність (E) — `socket-auth.service.ts` (`runWith`)
> та структура ключів у `presence.store.ts`; механіка presence (F) — `presence.lua.ts` і
> `presence.service.ts`; фронт і стан (H) — `apps/web/src/realtime/`; тести (K) —
> `apps/api/test/realtime.e2e-spec.ts`.
>
> Три відповіді реалізація уточнила проти початкового дизайну: бюджет offline-детекції на
> дефолтах дає **65 с** (питання 48), lease при НЕнавмисному розриві свідомо **не**
> звільняється одразу (53), а `GET /presence` при відмові брокера віддає **503**, а не
> порожній список (64). Транспорт зафіксовано як `transports: ['websocket']`, тому питання
> про sticky sessions і polling (7, 26, 83, 84) читай як «чому ми змогли від цього
> відмовитись і що доведеться зробити, якщо повертати fallback», а про `wss`/mixed content
> (90) — як «що зміниться, коли зʼявиться TLS-проксі».
>
> Питання 100 («а якщо просто polling кожні 15 с») лишається чинним і не риторичним.

## A. Транспорт і термінологія

1. Чим WebSocket відрізняється від HTTP long-polling на рівні TCP-з'єднання і хто ініціює передачу даних у кожному випадку?
2. Що конкретно відбувається під час HTTP Upgrade handshake (заголовки `Upgrade`, `Connection`, `Sec-WebSocket-Key`) і чому це важливо для reverse proxy?
3. Чому WebSocket не підпадає під browser CORS так, як звичайний `fetch`? Що саме браузер перевіряє, а що ні?
4. Що таке SSE (`EventSource`), у чому його обмеження порівняно з WebSocket і чому «односпрямований» — не єдина проблема в нашому кейсі?
5. Чим Engine.IO відрізняється від Socket.IO? Що з них відповідає за транспорт, а що за rooms/namespaces/ack?
6. Що таке «transport upgrade» у Socket.IO: з чого стартує з'єднання за замовчуванням і коли воно переходить на WebSocket?
7. Чому polling fallback тягне за собою sticky sessions, а `transports: ['websocket']` — ні?
8. Що таке heartbeat (`pingInterval` / `pingTimeout`) і чим він відрізняється від TCP keepalive?
9. Що таке backpressure у контексті WebSocket і що станеться, якщо сервер емітить швидше, ніж клієнт читає?
10. Дай визначення: at-most-once, at-least-once, exactly-once. До якої категорії належить Socket.IO emit і чому?
11. Що таке «ordering guarantee per connection» і чому воно не поширюється на два різні з'єднання?

## B. Socket.IO: механіка

12. Namespace vs room — у чому різниця з точки зору ресурсів сервера? Чому в документі namespace один (`/tenant`), а не по namespace на tenant?
13. Як влаштований room у Socket.IO: це структура на сервері чи в broker-і? Що стається з room при reconnect?
14. Що таке acknowledgement (callback у `emit`) і чому він не робить доставку надійною?
15. Що таке connection state recovery: які саме дані відновлюються, скільки живуть і за яких умов recovery провалюється?
16. Що робить опція `skipMiddlewares` при recovery і чому в документі вона мусить бути `false`? Яка атака стає можливою при `true`?
17. Що таке `allowRequest` і чим він відрізняється від CORS-налаштувань Socket.IO?
18. Чим socket middleware відрізняється від NestJS guard/interceptor? Чому `JwtAuthGuard` не можна «просто застосувати» до gateway?
19. Як Socket.IO передає `auth` payload при handshake і чому це надійніше за токен у query string?
20. Що таке `socket.data` і чому саме туди кладуть `tenantId`/`sub`/`role`, а не в замикання handler-а?
21. Як влаштований NestJS `WebSocketAdapter` і що робить `IoAdapter`? Навіщо адаптеру доступ до того самого HTTP-сервера, що й REST?

## C. Масштабування і adapter

22. Що робить Socket.IO adapter і що зламається без нього в multi-node deployment?
23. Порівняй classic Redis adapter (pub/sub) і Redis Streams adapter: яка головна різниця в семантиці доставки?
24. Що таке Redis Stream, consumer group і чим `XADD`/`XREAD` відрізняються від `PUBLISH`/`SUBSCRIBE`?
25. Що таке `maxLen` для стріму і що станеться з нодою, яка «проспала» довше за довжину стріму?
26. Чому Redis adapter не рятує від потреби у sticky sessions при polling?
27. Чому `LISTEN/NOTIFY` у PostgreSQL відхилено? Які саме обмеження (розмір payload, connection state, навантаження) стали вирішальними?
28. Чому Valkey не замінює pg-boss? Сформулюй межу відповідальності кожного.
29. Що таке Redis Cluster hash tag (`{...}`) і навіщо він у ключах presence?
30. Чому Lua-скрипт у Redis атомарний і які обмеження це накладає (одна нода/один slot, no cross-slot)?

## D. Автентифікація і авторизація

31. Чому access-токен у socket не можна перевірити один раз назавжди? Що таке «long-lived connection with short-lived credential»?
32. Опиши повний цикл `auth.expiring.v1` → `auth.update.v1`: хто ініціює, що перевіряє сервер, що робить клієнт при невдачі.
33. Що має перевіряти сервер у новому токені, окрім `sub` і `tenantId`? Що станеться, якщо `role` змінився?
34. Що станеться, якщо клієнт проігнорує `auth.expiring.v1`? Хто гарантує, що прострочений токен не тримає з'єднання вічно?
35. Чому platform JWT ніколи не приймається tenant gateway-єм? Що конкретно захищає окремий `PLATFORM_JWT_SECRET`?
36. Юзера деактивували під час активної сесії. Що зараз станеться з його socket-ом і що має статися?
37. Як влаштований наш refresh-флоу на фронті (`refreshTokens()`, single-flight) і чому socket мусить перевикористати саме його, а не робити свій?
38. Токен зберігається в пам'яті Zustand. Що з socket-ом одразу після F5, поки refresh ще не пройшов?

## E. Мультитенантність

39. Як `tenantId` потрапляє в CLS для HTTP-запиту (`TenantResolutionMiddleware` → `JwtAuthGuard`) і чому цей ланцюг не працює для socket handler-а?
40. Що таке AsyncLocalStorage і чому кожен socket event потребує власного `runWith`, а не «одного разу при connect»?
41. У PostgreSQL ізоляція тенантів забезпечена RLS. Чим забезпечена ізоляція в Valkey? Це enforcement чи дисципліна?
42. Чому room-и іменуються `tenant:{tenantId}:user:{userId}`, а не `user:{userId}`? Що зламається без префікса?
43. Чому в room names і metric labels не можна класти email/ім'я?
44. Чому в документі сказано «поява `tenantId` у доменному сервісі — запах»? Як цей принцип має виглядати в presence-коді?

## F. Presence як розподілена задача

45. Сформулюй бізнес-визначення `online` з документа. Чому саме «хоч одне живе з'єднання», а не «активна вкладка»?
46. Чому lease зберігається на пару `(user, apiNode)`, а не на кожну вкладку? Скільки записів у Valkey дасть юзер із 5 вкладками на 2 нодах?
47. Що таке lease і TTL? Чим lease відрізняється від простого ключа з TTL, який перезаписують?
48. Порахуй бюджет offline-детекції: heartbeat 20 с, lease TTL 60 с, sweeper кожні N с. Який worst case до offline? Чи вкладається в ціль 45–60 с?
49. Чому heartbeat робить нода batch-ом, а не кожен socket окремо?
50. Що таке sweeper і чому він може працювати на кожній ноді без вибору лідера? Що робить його ідемпотентним?
51. Чому `revision` інкрементується тільки на переходах `0→1` і `1→0`, а не на кожному connect?
52. Чому `apiNodeId` — boot UUID, а не hostname? Наведи сценарій, де hostname ламається.
53. Що станеться з presence при `kill -9` ноди? А при graceful shutdown? Хто і коли публікує offline?
54. Опиши snapshot+delta протокол: три випадки порівняння `revision` і дію в кожному.
55. Чому revision-gap вимагає resync, а не «просто застосувати delta»?
56. Два клієнти одночасно отримали revision 43 і 42 у різному порядку (різні ноди). Що станеться в кожного?
57. У tenant-і 500 юзерів, ранковий пік — 300 логінів за хвилину. Скільки delta-подій і скільки потенційних resync-ів? Що з цим робити?
58. Чому presence не зберігається в Prisma-таблиці? Які саме властивості даних це визначають?
59. Чому в `UserResponse` не додається `isOnline`?
60. Presence — не audit. Що б довелося змінити, якби потрібна була історія входів?

## G. Redis / Valkey як інфраструктура

61. Чому Valkey, а не Redis? Що означає «RESP-сумісний» і чому env і npm-пакет можуть лишатись `redis`?
62. Що таке eviction policy? Чому для цього workload обрано `noeviction` і яка ціна цього рішення?
63. Valkey досяг `maxmemory` з `noeviction`. Що станеться з heartbeat, з adapter publish і що побачить користувач?
64. Valkey впав повністю. Що має лишитись працездатним? Що покаже UI — «всі offline» чи щось інше і чому це принципово?
65. Valkey перезапустився з порожньою пам'яттю. Як система сходиться назад до правильного стану і за який час?
66. Чому Redis тут вважається trusted internal infrastructure? Що з цього випливає для payload-ів подій?
67. Чи потрібна персистентність (RDB/AOF) для presence-даних? Обґрунтуй.

## H. Frontend і стан

68. Чому socket-клієнт — singleton поза React tree? Що зробить React StrictMode, якщо це буде `useEffect`?
69. Чому presence-snapshot живе в TanStack Query, а не в Zustand? Де межа між server state і client state?
70. Що робить socket-подія з кешем: `setQueryData` (patch) чи `invalidateQueries`? Коли який варіант і чому для notifications обрано інший, ніж для presence?
71. Що таке optimistic patch і чому для presence він безпечний, а для notification-списку — ні?
72. Юзер натиснув Logout. Що має статися з socket-ом і з його lease? Що буде, якщо про це забути?
73. Юзер відкрив 5 вкладок CRM. Скільки socket-з'єднань, скільки запитів `GET /presence`, скільки heartbeat-ів?
74. Vite dev proxy: чому `/socket.io` потребує окремого правила з `ws: true`?

## I. Notifications і durability

75. Чому in-app notification не може існувати лише як socket-подія? Сформулюй через delivery guarantees.
76. Дизайн сповіщень ([notifications.md](../notifications.md)) вирішив везти в socket-події **весь** рядок, а не тільки `{ notificationId }`. Чому це не порушує правила «жоден стан не живе тільки в сокеті»? Що саме утримує це правило замість «клієнт піде за вмістом у REST»?
77. Що таке transactional outbox? Яку конкретну проблему він вирішує порівняно з «INSERT, потім emit»?
78. Чому в нас це може бути `MessagePublisher.publish(tx, ...)`, а не окрема outbox-таблиця? Де межа цього підходу?
79. Worker створює notification і **може** зробити emit сам — headless Socket.IO `Server` без `listen()` на тому самому Valkey-адаптері. Як він доставляє подію клієнту, у якого нуль зʼєднань із цим процесом? Чому власний стрім `realtime.dispatch` (ранній начерк EDA §3.12) від цього відмовились?
80. Подія `notification.created.v1` доставилась двічі. Чому це безпечно?
81. Чому текст повідомлення не зберігається в БД (як і в `activities`)? Як це пов'язано з i18n-доктриною проєкту?
82. Чому pg-boss не годиться як live transport для notifications?

## J. Мережа, LB, деплой

83. Що таке session affinity (sticky sessions) і які механізми її реалізують (cookie, IP hash, consistent hashing)? Плюси/мінуси кожного.
84. Чому affinity cookie має бути `Secure`/`HttpOnly`/`SameSite=Lax`?
85. Чому idle timeout проксі має бути більшим за `pingInterval + pingTimeout`? Що побачить користувач, якщо ні?
86. Rolling deploy: опиши послідовність (readiness off → drain → release leases → exit). Що станеться, якщо drain коротший за reconnect-backoff клієнтів?
87. Що таке thundering herd при reconnect і як його гасять (jitter, exponential backoff)?
88. Чому gateway живе в кожній репліці `apps/api`, а не в окремому `apps/realtime`? Який критерій запустить винесення?
89. Що конкретно доведеться продублювати, якщо винести gateway в окремий сервіс?
90. Чому socket у production — тільки `wss`? Що ламається при mixed content?

## K. Спостережуваність, тести, деградація

91. Чому tenant/user ID не можна класти в metric labels? Що таке cardinality explosion?
92. Які метрики дозволять помітити, що presence «залипла» (юзери показані online, хоча вже пішли)?
93. Як виміряти dispatch lag між `emit` на одній ноді і доставкою на клієнта, підключеного до іншої?
94. Що має логуватись при handshake failure і чого там не має бути ніколи?
95. Як написати автотест на «cross-node emit» — що мінімально потрібно підняти і чи вкладається це в поточний Jest e2e?
96. Як детерміновано протестувати lease expiry, не чекаючи 60 секунд реального часу?
97. Як протестувати cross-tenant isolation для socket-ів? Який тест довів би її саме на рівні gateway, а не сервісу?
98. Що таке graceful degradation тут: перелічи функції, які мають лишитись працездатними при повній відмові realtime-шару.
99. Чому інфраструктурний spike був гейтом? Що саме він мав довести, перш ніж писати presence UI?
100. Сформулюй, який мінімальний набір проблем зникне, якщо взагалі відмовитись від realtime і робити polling `GET /presence` кожні 15 с. Що втратимо і за яку ціну.
