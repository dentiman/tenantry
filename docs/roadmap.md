# Roadmap

Стан на **2026-08-15**. Рішення з обґрунтуваннями — в [architecture-proposal.md](architecture-proposal.md);
профільні деталі — у документах, на які посилається кожен рядок.

Документ описує **куди йдемо** і є єдиним місцем статусу фаз (`AGENTS.md` його свідомо не
веде). Історія «як робили» живе в профільних доках — тут завершені віхи лишені одним рядком, щоб було видно базу, на яку спирається план.

---

## 1. Зроблено

| Віха                            | Дата          | Що дала                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Док                                    |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Фаза 1 — фундамент**          | 2026-07-11    | Монорепо pnpm+Turborepo, ESLint/Prettier/Husky, CI; `libs/contracts` (Zod 4), `libs/database` (Prisma 7); auth + users end-to-end; конвеєр Zod → OpenAPI → orval → typed hooks; `apps/web`                                                                                                                                                                                                                                                                              | `architecture-proposal.md`             |
| **Фаза 2.1 — черги**            | 2026-07-11    | pg-boss v12 за власним `JobDispatcher`, `libs/shared` (`defineJob`, `@JobHandler`, `JobInboxService`), `apps/worker`, cron, транзакційний dispatch (замінено на EDA-1)                                                                                                                                                                                                                                                                                                  | `architecture-proposal.md`             |
| **Фаза 2.2 — помилки**          | 2026-07-12    | Наскрізний `ApiError`-envelope: `AllExceptionsFilter` → toast / fieldErrors у формах                                                                                                                                                                                                                                                                                                                                                                                    | `error-handling.md`                    |
| **I18N-1…3**                    | 2026-07-12    | `libs/i18n` + react-i18next, коди помилок замість тексту з бекенда, `users.locale` і реальний welcome-лист локаллю юзера                                                                                                                                                                                                                                                                                                                                                | `i18n-plan.md`                         |
| **DataGrid**                    | 2026-07-13    | `createDataGrid` — фільтри/сортування/пагінація/selection декларативно; поля з видимістю, набори полів (таби + Custom), порядок (панель полів і перетягування заголовків), `localStorage` per grid; `/users`, `/customers`, `/jobs`; стенд `/playground/components/data-grid`                                                                                                                                                                                                                                                                                                                                                                               | `docs/frontend/ui-stack.md`            |
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
| **AI-асистент AI-0.1** | 2026-09-27 | Закрито борг рев'ю AI-0: виключна власність генерації (`attempt` + оренда, фенсинг-переходи в `AiMessageStateService`), ретрай тимчасових відмов провайдера всередині доставки, закриття покинутих відповідей на читанні, довговічний Stop (маркер у БД раніше за pub/sub), історія без дублю питання, безпечне конкурентне створення розмови, сигнал `ai.conversation-changed.v1` для інших вкладок | `ai-assistant-implementation.md` |
| **AI-асистент AI-1a** | 2026-09-27 | Перший реальний провайдер `OpenAiCompatProvider` (офіційний пакет `openai`, `baseURL`, `maxRetries: 0` — єдиний цикл ретраю воркерний): стрім з `include_usage`, Stop/таймаут рвуть HTTP-запит, класифікація помилок у `retryable` (мережа/408/409/429/5xx/обрив стріму — так; інші 4xx — ні), `Retry-After` у межах `AI_RETRY_DELAY_MS`; облік токенів відповіді в `ai_messages`; ключ лише у воркера (`AiLlmModule`); попередження на хост Anthropic; обовʼязкова стеля витрат у `.env.example`/`deploy-swarm.md`. Тести — проти локального HTTP-стаба, без мережі. Ручний прогін із живим ключем — ще ні | `ai-assistant-implementation.md` §7.1 |
| **AI-асистент AI-1b** | 2026-09-27 | Корпус знань рівня 1: 13 документів для кінцевого юзера в `docs/ai-knowledge/` (front-matter `slug`/`title`/`audience`/`area`), генератор `pnpm ai:knowledge` → закомічений JSON-артефакт з версією-хешем, перевірка «не застарів + бюджет 100 000 символів» у `pnpm lint` і в новій CI-стадії `check`; шов `KnowledgeSource` + `StaticKnowledgeSource` (документи `admin` не йдуть у промпт не-ADMIN); `ai_messages.knowledge_version` пише `claim()` — промпт відтворюваний без зберігання | `ai-assistant-implementation.md` §14 |
| **AI-асистент AI-1c** | 2026-09-27 | Персона й інструкції асистента як дані організації: секція `settings.ai` (`persona` ≤ 500, `instructions` ≤ 4000, ADMIN-only на читання й запис, журнал без тексту), екран `/settings/ai` з попередженням про провайдера; незмінні межі асистента лишились у коді першим повідомленням (байт у байт як раніше), текст організації — окремим огородженим підпорядкованим повідомленням перед знаннями; воркер читає секцію в `prepare()` | `ai-assistant-implementation.md` §15 |
| **AI-асистент AI-1d** | 2026-09-29 | Третій рубіж захисту бюджету: `ai_usage_counters` під RLS (рядок на юзера й добу UTC, тенантний підсумок — агрегат при читанні, не окремий писаний рядок), перевірка квоти в `AiService.ask()` до publish, атомарне списання (`$executeRaw INSERT...ON CONFLICT`, знахідка конкурентного тесту — `Prisma.upsert()` на композитному ключі не атомарний) у `finalize()`; відмова — `400`+`fieldErrors: ai_quota_exceeded`, без нового `ApiErrorCode`; `cachedPromptTokens` — колонка `ai_messages`; токени провалених спроб свідомо не рахуються. Реалізовано паралельно з AI-1e двома Orca-воркерами (Sonnet 5) на спільній гілці | `ai-assistant-implementation.md` §16 |
| **AI-асистент AI-1e** | 2026-09-29 | Ретенція розмов: `AI_RETENTION_DAYS=90`, нічний cron `ai.purge-conversations` (`scope: system`, точка відліку — `lastMessageAt`, не `createdAt`), «видалити мої розмови» (`DELETE /ai/conversations`, негайно, без cron); фікс живого прогону — RETIRED-розмова більше не генерує відповідь, яку ніхто не побачить (`cancelRetired()` у `prepare()`, окремий метод, не зміна `claim()`) | `ai-assistant-implementation.md` §17 |
| **Чат CHAT-0.2a**               | 2026-10-09    | Чат став живим без нового клієнт → сервер протоколу: емісія after-commit з `post`/`create`/`markRead`/вступу в дефолтний канал в особисті room-и **активних учасників** (склад читається в тій самій транзакції, що пише зміну), `chat.message-created.v1` з повним рядком і `seq` та `chat.conversation-changed.v1` (`created`/`membership`/`read`, останній — лише власнику курсора і лише коли він справді зрушив). Клієнт: `chat-sync.ts` + `mergeIncomingMessage` (наступний `seq` → дописати, не новіший → ігнор, дірка → перечитати), та сама функція в `onSuccess` надсилання, відлуння власної репліки зводиться по `clientMessageId`; список розмов перечитується, а не патчиться. Прибрано кнопку «Оновити» і скорочений `staleTime`. AGENTS.md правило 15 переформульоване: payload у сокеті — лише з монотонним лічильником і resync через REST | `chat.md` §4.8.1 |
| **Чат CHAT-0.2c**               | 2026-10-13    | Сповіщення про внутрішні репліки: подія `chat.message-posted.v1` публікується в транзакції відправки, підписник `chat-notify` у воркері пише `chat.message_received` (колапс по розмові, підпис під отримувача, не сповіщає автора, тих, хто дивиться, і тих, хто вимкнув категорію); «хто дивиться» — `RealtimeEmitter.userIdsInRoom` до транзакції, fail-open; прочитання розмови (REST і сокет) гасить сповіщення в усіх вкладках (`NotificationRecorder.markReadByTarget`). Presence-крапку знято. Попутно виправлено: гонка двох однакових `clientMessageId` на `adapter-pg` віддавала 409 замість рядка переможця | `chat.md` §4.11 |
| **Чат CHAT-3b1**                | 2026-10-14    | Захоплення вебхуків Meta: рукостискання, сирі хуки з заголовками й результатом перевірки підпису (HMAC-SHA256 над байтами, перевірено на 215 справжніх хуках fms-dev), політика `CHANNEL_WEBHOOK_SIGNATURE` (`record` на стенді), підписка/відписка **номера** кнопкою з явним «забрати чужі події», читання захоплених подій адміном, публічна база адреси в стеку Hetzner. Нічого не інтерпретується: квитанцій і вхідних немає | `whatsapp-channel.md` §4.3/§4.13 |
| **Чат CHAT-3a**                 | 2026-10-14    | WhatsApp без вебхуків, лише вихід: `MetaCloudAdapter` (текст і схвалений шаблон за імʼям/мовою, таблиця помилок Meta → сім класів), підключення акаунта з перевіркою токена (`debug_token` за наявності app secret, доступ до WABA завжди) і синхронізація номерів, `channel_logs` (без вмісту й токенів, чистка 30 днів), вікно за вирішенням провайдера, шаблон у композері й шаблонна бульбашка, «нова розмова з номера» (`ChannelContactService`, `POST /chat/outreach`), `pnpm chat:connect-meta`. Жива перевірка на тестовому WABA власника. Немає: вхідних, квитанцій, підписки на вебхук — 3b | `whatsapp-channel.md` §4.5/§4.13 |
| **Чат CHAT-2b**                 | 2026-10-13    | Відповідь клієнтові на fake-провайдері: `QUEUED→SENDING→SENT/FAILED` у воркері на `key_strict_fifo`-черзі по розмові (обробник не вішає ключ: усе, крім повтору з лишком спроб, стає `FAILED` у рядку), вікно 24 год (422 `CHANNEL_WINDOW_CLOSED` + авторитетна перевірка у воркері), сім класів помилок із визначеними діями, «не вдалося підтвердити» замість сліпого повтору, квитанції вперед одним SQL-запитом з паркуванням і хвилинним підмітанням, `chat.message-updated.v1`; статус `OPEN/PENDING/RESOLVED`, призначення, привласнення і перевідкриття відповіддю, внутрішні нотатки, системні записи й активності (на розмові та на клієнті), сповіщення призначеному про вхідне; галочки в бульбашці, перемикач «відповідь / нотатка», елементи керування над стрічкою; симулятор квитанцій (`pnpm chat:simulate --status`). `ChannelAdapter` отримав `send` і `ChannelSendError` | `chat.md` §4.10 |
| **Чат CHAT-2a**                 | 2026-10-13    | Канальне ядро на fake-провайдері, лише вхідне: `messaging_accounts`/`channels`/`channel_contacts`+адреси/`channel_webhook_events`/`channel_unroutable_events` (без tenant), публічний вебхук (підпис над сирими байтами, рукостискання, 200 на нероутоване, `channel-webhook` ліміт), ingest у воркері (дедуп за `external_id`, одна відкрита розмова на контакт, автопривʼязка лише за єдиним збігом номера), гілка `access = 'tenant'` у єдиній функції доступу, скринька клієнтських розмов (`mine/unassigned/all`), картка контакта з привʼязкою до клієнта, блок «Вебхук» у налаштуваннях, сигнал `chat.inbox-changed.v1`, симулятор (`pnpm chat:simulate`, `CHAT_DEV_TOOLS`), журнал нероутованого в platform-web. Відповіді — CHAT-2b | `whatsapp-channel.md` §6 |
| **Чат CHAT-0.2b**               | 2026-10-09    | Клієнт → сервер: реєстр вхідних socket-подій у `realtime` (`defineClientSocketEvent` + `ClientEventRegistry`: ліміт частоти → Zod → tenant-контекст → ack із закритим переліком кодів), `chat.subscribe/unsubscribe/typing/read.v1`. Підписка на room розмови проходить ту саму функцію доступу, що REST (чужий/неіснуючий/залишений — однакова відповідь), typing ефемерний (`expiresInMs`, БД не чіпає, лише для тих, хто дивиться), прочитане через сокет з REST-запасом і тим самим `markRead`. «Прочитано» тепер від факту перегляду (вікно видиме й у фокусі + кінець стрічки на екрані); прокрутка стрічки — «слідувати за низом» (`autoScroll`), без якорів: надіслане повідомлення стає внизу, а не нагорі над порожнім спейсером, і той, хто гортає історію, не смикається. Повідомлення, як і раніше, йдуть особистими room-ами — відмовлена підписка не губить повідомлень | `chat.md` §4.8.2 |
| **Чат CHAT-0.1**                | 2026-09-22    | Перший видимий зріз чату — повний екран на REST, **без realtime**: `conversations`/`conversation_participants`/`chat_messages` під RLS, серверний `seq` через інкремент-і-повернення (він же серіалізує вставки в межах розмови), keyset-курсор по `seq`, ідемпотентне надсилання по `client_message_id` на частковому унікальному індексі, курсор прочитаного + денормалізовані непрочитані, дефолтний канал «General» із трьома місцями провізіонінгу, системні записи в тій самій стрічці (`type` + params, рендер i18next), **одна** функція доступу (RLS — межа тенанта, участь — межа людини). UI: список розмов, тред на `message-scroller`, свій композер, оптимістичний рядок у власному сторі поза кешем запитів. Свіжість — перечитування на фокус і після надсилання; місця під `publish`/`onCommit` позначені й порожні | `chat.md` §7 |
| **Account Settings V1**         | 2026-08-29    | Розділ `/settings` (Profile / Account / Security / Notifications / Appearance) на шаблоні `satnaing/shadcn-admin`; модуль `apps/api/src/account/` без id у шляхах; зміна власного пароля з доказом старого і поверненням свіжої пари токенів, «вийти звідусіль», справжній `POST /auth/logout` замість суто клієнтського виходу. Списку пристроїв немає свідомо — сесії як сутності в моделі auth не існує                                                              | `account-settings.md`                  |
| **Граф модулів**               | 2026-10-05    | Модуль = домен через усі застосунки й бібліотеки; рівні `infra → platform → core → feature`, явні ребра в `modules.config.ts`, перевірка `pnpm modules:check --strict` у `pnpm lint` (резолвить символи крізь barrel-и). Сім видимих порушень закрито: слоти фронтенду (`lib/slots.tsx`, `slot-fills.ts`), реєстри бекенду (`UserLifecycleHooks`, `BootstrapRegistry`, `SettingsService.updateSection` під `FOR UPDATE`), секції `ai` і `calendar` переїхали у свої модулі, platform-контракти розділено; Prisma-схема — файл на модуль (`prisma/schema/`). Невидимі для скрипта звʼязки — у плані | `modules.md` |

Проєктні документи без реалізації (готові до роботи):
фази чату `CHAT-0.2c` (сповіщення, звужена), `CHAT-2a…c` (канальне ядро на fake-адаптері),
`CHAT-3a…c` (WhatsApp Cloud API) і `CHAT-4` — [whatsapp-channel.md](whatsapp-channel.md) §6 і
[chat.md](chat.md) §7.3 (`0.3` і `CHAT-1` зняті 2026-10-13); інваріанти, на які вони спираються, — в §7.6,
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

### 2.10. AI-асистент: AI-2a завершено, далі AI-5 (керованість і витрати)

**Курс із 2026-10-03:** функціонал асистента далі не розширюємо — AI-2b (керовані джерела),
AI-3 (вкладення, експорт) і AI-4 (доменні tools) відкладено. Робимо AI-5
([ai-platform-controls.md](ai-platform-controls.md)):

1. **AI-5a — налаштування й вмикачі** (реалізовано): провайдер, URL, модель і ключ
   (зашифрований) в UI суперадміна; вмикач платформи, дозвіл tenant-у, вибір Tenant Admin.
2. **AI-5b — журнал витрат** (реалізовано): фактична (від провайдера) і розрахункова (за тарифом)
   вартість кожного виклику, вартість відповіді, тарифи з історією, звітність суперадміна.
3. **AI-5c — якість**: eval відповідей разом із вартістю (реалізовано: `pnpm ai:answers:eval`).
   Далі — перегляд набору питань власником, потім `ai-5c2-quality-settings` (вибір моделі й
   налаштувань якості за результатами eval).

AI-2a зроблено й заархівовано 2026-10-03: FMS-документація в чаті з перевіреними цитатами,
гібридний пошук за eval ([ai-assistant-implementation.md](ai-assistant-implementation.md)
§18–19). Історія AI-1 — нижче.

#### AI-1 (історія)

**AI-1 як фаза повністю зроблена й заархівована 2026-09-29** (усі пʼять кроків, див. таблицю
§1) — робоча версія: бічна панель довідки працює наскрізь, відповідає по продукту з корпусу
знань, персона/інструкції як дані організації, квоти токенів на юзера й тенанта, ретенція
розмов. Дефолт і CI — **фейковий провайдер** (без ключа, мережі й витрат), а
`AI_PROVIDER=openai-compat` підключає будь-який OpenAI-сумісний бекенд (рекомендовано
OpenRouter + ZDR) з обліком токенів відповіді. Живий прогін підтвердив кешування (~98% з
другого ходу).

1. ~~`ai-1a-openai-compat-provider`~~ — **зроблено 2026-09-27**: `OpenAiCompatProvider`
   (нативний Anthropic відкладено, §5.3) + облік токенів відповіді
   ([ai-assistant-implementation.md](ai-assistant-implementation.md) §7.1).
2. ~~`ai-1b-knowledge-corpus`~~ — **зроблено 2026-09-27**: `docs/ai-knowledge/`, генератор,
   бюджет у CI (у символах), `KnowledgeSource`, `knowledge_version`
   ([ai-assistant-implementation.md](ai-assistant-implementation.md) §14).
3. ~~`ai-1c-assistant-settings`~~ — **зроблено 2026-09-27**: персона/інструкції в `settings.ai`,
   екран `/settings/ai`, незмінні межі в коді першими
   ([ai-assistant-implementation.md](ai-assistant-implementation.md) §15).
4. ~~`ai-1d-usage-quotas`~~ — **зроблено й заархівовано 2026-09-29**: `ai_usage_counters`
   (юзер/тенант, доба UTC), відмова через квоту — `400`+`fieldErrors`, без нового
   `ApiErrorCode` ([ai-assistant-implementation.md](ai-assistant-implementation.md) §16).
5. ~~`ai-1e-retention`~~ — **зроблено й заархівовано 2026-09-29**: нічний cron
   `ai.purge-conversations`, «видалити мої розмови», фікс живого прогону — RETIRED-розмова
   більше не генерує відповідь ([ai-assistant-implementation.md](ai-assistant-implementation.md)
   §17). `ai-1d`/`ai-1e` реалізовано паралельно двома Orca-воркерами на спільній базовій
   гілці — мердж-конфлікти вийшли суто структурні.

**Перегляд 2026-10-03:** наступний AI-2a відразу додає PostgreSQL 17 + `pgvector`.
Проміжний результат AI-2a.2 — імпорт реального FMS Docs checkout і робочий
векторний пошук по ньому; AI-2a.3 підключає відповіді `AiPanel` із цитатами,
AI-2a.4 додає FTS у тому самому пошуку й оцінку якості. Ізоляція RLS
закладається до першого імпорту. AI-2b додає
керовані глобальні та tenant-документи,
а також `settings.ai.enabled` на тенанта. AI-3 розвиває метрики/якість (частина
потребує EDA-2); AI-4 резервується для окремо авторизованих read-only запитів до
live-даних через доменні сервіси. Деталі, альтернативи й критерії переходу —
[ai-assistant-retrieval-proposal.md](ai-assistant-retrieval-proposal.md); актуальна таблиця
фаз — [ai-assistant.md](ai-assistant.md) §10. **Перший інкремент AI-2a.1 готовий:**
PG17 + pgvector, bootstrap, tenant-таблиці, RLS та точний пошук за вектором.
FMS preview також готовий: 141 бізнесовий документ / 553 чанки / 74 882 токени (тестовий профіль, усі статуси, без ru/engineering/workbench), без API-викликів.
Наступне — embeddings/ingest → текстовий пошук. Детальний
[технічний план і статус](ai-assistant-implementation-plan.md); чат ще використовує
статичний корпус.

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
