# AI-асистент: що збудовано (AI-0, AI-0.1)

Довідник поточного стану фічі. **Чому саме так** — у [ai-assistant.md](ai-assistant.md)
(дослідження і фазовий план); формальні артефакти фаз —
`openspec/changes/archive/2026-09-20-ai-assistant-pipeline-fake-provider/` (AI-0) і
`openspec/changes/ai-0-1-hardening/` (AI-0.1).

**Статус: AI-0 і AI-0.1 зроблено.** Конвеєр працює наскрізь — від кнопки в хедері до рядка в
Postgres — **виключно на `FakeLlmProvider`**: без ключа, без мережі, без витрат. Реальний
OpenAI-сумісний провайдер (`OpenAiCompatProvider`) приходить в AI-1 (крок `ai-1a`,
[ai-assistant.md](ai-assistant.md) §10.1) і підставляється за тим самим інтерфейсом через
конфіг, без зміни коду.

**AI-0.1** закрила борг AI-0
([ai-assistant-review-gaps.md](ai-assistant-review-gaps.md), усі пункти закриті) і дефект §6.3
попереднього видання цього доку (багатовкладковий стрімінг): виключна власність генерації
(`attempt` + оренда), ретрай усередині доставки для тимчасових помилок, закриття покинутих
відповідей, довговічний Stop, і сигнал `ai.conversation-changed.v1` для інших вкладок того
самого юзера. Деталі рішень — `openspec/changes/ai-0-1-hardening/design.md` (D1–D8), не
дублюються тут, окрім підсумку нижче.

---

## 1. Що це і чим не є

Бічна персистентна панель довідки по продукту в tenant-порталі. **Не** аналітик даних: доступу
до бізнес-даних тенанта в неї немає **за побудовою** — функція збірки промпту таких аргументів
не приймає (§6).

Нічого спільного з area `Chat` (людські розмови з кастомерами) — окрема поверхня, окрема
модель даних, окремий протокол.

## 2. Карта коду

```
libs/contracts/src/ai/            схеми розмови/повідомлення/питання, AI_MAX_INPUT_CHARS,
                                  AiMessageErrorCode; attempt/chunkCount на повідомленні
libs/contracts/src/realtime/      + ai.message-delta.v1 (+attempt), ai.message-completed.v1,
                                  ai.conversation-changed.v1 (AI-0.1, сигнал без даних)
libs/shared/src/ai/
  ai.config.ts                    AI_* env → AiConfig (Zod, fail-fast); +providerRetries,
                                  retryDelayMs, pendingTimeoutMs, cancelCheckMs, leaseMs
                                  (похідне: requestTimeoutMs + AI_LEASE_GRACE_MS)
  ai.module.ts                    @Global: конфіг + реєстр провайдерів + канал скасування +
                                  AiMessageStateService
  ai-cancel.channel.ts            Valkey pub/sub «зупинити генерацію» (швидкий шлях)
  ai-message-state.service.ts     AI-0.1: УСІ переходи статусу відповіді, для API й воркера
                                  разом — claim/restart/persistPartial/isCancelRequested/
                                  finalize (воркер) + cancelPending/requestCancel/
                                  closeAbandoned (API); кожен перехід — фенсинг-`updateMany`
  llm/llm-provider.ts             ІНТЕРФЕЙС + LlmProviderError{retryable} + токен LLM_PROVIDER
  llm/fake-llm.provider.ts        єдина реалізація, з директивами для важких гілок
  prompt/prompt-builder.ts        (history, question, knowledge, user) → LlmMessage[]
  prompt/history.ts               AI-0.1: selectHistoryPairs — лише ЗАВЕРШЕНІ пари питання/
                                  відповідь, без дублювання поточного питання
libs/shared/src/messaging/
  definitions/ai.messages.ts      ai.generate-reply (команда)
  topology.ts                     + рядок ai-generator з опціями воркера; retryLimit тепер
                                  покриває лише падіння процесу, не відмову провайдера
apps/api/src/ai/                  модуль: controller / service / mapper / dto
apps/api/src/realtime/            + RealtimeEmitter.aiConversationChanged (AI-0.1)
apps/worker/src/ai/
  ai-lease.guard.ts               AI-0.1: перевірка при старті — expireInSeconds > lease +
                                  ретраї, інакше воркер не піднімається
  chunk-coalescer.ts              AI-0.1: чистий клас, коалесування кадрів провайдера
apps/worker/src/subscribers/
  ai-generate-reply.subscriber.ts координатор життєвого циклу генерації
apps/web/src/components/ai/       панель, тригер, Markdown, use-ai-enabled
apps/web/src/realtime/ai-sync.ts  міст socket → TanStack Query; позиція читається з
                                  кешованого повідомлення (attempt/chunkCount), не з
                                  окремого модульного лічильника
apps/web/src/stores/ai-panel.store.ts
libs/database/prisma/             ai_conversations, ai_messages (+ RLS, частковий індекс,
                                  attempt/lease_expires_at/chunk_count/cancel_requested_at)
```

## 3. Модель даних

`AiConversation(id, tenantId, userId, status, createdAt, updatedAt, lastMessageAt)` +
`AiMessage(id, tenantId, conversationId, seq, role, status, content, errorCode, attempt,
leaseExpiresAt, chunkCount, cancelRequestedAt, model, promptTokens, completionTokens,
startedAt, completedAt, createdAt)`.

Рішення, які легко зламати заднім числом:

- **`seq`, а не `createdAt`** — порядок, курсор і детектор дірок це ОДНЕ рішення, і мітка часу
  не дає жодного з них. Арбітр — `@@unique([tenantId, conversationId, seq])`. Пара
  «питання/відповідь» це завжди `(seq-1, seq)`.
- **Одна активна розмова на юзера** — **частковий унікальний індекс**
  (`WHERE status = 'ACTIVE'`), сирим SQL у міграції: Prisma їх не вміє. Гонку двох вкладок на
  першому повідомленні вирішує `createMany({ skipDuplicates: true })` + перечитування
  (AI-0.1) — не `create()` + catch(P2002): unique violation обриває транзакцію в Postgres, і
  читання без rollback/savepoint після неї не відновило б її
  (`ai-assistant-review-gaps.md` п.4).
- **`RETIRED` замість видалення** — «нова розмова» скидає КОНТЕКСТ, не історію.
- **`attempt` + `leaseExpiresAt` — власність генерації (AI-0.1).** `attempt` росте на кожен
  перезапуск (ретрай або повторне захоплення покинутої відповіді) і є фенсинг-токеном: кожен
  запис під час генерації фільтрується по `id AND attempt = <мій>`, нуль оновлених рядків —
  власність утрачено. Оренда встановлюється і на `PENDING` (при створенні, `pendingTimeoutMs`),
  і на `STREAMING` (при захопленні, `leaseMs`); `NULL`/минула оренда — відповідь «покинута»
  (`ai-assistant.md` §6, `openspec/changes/ai-0-1-hardening/design.md` D1/D3).
- **`chunkCount`** — скільки дельт-кадрів уже увійшло в `content` цієї спроби; разом з
  `attempt` дає клієнту точку продовження після одного перечитування (D6).
- **`cancelRequestedAt`** — факт Stop у БД РАНІШЕ за pub/sub-сигнал (D4). `claim()` його НЕ
  чіпає: інакше Stop, поставлений на покинуту (впалу) спробу, губився б при reclaim.
- **Колонки обліку токенів зарезервовані, але не пишуться.** Nullable-колонки зараз коштують
  нічого і економлять AI-1 міграцію на таблиці, у якої на той час будуть рядки.

## 4. Дві межі доступу, і вони різні

| Межа | Хто тримає |
| --- | --- |
| тенант | **RLS** (`ENABLE`+`FORCE`, політика `tenant_isolation` за шаблоном MT-2) |
| людина | **сервіс** — кожен запит фільтрується по `userId` з токена |

Та сама доктрина, що для приватних каналів чату і приватних подій календаря: «RLS — межа
тенанта, а не учасника». Тому **ADMIN не бачить чужу розмову**, і в схемі про роль немає
жодної згадки.

Чужа або неіснуюча розмова → **404, не 403**: 403 підтвердив би, що вона існує.

Грантів у міграції немає свідомо: міграції йдуть під `saas_migrator`, а
`ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator` (`scripts/ensure-roles.ts`) уже роздає права
на кожну нову таблицю цієї ролі.

## 5. Поверхня API

Жоден роут не приймає id розмови — суб'єкт завжди з токена (доктрина `/account`).

| Роут | Що робить |
| --- | --- |
| `GET /ai/conversation` | активна розмова зі стрічкою; створюється на вимогу. Це і є ДЖЕРЕЛО ПРАВДИ для клієнта |
| `POST /ai/conversation/messages` | **202**: питання + порожня відповідь `PENDING`, і публікація команди — усе в одній транзакції |
| `POST /ai/conversation/reset` | **200** (не 201: ресурсу за цим шляхом не створюється) — стара розмова стає `RETIRED` |
| `POST /ai/conversation/messages/:id/cancel` | **204**; на вже завершеній відповіді — no-op, а не помилка |

Коди: `403` — асистент вимкнено в інсталяції; `409` — у розмові ще генерується відповідь;
`404` — чужа/неіснуюча; `429` — ліміт частоти. **Нових `ApiErrorCode` не додано**: цей enum
свідомо закритий і HTTP-рівневий (`error-handling.md` §1). Причина ПРОВАЛУ ГЕНЕРАЦІЇ — інша
сутність, вона живе в рядку відповіді як доменний `AiMessageErrorCode`
(`PROVIDER_UNAVAILABLE` / `TIMEOUT` / `INTERNAL`).

## 6. Приватність — властивість, а не обіцянка

Назовні їде рівно три речі: системна інструкція, те, що юзер надрукував, і (з AI-1) корпус
знань. Жоден рядок `customers`, `users` чи `calendar_events` шляху в промпт не має.

Тримає це **підпис функції**, а не дисципліна: `buildPrompt` приймає `user: AiUserContext`, де
`AiUserContext = { role, locale }`. Ні `email`, ні `name`, ні назви тенанта туди не передати,
не змінивши інтерфейс — тобто не поговоривши про приватність явно.

У панелі — **постійно видиме розкриття** «це AI, відповіді можуть бути хибні». Не тост і не
одноразова підказка: ст. 50 EU AI Act (діє з 2026-08-02) вимагає, щоб це було помітно в самій
взаємодії.

Відповідь моделі — **недовірений ввід**: рендер через `react-markdown` без `rehype-raw` і без
`dangerouslySetInnerHTML`, посилання лише http/https з `rel="noopener noreferrer"`. Межа введена
одразу, а не «текстом зараз, розміткою потім»: інакше перша версія була б небезпечною.

## 7. Конвеєр генерації

```
tx1  withTenantTx: прочитати розмову + історію (без поточного питання — review п.2),
                    claim() — фенсинг-захоплення, attempt++, вміст → ''
 —   БЕЗ транзакції: стрім провайдера → коалесування → дельти в сокет (attempt разом
                     із chunkSeq), кожні AI_PARTIAL_PERSIST_MS — фенсингований UPDATE
                     часткового тексту; періодична перевірка cancelRequestedAt
                     кожні AI_CANCEL_CHECK_MS, незалежно від кадрів провайдера
     ретрай         тимчасова помилка провайдера → пауза AI_RETRY_DELAY_MS (abortable) →
                     restart() (ще один фенсингований attempt++) → новий стрім, УСЕРЕДИНІ
                     цієї ж доставки (design.md D2)
tx2  withTenantTx: фінальний вміст + статус, фенсингований тим самим attempt; onCommit →
                    ai.message-completed.v1. Нуль оновлених рядків = власність утрачено —
                    МОВЧКИ, без емісії
```

**Транзакція не тримається через виклик моделі.** `withTenantTx` відкриває інтерактивну
транзакцію Postgres; протягнути крізь неї десятки секунд генерації означало б тримати конекшн
пулу і відкритий снапшот, який блокує vacuum по всій базі.

**Ідемпотентність і виключна власність — через `attempt`, а не через
`MessageInboxService.runOnce`.** `runOnce` ключується `messageId:consumerId` і назавжди зʼїв
би легальний ретрай після тимчасової відмови провайдера. `claim()` (в `AiMessageStateService`)
— умовний `UPDATE`: успіх лише для `PENDING`, або `STREAMING` з простроченою чи відсутньою
орендою. Дві конкурентні доставки того самого job — рівно один переможець; кожен подальший
запис (проміжний, рестарт, фінал) фенситься `attempt`, який `claim()` повернув, тож застаріла
спроба не може дописати чи фіналізувати чужий рядок
(`ai-assistant-review-gaps.md` п.1, design.md D1).

**Ретрай — усередині доставки, не через pg-boss.** Обробник не бачить `retryCount` черги, тож
лише самостійний лічильник (`AI_PROVIDER_RETRIES`) знає, чи лишився бюджет; чергу лишили для
відновлення ПІСЛЯ ПАДІННЯ ПРОЦЕСУ — редоставлений job захоплює покинутий рядок наново, бо його
оренда вже минула (review п.3, design.md D2).

**Покинута відповідь закривається на читанні, не сканером.** `PENDING`/`STREAMING` з
простроченою орендою → `FAILED`/`INTERNAL` при наступному `GET /ai/conversation` чи `ask()`,
до перевірки «зайнято» — інакше мертва відповідь тримала б розмову зайнятою вічно
(design.md D3).

**Скасування — факт у БД РАНІШЕ за pub/sub-сигнал.** Для `PENDING` — миттєве й фінальне
`CANCELLED` (`claim()` такий рядок більше не знайде). Для `STREAMING` — `cancelRequestedAt`,
і лише за успіху записи — сигнал швидкого шляху через Valkey pub/sub
(`{prefix}:ai:cancel:{messageId}`) → `AbortController`. Воркер перевіряє маркер одразу після
підписки (закриває гонку «Stop до підписки») і далі кожні `AI_CANCEL_CHECK_MS`, незалежно від
кадрів провайдера — інакше `__stall__`-подібний застряглий провайдер не зупинився б узагалі
(review п.5, design.md D4).

## 8. Протокол реального часу

| Подія | Payload |
| --- | --- |
| `ai.message-delta.v1` | `{ conversationId, messageId, attempt, chunkSeq, text }` |
| `ai.message-completed.v1` | `{ conversationId, messageId, status, errorCode, occurredAt }` |
| `ai.conversation-changed.v1` (AI-0.1) | `{ conversationId, reason, occurredAt }` — БЕЗ даних |

Перші дві емітує воркер (`WorkerRealtimeEmitter`) — тільки для того юзера, чия відповідь
генерується. Третю емітує `apps/api` (`RealtimeEmitter.aiConversationChanged`) з `ask()`
(`reason: 'turn-created'`), `reset()` (`'reset'`) і з `cancel()`/`closeAbandoned` при
фактичній зміні (`'reply-closed'`) — усі в `userRoom(tenantId, userId)` через той самий
Valkey-адаптер, нового транспорту не зʼявилось.

**`ai.message-delta.v1` лишається ПЕРШИМ у репозиторії випадком, коли socket-подія несе сам
вміст**, а не сигнал «перечитай» (`realtime.md`, правило 2). Виняток тримається на трьох
страховках тепер (AI-0.1 підсилила другу й додала третю) — копіювати патерн без них не можна:

1. `chunkSeq` монотонний у межах ОДНІЄЇ спроби (`attempt`). Дірка → клієнт не вгадує, а
   буферизує кадр і перечитує запит; текст приїжджає з Postgres. Втрата дельти сповільнює
   рендер, але нічого не втрачає.
2. **Вищий `attempt` — ознака перезапуску** (замість старого `chunkSeq === 0`): клієнт
   викидає накопичене від попередньої спроби. Строгіше за стару ознаку — воно ще й відкидає
   нульовий кадр застарілої спроби, який стара перевірка сплутала б із перезапуском
   (`ai-assistant-review-gaps.md` п.1, design.md D6).
3. **Стрічка каже, звідки продовжувати** (`attempt`, `chunkCount` на самому повідомленні):
   клієнт тримає буфер позачергових кадрів і застосовує їх одразу після ОДНОГО перечитування,
   без другого (design.md D6).

**`ai.conversation-changed.v1` — сигнал без даних для ІНШИХ вкладок того самого юзера**
(design.md D7, фікс §6.3 попереднього видання): перше питання ходу і `reset()` дельти взагалі
не мають — без цієї події сусідня вкладка дізналась би про них лише на власному наступному
запиті. Реакція клієнта — одне дедупліковане перечитування; `reason` — лише для логів.

**Чанки коалесуються** (`AI_STREAM_FLUSH_MS`, дефолт 120 мс, плюс межа абзацу), а не йдуть
токен-за-токеном: адаптер налаштований на `maxLen: 10 000`, і 500 кадрів на відповідь ×20
паралельних генерацій винесли б увесь буфер стріму разом із presence і сповіщеннями.

## 9. Черга: перший споживач, якому дефолти pg-boss не підходять

```ts
{ id: 'ai-generator', retryLimit: 1, retryDelaySeconds: 2,
  localConcurrency: 4, groupConcurrency: 2,
  pollingIntervalSeconds: 0.5, expireInSeconds: 120 }
```

**`retryLimit: 1` покриває лише падіння процесу (AI-0.1).** Тимчасова відмова провайдера
ретраїться УСЕРЕДИНІ доставки (§7); `expireInSeconds` мусить перевищувати
`leaseMs + retryDelayMs × providerRetries`, інакше pg-boss редоставив би job, чий власник
генерації ще живий — безпечно (`claim()` просто не вдасться), але марно спалює цей ретрай.
`AiLeaseGuard` (`apps/worker/src/ai/ai-lease.guard.ts`) перевіряє це при старті воркера й не
дає піднятись конфігурації, що це порушує.

`ConsumerSpec` у `MESSAGE_TOPOLOGY` заради цього навчився опцій воркера, а `MessagePublisher` —
`group`. Наявні вісім споживачів поведінки не змінили: поля опційні й не передаються, коли їх
не оголошено.

- `localConcurrency: 4` — дефолт pg-boss **1** означав би ОДНУ генерацію на всю інсталяцію.
- `groupConcurrency: 2` + `group: { id: tenantId }` на публікації — справедливість між
  тенантами, яку pg-boss рахує в БД крос-нодово. Обмеження **оптимістичне**: виміряно на слоті
  1 — три питання одного тенанта, створені за 30 мс, пішли паралельно (задокументоване вікно
  гонки), а ті самі три з інтервалом 1.5 с повелись за специфікацією (третє чекало ~9 с на
  слот). Межа справедливості, не коректності; коректність для одного юзера — унікальний стан
  рядка (409 «розмова зайнята»).
- `pollingIntervalSeconds: 0.5` — дефолтні 2 с це до 2 с тиші перед першим токеном.
  `useListenNotify` дав би мілісекунди, але вмикає LISTEN на весь інстанс, а `realtime.md`
  уже раз відхилив `LISTEN/NOTIFY` як глобальний ресурс кластера.

## 10. Фронт

`AiPanel` — **пʼята колонка шела**, найправіша, сусід `ContextPanelSlot` (не його дитина): йде
від верху вікна до низу і підрізає хедер справа. Стискає контент, не накриває його. Може бути
відкрита одночасно з контекстною панеллю.

Незалежність від роутингу — **властивість розміщення**, а не ефект: стан живе в Zustand-сторі
поза роутером (`ai-panel.store.ts`, відкритість у `localStorage`), тому переживає і навігацію
між area, і перезавантаження.

Прапорець `features.ai` їде в уже наявному `GET /settings/bootstrap` — у мапі `features`, яку
заклали порожньою саме під feature-gating. Нового ендпоінта не знадобилось.

## 11. Конфігурація

| Змінна | Дефолт | Що робить |
| --- | --- | --- |
| `AI_ENABLED` | `false` | панель і роути `/api/ai/*`; дефолт вимкнено свідомо |
| `AI_PROVIDER` | `fake` | поки **єдине** легальне значення; інше валить старт процесу. `ai-1a` додає `openai-compat`; `anthropic` відкладено (`ai-assistant.md` §5.3) |
| `AI_MODEL` | `fake-1` | лише в лог і в `ai_messages.model` |
| `AI_MAX_OUTPUT_TOKENS` | `1024` | стеля вартості одного ходу |
| `AI_HISTORY_TURNS` | `10` | скільки минулих ходів їде в промпт |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | понад — `FAILED`/`TIMEOUT` |
| `AI_STREAM_FLUSH_MS` | `120` | коалесування дельт |
| `AI_PARTIAL_PERSIST_MS` | `2000` | частота проміжного запису |
| `AI_ASK_LIMIT_PER_MINUTE` | `10` | ліміт частоти на КОРИСТУВАЧА |
| `AI_PROVIDER_RETRIES` | `1` | AI-0.1: скільки РАЗІВ перезапускати генерацію всередині ОДНІЄЇ доставки після тимчасової відмови провайдера; `0` — легально (жодного ретраю) |
| `AI_RETRY_DELAY_MS` | `2000` | AI-0.1: пауза перед перезапуском; скасовна Stop-ом чи таймаутом |
| `AI_PENDING_TIMEOUT_MS` | `300000` | AI-0.1: оренда `PENDING`-рядка з моменту створення — після цього відповідь «покинута» |
| `AI_CANCEL_CHECK_MS` | `2000` | AI-0.1: період власної перевірки маркера Stop, незалежно від кадрів провайдера |

`AI_LEASE_GRACE_MS` (константа коду, не env) = `30 000` — запас над `AI_REQUEST_TIMEOUT_MS`
для оренди власності генерації (`leaseMs`); поглинає розбіжність годинників API/worker на
одному вузлі (design.md D1, Risks).

`AI_MAX_INPUT_CHARS` змінною **не є**: 4000 запікається в Zod-схему, `createZodDto` і
OpenAPI-документ одночасно, тож конфігурована вона означала б, що ці троє можуть розійтися.
Це константа з `@saas-skeleton/contracts`.

## 12. Як це перевірено

| Рівень | Де |
| --- | --- |
| Юніт: провайдер, промпт/історія, конфіг | `libs/shared/src/ai/**/*.test.ts` (22) |
| Юніт: координатор генерації | `apps/worker/src/subscribers/ai-generate-reply.subscriber.test.ts` (21) — happy path, ретраї (`__fail__`/`__fail_once__`/`__reject__`), таймаут, Stop (pub/sub, БД-маркер, до підписки), проміжний запис, конкурентні доставки, покинута/жива оренда, втрата власності мід-стріму, історія без дублю питання |
| Юніт: коалесування, boot-guard | `apps/worker/src/ai/chunk-coalescer.test.ts` (6), `ai-lease.guard.test.ts` (3) |
| Юніт: клієнтський sync | `apps/web/src/realtime/ai-sync.test.ts` (13) — уся таблиця D6, включно з «перечитування відстає, буфер закриває розрив без другого перечитування» |
| Юніт: межа XSS | `apps/web/src/components/ai/markdown.test.tsx` (5) |
| E2E: контракт і доступ | `apps/api/test/ai.e2e-spec.ts`, `ai-disabled.e2e-spec.ts` (24) — включно з конкурентним першим використанням, конкурентними `ask()`, покинутою орендою, durable Stop |
| E2E: власність генерації проти СПРАВЖНЬОГО Postgres | `apps/api/test/ai-state.e2e-spec.ts` (8) — конкурентний `claim`, фенсинг застарілого `attempt`, покинута/жива оренда, `cancelPending` проти `claim`, `cancelRequestedAt` переживає reclaim |
| E2E: realtime | `apps/api/test/ai-realtime.e2e-spec.ts` (4) — справжній socket, `ai.conversation-changed.v1` в особистий room і його межі |
| E2E: RLS | `apps/api/test/rls.e2e-spec.ts` — розмова тенанта A невидима під B |
| E2E: ліміт частоти | `apps/api/test/rate-limit.e2e-spec.ts` |

`FakeLlmProvider` розуміє директиви в тексті питання — саме вони роблять важкі гілки
досяжними і з тесту, і з живого кліку:

| Директива | Що дає |
| --- | --- |
| `__fail__` | ретрай-придатна помилка НА КОЖНІЙ спробі → вичерпання ретраїв, `FAILED` / `PROVIDER_UNAVAILABLE` |
| `__fail_once__` (AI-0.1) | ретрай-придатна помилка РІВНО ОДИН РАЗ для запиту, далі успіх — видимий перезапуск |
| `__reject__` (AI-0.1) | НЕ ретрай-придатна помилка — одразу `FAILED`, без спроб повтору |
| `__stall__` | мовчання назавжди → таймаут або скасування (у т.ч. лише через БД-мітку Stop) |
| `__long__` | довга відповідь → зручно ловити Stop і коалесування |

## 13. Що AI-1 додає, не переписуючи це

AI-1 — п'ять окремих змін, кожна приєднується до ОДНОГО наявного шва (повний план —
[ai-assistant.md](ai-assistant.md) §10.1):

| Крок | Шов у поточному коді |
| --- | --- |
| `ai-1a` `OpenAiCompatProvider` | нова реалізація `LlmProvider` + значення `openai-compat` в `AI_PROVIDER` + рядок у `LLM_FACTORIES`; `usage` пишеться в уже зарезервовані колонки у `finalize()`; класифікація помилок лягає на наявний `LlmProviderError.retryable` |
| `ai-1b` корпус знань | аргумент `knowledge` у `buildPrompt` (існує, поки порожній) → `KnowledgeSource`; одна адитивна колонка `knowledgeVersion` |
| `ai-1c` персона в налаштуваннях | `SYSTEM_INSTRUCTION` у `prompt-builder.ts` розпадається на незмінні межі (код) + інструкцію тенанта (`settings.ai`) |
| `ai-1d` квоти | читання в `AiService.ask` перед `publish`; списання у фінальній транзакції субскрайбера; нова таблиця `ai_usage_counters` |
| `ai-1e` retention | нова cron-команда в `MESSAGE_TOPOLOGY` + підписник |

**Нативний `AnthropicProvider` у AI-1 не входить** — відкладено (`ai-assistant.md` §5.3): через
OpenAI-сумісний шар Anthropic не підтримує prompt caching, тож моделі Claude до появи
нативної реалізації не використовуються взагалі.

Жоден крок не чіпає протокол дельт, життєвий цикл власності генерації (AI-0.1) чи панель; зміни
моделі даних — лише адитивні (нова колонка, нова таблиця).
