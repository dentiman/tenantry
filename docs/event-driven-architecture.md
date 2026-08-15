# Event-Driven архітектура: аналіз наявного шару черг і цільовий дизайн

**Статус:** **EDA-0 і EDA-1 реалізовані й перевірені живим прогоном (2026-08-04).**
EDA-2 (екран DLQ у `/jobs`), EDA-3 (billing) і EDA-4 (realtime-підписник) — попереду.
Транспорт для EDA-4 уже є: RT-0…RT-2 (Socket.IO-гейтвей + Valkey) реалізовані 2026-08-15,
лишився сам підписник `/realtime` і стрім `realtime.dispatch` — див. §3.12 і `realtime.md`.
Вхідний сценарій — `docs/event-driven-scenario.md`. **Дата дизайну:** 2026-08-02.

Розділ 2 («Діагноз») свідомо збережений у теперішньому часі — він описує стан ДО EDA-1
і пояснює, навіщо кожна частина конвеєра існує. Реалізацію див. у §3 і §6.

**Що змінилося проти дизайну під час реалізації** (усе перевірено на живому pg-boss 12.26):

| Дизайн | Реалізація | Чому |
| --- | --- | --- |
| роздільник черги `#` | **`/`** — `users.user-registered.v1/welcome-email` | pg-boss `assertQueueName` приймає лише алфавітно-цифрові, `_`, `-`, `.`, `/`; `#` валив старт воркера. Мок pg-boss у e2e цієї перевірки не має — спіймано живим стартом, тому валідація імені черги тепер є і в маніфесті |
| `updateQueue` синхронізує всю політику | політика `policy` **не оновлюється**, лише warn | `UpdateQueueOptions = Omit<Queue, 'name' \| 'partition' \| 'policy'>` — pg-boss не дає змінити політику в місці |
| `eventId` | `messageId` | конверт спільний для подій і команд, тому ім'я нейтральне |
| окремі `defineJob`/`defineEvent` як два шляхи | `defineCommand`/`defineEvent` + **один** runtime | §3.1.1 — «усе працює однаково» |
| `correlationId` = pino `req.id` як є | + `genReqId` = uuid (з повагою до `X-Request-Id`) | дефолт pino — лічильник від 1 на кожному процесі: після рестарту й на другій репліці id повторюються, і кореляція ланцюга втрачає сенс |

Документ відповідає на конкретне питання: чи витримає наявний шар черг реальну бізнес-подію
з багатьма підписниками, і що саме треба змінити, щоб витримав. Еталонний сценарій —
**оплата інвойса**:

```text
POST /invoices/:id/pay  (транзакція)
  └─ invoice.status = PAID
        ├─ облік: проводка в реєстр
        ├─ баланс кастомера: зменшити заборгованість
        ├─ email кастомеру «інвойс оплачено»
        ├─ provisioning: підключити кастомеру сервіс
        └─ realtime: нотифікація у відкриту CRM
```

П'ять незалежних споживачів однієї події. Наявний шар побудований під один
(`users.user-registered` → `notifications.welcome-email`) і на п'яти ламається — нижче
показано, де саме.

---

## 1. Що вже є і працює

Інвентаризація без прикрас — фундамент значно кращий, ніж у типового проєкту на цьому етапі.

| Компонент | Файл | Стан |
| --- | --- | --- |
| Опис job-а як єдиного джерела правди | `libs/shared/src/jobs/job-definition.ts` | ✅ назва + Zod-схема + retry в одному місці |
| Абстракція транспорту | `job-dispatcher.ts` (`JobDispatcher`) | ✅ pg-boss замінюваний, домен від нього не залежить |
| **Транзакційна постановка** | `pg-boss.dispatcher.ts` → `fromPrisma(tx)` | ✅ job вставляється в тій самій транзакції, що й доменна зміна |
| Автореєстрація хендлерів | `job-worker.registrar.ts` + `@JobHandler` | ✅ DiscoveryService, cron теж |
| Ідемпотентність ефектів | `job-inbox.service.ts` + `processed_jobs` | ✅ inbox-патерн, вставка маркера + ефект в одній транзакції |
| Tenant-контекст крізь чергу | `defineTenantJob` + CLS-відновлення в registrar | ✅ MT невидима для хендлера |
| Розділення tenant/system scope | `JobScope` | ✅ cron ходить через `SystemPrismaService` (BYPASSRLS) |
| Моніторинг | `apps/platform-api/src/jobs` + `/jobs` UI | ✅ стани, черги, автооновлення |

**Головне, що вже зроблено правильно і що НЕ треба переробляти:** черга живе в тій самій
Postgres, що й дані, і `send(..., { tx })` через `fromPrisma` — це **вже повноцінний
transactional outbox**. Окрема таблиця `domain_events` + relay-воркер, які зазвичай будують
поверх зовнішнього брокера, тут не потрібні. Це фіксоване рішення, воно лишається.

---

## 2. Діагноз: 10 розривів

Кожен розрив показаний через сценарій оплати інвойса.

### 2.1. Немає різниці між **подією** і **командою**

`defineJob` описує і `users.user-registered` (факт, що стався), і
`notifications.welcome-email` (наказ комусь щось зробити). Це різні примітиви з різними
правилами:

| | Подія (event) | Команда (command) |
| --- | --- | --- |
| Семантика | «це сталося», минулий час | «зроби це», наказовий спосіб |
| Споживачів | 0..N, продюсер їх не знає | рівно 1, відомий |
| Можна ігнорувати | так | ні |
| Хто володіє контрактом | продюсер | споживач |
| Версіонування | обов'язкове (публічний контракт) | не потрібне |

Поки примітив один, у продюсера немає способу сказати «я публікую факт», і він змушений
перелічувати споживачів руками — див. 2.2.

### 2.2. Fan-out зашитий у код хендлера → продюсер знає всіх споживачів

Сьогоднішній fan-out (`apps/worker/src/handlers/user-registered.handler.ts`):

```ts
const result = await this.inbox.runOnce(context, async (tx) => {
  await this.jobDispatcher.send(welcomeEmailJob, {...}, { singletonKey, tx });
});
```

Щоб додати шостого споживача `invoice.paid`, треба **відредагувати чужий хендлер**. Це
класичне зворотне сполучення: подія перестає бути подією і стає списком викликів.

Причина технічна, а не стилістична: **черга pg-boss — point-to-point**. `boss.work(name)`
на двох процесах не дублює job — вони конкурують за нього. Тобто «п'ять хендлерів на одну
чергу» фізично неможливе; кожен споживач мусить мати **власну чергу**. Хтось має ці п'ять
черг наповнити — і зараз цим «хтось» є руками написаний fan-out-хендлер.

### 2.3. Немає DLQ — провалена бізнес-подія зникає мовчки

`PgBossService.ensureQueue` створює чергу так:

```ts
await this.boss.createQueue(definition.name, { retryLimit, retryDelay, retryBackoff });
```

`deadLetter` не задано. Після вичерпання retry job переходить у `failed` і **видаляється
retention-ом pg-boss (~7 днів)**. Для welcome-листа це прийнятно. Для проводки в облік по
оплаченому інвойсу — ні: гроші зайшли, проводки немає, і через тиждень немає навіть сліду.

### 2.4. Політика черги не оновлюється (drift)

```ts
const existing = await this.boss.getQueue(definition.name);
if (!existing) { await this.boss.createQueue(...); }
```

Черга створюється **один раз**. Змінили `retryLimit: 10` у визначенні — на живій БД нічого
не змінилося, бо черга вже існує. Це тиха розбіжність між кодом і рантаймом: у репозиторії
написано одне, у `pgboss.queue` живе інше. Ловиться тільки вручну.

### 2.5. Усі помилки ретраяться однаково

`runJob` робить `definition.schema.parse(job.data)` і будь-яку помилку кидає далі. Наслідок:

- payload не проходить валідацію (схему змінили несумісно) → **3 ретраї по 5с з backoff**,
  потім `failed`. Ретраї гарантовано марні: дані не зміняться.
- «Кастомер не існує», «інвойс уже скасовано» → те саме марне спалювання ретраїв.
- SMTP таймаут, БД перезапустилася → ретрай доречний.

Немає класу «не ретраїти, віддай у DLQ негайно». Poison-pill забиває чергу і замулює логи.

### 2.6. Ідемпотентність прив'язана до job-а, а не до події

`JobInboxService.runOnce(job)` пише в `processed_jobs` **pg-boss job id**. Це exactly-once
відносно ретраїв конкретного job-а — і це правильно. Але якщо той самий бізнес-факт
опублікують двічі (повторний клік «Оплатити», redelivery Stripe-вебхука, ручний
реплей) — це два різні job id, дві проводки, подвійний баланс.

Потрібен **бізнесовий ключ ідемпотентності**: `eventId`, згенерований один раз у момент
публікації, і inbox-ключ `${eventId}:${subscriberId}` (кожен споживач обробляє подію рівно
раз, незалежно від інших).

Додатково: `processed_jobs` **не чиститься взагалі** — cron-а на неї немає, таблиця росте
вічно.

### 2.7. Немає конверта: ні actor-а, ні кореляції, ні версії

Payload — голі дані (`{ userId, email }`). Наслідки, які вже видно в коді:

- **Актор губиться.** `email.sent` в Activity Log пишеться з `actor: system`, хоча
  першопричина — конкретний адмін, який натиснув «Create user». Ланцюг втратив авторство
  на першому ж хопі. У сценарії з інвойсом це критичніше: «хто ініціював списання» — питання
  для аудиту.
- **Ланцюг неможливо простежити.** Один HTTP-запит породжує 1 подію → 5 підписників → кожен
  може опублікувати похідну. Без `correlationId` зв'язати це в логах нічим.
- **Версії немає.** Перша ж несумісна зміна payload-а зустріне в черзі старі job-и —
  див. 2.5.

### 2.8. Порядок і паралельність між споживачами не описані

Підписники виконуються паралельно і незалежно. У сценарії це нормально для email і
realtime, але:

- **Provisioning має спрацювати тільки після успішної проводки.** Зараз немає жодного
  способу це виразити, крім «сподіватися».
- **Баланс — гроші.** Дві події `invoice.paid` по одному кастомеру обробляються двома
  воркерами одночасно → класичний lost update, якщо хендлер робить read-modify-write.
  `singletonKey` **сам собою** тут не допомагає: на звичайній черзі (`policy: standard`)
  він дедуплікує job-и, що *стоять у черзі*, і не серіалізує *виконання*. Це поширена
  омана, і в коді `singletonKey` уже вживається саме так. Інструмент серіалізації в
  pg-boss v12 є, але це окрема політика черги — див. §3.9.

### 2.9. Зовнішні системи не мають місця в моделі

«Інший сервіс, який відповідає за провіження» — якщо він поза монорепо, він не має доступу
до `pgboss.*` цієї БД. Модель мовчить про те, як подія перетинає межу процесу/довіри.
Запхати чужий сервіс у спільну БД-чергу — найгірший із можливих варіантів (спільна БД =
спільний деплой = не окремий сервіс).

### 2.10. Тестувати ланцюг нічим

У e2e pg-boss замокано цілком (`apps/api/test/__mocks__/pg-boss.ts`). Тобто перевіряється
«job поставлено», але **не «ланцюг відпрацював»**. Для п'яти підписників це означає нуль
покриття найцікавішої частини.

---

## 3. Цільова архітектура

Один транспорт (pg-boss, рішення не переглядається), **два примітиви** поверх нього,
і тонкий шар публікації/підписки.

```text
                       ┌──────────────── apps/api (продюсер) ────────────────┐
                       │  withTenantTx:                                       │
                       │    invoice.status = PAID                             │
                       │    activities.record(tx, 'invoice.paid')             │
                       │    events.publish(tx, invoicePaidEvent, {...})       │
                       └───────────────────────┬─────────────────────────────┘
                                               │ один publish → N insert-ів
                                               │ у ТІЙ САМІЙ транзакції
       ┌───────────────────┬───────────────────┼───────────────────┬───────────────────┐
       ▼                   ▼                   ▼                   ▼                   ▼
 …v1/accounting    …v1/customer-balance  …v1/invoice-email   …v1/provisioning    …v1/realtime
       │                   │                   │                   │                   │
   inbox+tx            inbox+tx            claim+send          relay HTTP         Redis Stream
   ledger entry        UPDATE +=           SMTP                idempotency-key    realtime.dispatch
       │                                                                                │
       └─ publish billing.invoice-posted.v1  (ланцюг, а не «порядок підписників»)       ▼
                                                                              Socket.IO → CRM
```

### 3.0. Що це таке фізично в Postgres (читати першим)

Найчастіше питання: «ми шлемо одну подію на N джобів, будуємо окремі черги, чи одну чергу
публікацій?» Відповідь: **N рядків, кожен у власну чергу підписника, усі в одній транзакції**.

Перед тим — факт, що знімає головне заперечення. У pg-boss v12 **черга не є ані таблицею,
ані процесом**: це рядок у `pgboss.queue`. Усі job-и всіх черг лежать в одній таблиці
`pgboss.job_common` (`QUEUE_DEFAULTS.partition = false`; партиціювання per-queue існує, але
вимкнене за замовчуванням). Тобто «багато черг» коштує майже нічого: 30 подій × ~2 підписники
≈ 60 рядків у `pgboss.queue`.

Оплата інвойса на рівні SQL:

```sql
BEGIN;
  UPDATE invoices SET status='PAID', paid_at=now() WHERE id='x' AND status='UNPAID';
  INSERT INTO activities ...;                       -- фід для людини
  INSERT INTO pgboss.job (name, data, singleton_key) VALUES
    ('billing.invoice-paid.v1/accounting',       {envelope}, 'invoice:x'),
    ('billing.invoice-paid.v1/customer-balance', {envelope}, 'customer:c'),
    ('billing.invoice-paid.v1/invoice-email',    {envelope}, NULL),
    ('billing.invoice-paid.v1/provisioning',     {envelope}, NULL),
    ('billing.invoice-paid.v1/realtime',         {envelope}, NULL);
COMMIT;
```

П'ять рядків з **ідентичним `data`** (той самий конверт, той самий `eventId`) і **різним
`name`**. Різний `name` — це і є «різні черги». Воркер тримає п'ять `boss.work()`, кожен
опитує свою назву.

**Чому не одна черга з п'ятьма хендлерами.** Фізично неможливо: `boss.work('billing.invoice-paid')`
на п'яти хендлерах не дублює job — вони **конкурують** за один рядок, хтось один забере,
решта не побачать. Це competing consumers, а не pub/sub. Саме тому наявний код змушений
робити fan-out руками в `UserRegisteredHandler`: при одній черзі іншого виходу немає.

**Чому не одна «черга публікацій» + relay.** Варіант робочий: 1 рядок при публікації,
relay-воркер читає і розкладає по чергах підписників. Ціна: зайвий хоп затримки; relay —
єдина точка серіалізації всіх подій системи; relay сам потребує inbox-а (упав після 2 з 5
send-ів → ретрай не має подвоїти перші два). Виграш — один рядок замість п'яти і природне
місце під архів/реплей. Обмін невигідний: п'ять `INSERT` у вже відкриту транзакцію
коштують менше, ніж окремий процес із власною семантикою відмов.

### 3.0.1. Вбудований pub/sub pg-boss: чому беремо форму, але не реалізацію

pg-boss v12 **уже має** pub/sub: таблиця `pgboss.subscription (event, name)`,
`boss.subscribe(event, queue)`, `boss.publish(event, data)`. Реалізація (`dist/manager.js`):

```js
async publish (event, data, options) {
  const { rows } = await this.db.executeSql(getQueuesForEvent, [event])
  await Promise.allSettled(rows.map(({ name }) => this.send(name, data, options)))
}
```

Форма — рівно та, що потрібна. Гарантії — ні:

1. **`Promise.allSettled` ковтає помилки.** Впав `INSERT` у чергу обліку — `publish()`
   повертається успішно. Для проводки грошей неприйнятно.
2. **Підписки — рантайм-стан у БД**, який хтось має наповнити викликом `subscribe`.
   Воркер не стартував жодного разу → таблиця порожня → `publish` розсилає **в нуль черг
   і тихо успішно**. Це саме та відмова, від якої рятує маніфест у коді (§3.3).
3. `getQueuesForEvent` іде повз транзакцію, а N паралельних `send` б'ють в один інтерактивний
   Prisma-tx-клієнт.

**Рішення:** власний `EventPublisher` — послідовні `send` у транзакції, fail-fast на першій
помилці, список підписників із маніфесту в коді. Опційно (nice-to-have) дзеркалити маніфест
у `pgboss.subscription` на старті воркера, щоб рідні інструменти pg-boss і сторінка `/jobs`
бачили топологію.

### 3.1. Подія і команда — два визначення

```ts
// libs/shared/src/jobs/job-definition.ts — БЕЗ ЗМІН
defineJob / defineTenantJob   // команда: 1 споживач, наказ
// файли: files.generate-thumbnail, auth.cleanup-expired-tokens — це команди, вони лишаються

// libs/shared/src/events/event-definition.ts — НОВЕ
export function defineEvent<TShape extends z.ZodRawShape>(
  name: `${string}.v${number}`,   // версія в назві — обов'язкова частина типу
  schema: z.ZodObject<TShape>,    // ТІЛЬКИ дані факту; envelope домішує publisher
): EventDefinition<z.ZodObject<TShape>>;
```

Правило іменування: `<домен>.<факт-у-минулому-часі>.v<N>` —
`billing.invoice-paid.v1`, `users.user-registered.v1`. Узгоджено з `notification.created.v1`
з `docs/realtime.md`.

Правило еволюції схеми:

- **додати опційне поле** → та сама версія, сумісно;
- **зробити поле обов'язковим, прибрати, змінити тип** → нова версія `.v2`; продюсер
  деякий час публікує **обидві**, споживачі переїжджають по одному, потім `.v1` видаляється
  після осушення черг.

#### 3.1.1. Два імені — **один конвеєр**

Вимога «хочу, щоб усе працювало однаково» виконується не злиттям понять, а злиттям
механіки. Подія і команда лишаються різними словами (бо це різні речі для читача коду), але
**рантайм-шлях у них однаковий**, без другої паралельної гілки:

| Спільне для подій і команд | Наслідок |
| --- | --- |
| Той самий конверт (`eventId`, `actor`, `correlationId`, `causationId`, `tenantId`) | cron-джоба теж має `correlationId` і теж видима в ланцюгу |
| Той самий runner (CLS, лог-конверт, тривалість, класифікація помилок) | один код, одна поведінка при відмові |
| Той самий inbox (`runOncePerEvent`, ключ `messageId:consumerId`) | ідемпотентність усюди однакова |
| Та сама DLQ `dlq` + `NonRetryableError` | один екран розбору на всю систему |
| Той самий маніфест | **уся топологія системи — в одному файлі**, включно з cron |

Різниця рівно одна і вона декларативна: у команди в маніфесті **рівно один** споживач і
немає вимоги версіонувати ім'я. Тобто команда — це окремий випадок того самого механізму,
а не окремий механізм:

```ts
export const MESSAGE_TOPOLOGY = {
  // події: N підписників, версія в імені
  'users.user-registered.v1':  { kind: 'event',   consumers: ['welcome-email'] },
  'billing.invoice-paid.v1':   { kind: 'event',   consumers: ['accounting', 'customer-balance',
                                                              'invoice-email', 'provisioning',
                                                              'realtime'] },
  // команди: рівно 1 споживач
  'files.generate-thumbnail':  { kind: 'command', consumers: ['thumbnailer'] },
  // cron: команда без продюсера, розклад тут-таки
  'files.cleanup-orphans':     { kind: 'command', consumers: ['orphan-cleaner'],
                                 cron: '30 3 * * *', scope: 'system' },
  'auth.cleanup-expired-tokens': { kind: 'command', consumers: ['token-cleaner'],
                                   cron: '0 3 * * *', scope: 'system' },
} as const;
```

Що це дає на практиці: `pgboss.job.data` має однакову форму для **будь-якого** рядка в
таблиці, `/jobs` показує все однаково, і питання «а чому thumbnail поводиться інакше, ніж
invoice-email» просто не виникає. Ціна — команди теж отримують конверт, зокрема cron
(де `actor: system`, `correlationId` генерується на запуску розкладу). Це нормально:
конверт коштує ~200 байт на job.

Що **не** робимо: не називаємо `files.cleanup-orphans` подією. «Cleanup-orphans» — не факт,
що стався, і в нього ніколи не буде другого підписника. Брехати в іменах заради формальної
однаковості — гірше, ніж мати два слова для одного конвеєра.

### 3.2. Конверт події

```ts
// libs/shared/src/events/event-envelope.ts
export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),                 // ключ ідемпотентності всього ланцюга
  name: z.string(),                  // 'billing.invoice-paid.v1'
  occurredAt: z.iso.datetime(),
  tenantId: z.uuid(),                // те саме, що робить defineTenantJob сьогодні
  actor: activityActorSchema,        // ПЕРЕВИКОРИСТАТИ тип із libs/shared/src/activities
  correlationId: z.string(),         // корінь ланцюга = pino req.id (той самий, що в ApiError.requestId)
  causationId: z.uuid().nullable(),  // eventId батьківської події
  data: z.unknown(),                 // валідує схема конкретної події
});
```

Три речі, які конверт відкриває задарма:

1. **Актор їде крізь ланцюг.** `email.sent` в Activity Log нарешті може бути записаний від
   імені людини, що ініціювала операцію, а не від `system`. Тип `ActivityActor` вже існує —
   переюзати його, не заводити другий.
2. **Кореляція наскрізна.** `correlationId` береться з `req.id` (pino-http вже його
   генерує і вже віддає юзеру в `ApiError.requestId`). Один id тримає HTTP-запит, 5 job-ів
   і всі похідні події. Один `grep` по логах — уся картина.
3. **Причинність.** `causationId` дає дерево, а не плаский список: видно, що
   `billing.invoice-posted.v1` спричинена саме цим `invoice.paid`.

### 3.3. Реєстр підписок — статичний маніфест

Це ключове рішення. Продюсер (`apps/api`) і споживачі (`apps/worker`) — **різні процеси**,
тому список підписників мусить бути відомий на боці продюсера в момент публікації.
Runtime-discovery тут не працює.

Це той самий `MESSAGE_TOPOLOGY` із §3.1.1 — **єдине місце, де видно всю асинхронну топологію
системи** (події, команди й cron разом), `libs/shared/src/messaging/topology.ts`.

Черга на споживача: **`${messageName}/${consumerId}`** →
`billing.invoice-paid.v1/accounting`, `files.generate-thumbnail/thumbnailer`. Наслідки, усі
бажані:

- відмова email-підписника **не чіпає** проводку в облік — окрема черга, окремі retry,
  окремий DLQ;
- у `/jobs` видно лаг і кількість фейлів **по кожному споживачу окремо**;
- додати шостого підписника = рядок у маніфесті + новий клас. **Жоден наявний файл не
  редагується.** Це рівно те, чого бракує сьогодні.

**Fail-fast на старті воркера:** registrar звіряє маніфест із набором знайдених
`@EventSubscriber`-класів і **падає**, якщо:

- у маніфесті є `(подія, підписник)` без класу → інакше job-и тихо накопичувалися б у
  черзі, яку ніхто не читає;
- є клас, якого немає в маніфесті → мертвий код, у чергу ніхто не пише.

**Порядок деплою неважливий.** Обидва процеси збираються з одного коміту, але навіть якщо
api піднявся раніше за worker — job-и просто чекають у durable-черзі. Зворотний випадок теж
безпечний.

**Зняття підписника — у два кроки:** прибрати з маніфесту й задеплоїти (публікація
припиняється) → дочекатися осушення черги → видалити клас і чергу. Одномоментне видалення
загубить job-и, що вже в польоті.

**Розглянуто й відхилено:** окрема таблиця `domain_events` + relay-воркер, який робить
fan-out. Відхилено, бо pg-boss через `fromPrisma` **уже є** транзакційним outbox-ом у тій
самій БД; relay додав би зайвий хоп, власну затримку, власні ретраї і єдину точку
серіалізації всіх подій системи. Ціна відмови: fan-out на момент публікації означає, що
**новий підписник не отримає історичних подій** (реплею немає). Прийнято свідомо; якщо
реплей колись знадобиться — додається архівна таблиця подій, і це не ламає нічого з описаного.

### 3.4. Публікація: `tx` першим аргументом

```ts
// libs/shared/src/events/event-publisher.service.ts
@Injectable()
export class EventPublisher {
  /**
   * tx — ПЕРШИЙ обов'язковий аргумент, за тим самим правилом, що й ActivityRecorder.record:
   * подію фізично неможливо опублікувати поза транзакцією доменної зміни.
   * Або факт і його публікація зафіксувалися разом, або нічого.
   */
  async publish<TSchema extends z.ZodType>(
    tx: Prisma.TransactionClient,
    event: EventDefinition<TSchema>,
    data: z.input<TSchema>,
    options?: { actor?: ActivityActor },
  ): Promise<EventEnvelope>;
}
```

Усередині: побудувати конверт (tenantId — з CLS, correlationId/causationId — з
`EventContext`, actor — з опцій або з контексту), провалідувати `data` схемою події, узяти
список підписників із маніфесту й зробити `dispatcher.send(..., { tx })` у чергу кожного.
Порожній список підписників — це попередження в лог, не помилка (подія може бути оголошена
раніше за споживачів).

Симетрія з наявним кодом навмисна: `ActivityRecorder.record(tx, …)` і
`EventPublisher.publish(tx, …)` виглядають однаково, бо роблять концептуально те саме —
фіксують факт у межах доменної транзакції.

### 3.5. Підписник

```ts
@Injectable()
@EventSubscriber(invoicePaidEvent, { id: 'accounting', retryLimit: 10, retryBackoff: true })
export class AccountingSubscriber implements EventSubscriberContract<typeof invoicePaidEvent> {
  constructor(private readonly inbox: JobInboxService) {}

  async handle(data: InvoicePaidData, envelope: EventEnvelope): Promise<void> {
    // ключ = eventId:subscriberId → кожен споживач обробляє подію рівно раз,
    // і повторна ПУБЛІКАЦІЯ того самого факту теж не подвоїть ефект
    await this.inbox.runOncePerEvent(envelope, 'accounting', async (tx) => {
      await tx.ledgerEntry.create({ data: { ... } });
    });
  }
}
```

Registrar робить довкола те саме, що й сьогодні для job-ів (CLS з `envelope.tenantId`,
лог-конверт, тривалість), плюс піднімає `EventContext` (correlationId, causationId =
`envelope.eventId`, actor) — щоб похідні публікації автоматично успадкували ланцюг.

### 3.6. Ідемпотентність по події — **без міграції БД**

`processed_jobs.id` — уже `String @id`. Тобто новий ключ вставляється в ту саму таблицю:

```ts
// libs/shared/src/jobs/job-inbox.service.ts — додати метод
async runOncePerEvent(
  envelope: EventEnvelope,
  subscriberId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<'processed' | 'skipped'> {
  return this.runOnce({ id: `${envelope.eventId}:${subscriberId}`, name: ... }, fn);
}
```

Наявний `runOnce(context)` лишається для команд. Що додати обов'язково —
**cron-чистку `processed_jobs`** (записи, старші за 30 днів; горизонт має бути більшим за
retention pg-boss ~7 днів із запасом). Зараз таблиця росте без обмежень.

### 3.7. Ретраї, DLQ, non-retryable

```ts
export class NonRetryableEventError extends Error {}   // libs/shared/src/jobs
```

Три зміни в `PgBossService`/`JobWorkerRegistrar`:

1. **DLQ за замовчуванням на кожній черзі — один спільний, не по DLQ на чергу:**
   `createQueue(name, { …, deadLetter: 'dlq' })`. `deadLetter` — просто ім'я черги, тому всі
   черги вказують на одну; pg-boss при переносі кладе ім'я вихідної черги в DLQ-job
   (`failJobs` передає `job.name` в insert). Один екран розбору, один replay замість
   шістдесяти. Вичерпані ретраї їдуть туди, а не в небуття.
2. **Швидкий шлях:** `NonRetryableEventError` (валідація конверта, невідома версія, порушене
   бізнес-правило) → відразу в DLQ + лог `error`, job завершується успішно. Ретраї не
   спалюються.
3. **Усунути drift:** якщо черга існує, але політика розійшлася з визначенням — `updateQueue`,
   а не мовчазний skip.

Класифікація помилок як контракт хендлера:

| Причина | Клас | Поведінка |
| --- | --- | --- |
| БД/SMTP/мережа недоступні | будь-яка помилка | ретрай із backoff |
| Конверт не парситься, невідома версія | `NonRetryableEventError` | одразу DLQ |
| Порушене бізнес-правило («інвойс скасовано») | `NonRetryableEventError` | одразу DLQ |
| Сутність ще не з'явилася (гонка) | звичайна помилка | ретрай (гонка розсмокчеться) |

DLQ-черги видно в наявному `/jobs` (вони — звичайні черги pg-boss); потрібен фільтр і
кнопка «replay» — див. фазу EDA-2.

### 3.8. Порядок — це ланцюг подій, а не порядок підписників

Вимога «provisioning тільки після успішної проводки» **не** виражається порядком
підписників (їх немає — вони паралельні і рівноправні). Вона виражається так:

```text
billing.invoice-paid.v1
   └─ /accounting → ledger entry (inbox+tx)
        └─ publish billing.invoice-posted.v1  (causationId = eventId інвойса)
             └─ /provisioning → підключити сервіс
```

Provisioning підписується на `invoice-posted`, а не на `invoice-paid`. Правило,
яке варто зафіксувати як стиль: **якщо між двома ефектами є залежність — між ними має
бути подія.** Спроба виразити залежність порядком або затримкою (`startAfterSeconds`) —
завжди баг, який стрельне під навантаженням.

### 3.9. Гроші: реєстр, атомарні інкременти, звірка

Найнебезпечніший підписник у сценарії. Три правила, невідступно:

1. **Реєстр (`ledger_entries`) — append-only і є джерелом правди.** Рядок несе `eventId`
   із `UNIQUE` — БД сама відхилить дубль, навіть якщо inbox чомусь пропустив.
2. **Баланс міняється тільки атомарним SQL:**
   `UPDATE customers SET balance = balance + $1 WHERE id = $2`. Ніякого
   read-modify-write у JS — інакше два паралельні воркери загублять одну з операцій (2.8).

   Якщо потрібен ще й **порядок** операцій по одному кастомеру (а не лише відсутність
   втрат), pg-boss v12 має для цього політику черги **`key_strict_fifo`**: унікальний індекс
   на `(name, singleton_key)` для станів `active/retry/failed` тримає **рівно один активний
   job на ключ**, решта чекають у FIFO-порядку (черга балансу → `singletonKey = customer:<id>`).
   Ціна, яку треба приймати свідомо: перманентно впалий job **блокує весь свій ключ**
   (для грошей це радше фіча; інспекція — `boss.getBlockedKeys()`). Атомарний `+=` лишається
   в силі як другий рубіж — політика черги не повинна бути єдиним, що рятує баланс.
3. **Баланс — кешована проєкція реєстру**, а не незалежна істина. Cron звіряє
   `sum(ledger_entries)` з `customers.balance` і алертить на розходження. Без звірки будь-який
   баг у підписнику непомітно псує гроші.

Компенсація (скасування платежу) — **окрема подія** `billing.payment-reversed.v1` зі
зворотною проводкою. Saga-двигун із rollback-ами не будуємо: у моделі append-only реєстру
компенсація і так є нормальною подією, а не інфраструктурним механізмом.

### 3.10. Email: at-least-once vs at-most-once — свідомий вибір по типу листа

Уже зафіксовано в CLAUDE.md для welcome-листа: `sendMail` перед `inbox.runOnce` → падіння
після успішної відправки дає повторний лист. Для інвойса це гірше (клієнт двічі бачить
«оплачено»).

| Порядок | Гарантія | Для чого |
| --- | --- | --- |
| `sendMail` → потім inbox | at-least-once (можливий дубль) | welcome, маркетинг |
| claim у БД → `sendMail` → mark sent | at-most-once (можлива втрата) | платіжні/юридичні |
| claim → `sendMail` з `Idempotency-Key` провайдера | ефективно exactly-once | коли провайдер уміє |

Для інвойсів — таблиця `sent_emails (eventId, template, recipient) UNIQUE` зі статусом
`claimed → sent` і cron-звіркою «завислих» claim-ів. Це не інфраструктурна фіча — це
**окремий підписник**, який так побудований.

### 3.11. Зовнішній сервіс — relay-підписник, не спільна черга

Provisioning поза монорепо не отримує доступу до `pgboss.*`. Замість цього — звичайний
підписник, що робить вихідний HTTP-виклик:

- ідемпотентність передається назовні заголовком `Idempotency-Key: <eventId>` —
  відповідальність за дедуплікацію переїжджає на приймача, як і має бути;
- ретраї — стандартні для черги, з backoff;
- вичерпані ретраї → DLQ, а не мовчазна втрата;
- таймаут обов'язковий і короткий; довгі операції на тому боці — асинхронні, з відповіддю
  назад через власний вебхук (який, своєю чергою, публікує подію в наш шар).

Спільна БД між сервісами — заборонена. Це не «оптимізація», це стирання межі сервісу.

### 3.12. Realtime — теж просто підписник

Крок «нотифікація в браузер» не потребує нічого нового в цьому документі: `/realtime`
підписник пише в `realtime.dispatch` Redis Stream із `docs/realtime.md`, одна репліка api
робить `emit`, adapter розносить. До реалізації RT-3 підписника просто немає в маніфесті.

Половина цього вже стоїть: Valkey, Socket.IO-adapter і `RealtimeEmitter` працюють із
2026-08-15 (RT-2), тому EDA-4 зводиться до двох речей — стріму `realtime.dispatch` із
читачем в `apps/api` і рядка `'realtime'` у списку споживачів `MESSAGE_TOPOLOGY`.
Воркеру для цього знадобиться `REDIS_URL` (у swarm-стеку його поки має лише `api`).

Важливо (уже написано в `realtime.md`, повторюю як правило): **pg-boss не є live-транспортом.**
Його polling/retry семантика — для робіт. Субсекундний fan-out у браузер — Socket.IO.

### 3.13. Activity Log і domain events — не змішувати

Спокуса «одна таблиця подій на все» дуже сильна. Не піддаватися:

| | Activity Log | Domain event |
| --- | --- | --- |
| Аудиторія | людина в UI | інший модуль/сервіс |
| Контракт | закритий enum, змінюється вільно | версіонований, публічний |
| Обсяг | кураторський (не все підряд) | усе, що комусь потрібне |
| Зберігання | назавжди, append-only таблиця | у черзі, ~7 днів |
| Рендер | i18next на фронті | не рендериться |

Правило: **факт записує той, хто ним володіє.** Первинну активність (`invoice.paid`) пише
той самий `withTenantTx` в API, що міняє інвойс. Активність про власний побічний ефект
(`email.sent`) пише підписник у своєму inbox-і. Автоматично генерувати активності з подій —
не робити: фід миттєво перетвориться на технічний лог.

### 3.14. Тестування ланцюга

Додати `InMemoryEventBus`, що виконує підписників **синхронно й у процесі**, і підмінювати
ним диспатчер в e2e (`overrideProvider` — механіка вже відпрацьована на `StorageService`).
Тоді тест виглядає як:

```text
POST /invoices/:id/pay
  → 200
  → ledger_entries: 1 рядок
  → customers.balance: змінився рівно на суму
  → sent_emails: 1 claim
  → повторний POST з тим самим eventId: жодних змін (ідемпотентність ланцюга)
```

Це і є та перевірка, якої сьогодні немає взагалі.

---

## 4. Наскрізний приклад: оплата інвойса

Продюсер (`apps/api`):

```ts
async pay(invoiceId: string, actor: JwtPayload): Promise<Invoice> {
  return this.tenantTx.withTenantTx(async (tx) => {
    const invoice = await tx.invoice.update({
      where: { id: invoiceId, status: 'UNPAID' },   // перехід статусу — атомарний
      data: { status: 'PAID', paidAt: new Date() },
    });

    await this.activities.record(tx, {
      type: 'invoice.paid',
      actor: { type: 'user', id: actor.sub, label: actor.email },
      payload: { invoice: { kind: 'invoice', id: invoice.id, label: invoice.number },
                 amount: invoice.total.toString(), currency: invoice.currency },
      links: [{ entityType: 'invoice', entityId: invoice.id, role: 'subject' },
              { entityType: 'customer', entityId: invoice.customerId, role: 'context' }],
    });

    await this.events.publish(tx, invoicePaidEvent, {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      amount: invoice.total.toString(),   // гроші — рядок, не float
      currency: invoice.currency,
      paidAt: invoice.paidAt.toISOString(),
    });

    return invoice;                        // ← COMMIT: статус, активність і 5 job-ів разом
  });
}
```

Що зафіксувалося в одному COMMIT: новий статус, запис у фід, і по одному job-у в п'ять
черг. Впала будь-яка частина — не сталося нічого. Впав процес одразу після COMMIT — job-и
вже в БД і будуть підхоплені воркером.

Визначення події й підписки:

```ts
// libs/shared/src/events/definitions/billing.events.ts
export const invoicePaidEvent = defineEvent('billing.invoice-paid.v1', z.object({
  invoiceId: z.uuid(),
  customerId: z.uuid(),
  amount: z.string(),          // Decimal як рядок — ніяких float у грошах
  currency: z.string().length(3),
  paidAt: z.iso.datetime(),
}));

// libs/shared/src/events/subscriptions.ts
'billing.invoice-paid.v1': ['accounting', 'customer-balance', 'invoice-email',
                            'provisioning', 'realtime'],
```

П'ять класів у `apps/worker/src/subscribers/billing/`, кожен — 20–40 рядків, кожен зі своїм
inbox-ключем, своєю чергою, своїм DLQ. Жоден не знає про інших.

Що видно в логах по одному `correlationId`: HTTP-запит → publish (5 job id) → 5 записів
`Job completed` із власними тривалостями → `billing.invoice-posted.v1` із
`causationId = eventId` початкової події → provisioning. Одна команда `grep`.

---

## 5. Що це змінює в наявному коді

Міграція `users.user-registered` — найкращий доказ, що шар прибирає сполучення:

| Було | Стало |
| --- | --- |
| `userRegisteredJob` (`defineTenantJob`) | `userRegisteredEvent` (`defineEvent`, `.v1`) |
| `welcomeEmailJob` (окрема команда) | зникає — стає підписником `/welcome-email` |
| `UserRegisteredHandler` (ручний fan-out) | **видаляється цілком** |
| `WelcomeEmailHandler` | `WelcomeEmailSubscriber`, inbox-ключ `eventId:welcome-email` |
| `email.sent` з `actor: system` | actor із конверта — реальний адмін |
| 2 черги, 2 хендлери, 1 проміжний хоп | 1 подія, 1 підписник, 0 хопів |

`files.generate-thumbnail`, `auth.cleanup-expired-tokens`, `files.cleanup-orphans`
**лишаються командами** (один споживач, без версії в імені), але переїжджають на **той самий
конвеєр** (§3.1.1): конверт, спільний runner, inbox, спільна `dlq`, рядок у `MESSAGE_TOPOLOGY`.
Зміни в їхніх хендлерах мінімальні — сигнатура `handle(data, envelope)` замість
`handle(payload, context)`. Сенс саме в тому, щоб у системі не лишилося другого шляху
виконання асинхронної роботи.

---

## 6. Фази

| Фаза | Обсяг | Цінність окремо |
| --- | --- | --- |
| ✅ **EDA-0** — гігієна наявного шару | спільна `dlq` на всіх чергах; `updateQueue` замість drift; `NonRetryableMessageError`; cron-чистка `processed_jobs`; `correlationId` у логах | Так — нічого не ламає, лагодить реальні дірки, корисно навіть без решти |
| ✅ **EDA-1** — єдиний конвеєр | `defineEvent`/`defineCommand`, конверт, `MESSAGE_TOPOLOGY`, `MessagePublisher.publish(tx, …)`, `@MessageSubscriber`, boot-assert маніфесту, `runOnce(envelope, consumerId)`, `MessageContext`; переведення **всіх** наявних job-ів (thumbnail, 2 cron) на той самий конвеєр + міграція `users.user-registered` | Так — `UserRegisteredHandler` зник, у системі лишився один шлях виконання асинхронної роботи |
| **EDA-2** — спостережуваність | DLQ-вкладка й replay у `/jobs`; фільтр за `correlationId`; лаг і глибина по черзі | Так — без цього EDA-1 працює наосліп |
| **EDA-3** — billing як еталон | `invoice.paid` з 5 підписниками, `ledger_entries` + звірка балансу, `sent_emails` claim-before-send, relay-підписник, ланцюг `invoice-posted` | Це вже доменний модуль 2.4 із roadmap |
| **EDA-4** — realtime-підписник | `/realtime` → `realtime.dispatch` | Разом із RT-3 |

**Місце в roadmap:** EDA-0 і EDA-1 зроблені — billing (2.4) тепер можна писати одразу на
цьому шарі. EDA-2 — наступний. EDA-3 = 2.4.3 (billing) на новому шарі. EDA-4 = частина RT-3.

### Прибирання після міграції (одноразово, вручну)

Старі черги лишилися в `pgboss.queue` осиротілими — у них ніхто не пише і ніхто не читає:
`users.user-registered`, `notifications.welcome-email`, `files.generate-thumbnail`,
`auth.cleanup-expired-tokens`, `files.cleanup-orphans`. Автоматично їх НЕ видаляємо: у черзі
могли лишитися job-и в польоті, а `deleteQueue` їх втратить. Порядок — переконатися, що
`SELECT count(*) FROM pgboss.job WHERE name = '<стара черга>' AND state < 'completed'` дає 0,
і аж потім `boss.deleteQueue(...)`.

---

## 7. Свідомо поза скоупом

| Що | Чому |
| --- | --- |
| Kafka / NATS / RabbitMQ | pg-boss + Postgres — зафіксоване рішення; транзакційність publish-у в тій самій БД цінніша за throughput, якого тут не буде |
| Event sourcing | Стан лишається в таблицях. Події — інтеграційний контракт, не джерело правди |
| Saga/process-manager двигун | Ланцюги подій + компенсаційні події покривають сценарій. Двигун знадобиться, коли з'явиться крок із таймаутом і зовнішнім підтвердженням |
| Schema registry | Маніфест підписок і Zod-схеми в монорепо дають ту саму гарантію, поки всі споживачі — свої |
| Реплей історичних подій новому підписнику | Fan-out відбувається на публікації (§3.3). Якщо знадобиться — архівна таблиця подій, дизайн не ламається |
| Пріоритети/справедливість між тенантами | Один tenant може забити чергу. Реальна проблема, але після того, як тенантів стане багато |

---

## 8. Первинні джерела

- `docs/event-driven-scenario.md` — вхідний сценарій оплати інвойса
- `docs/activity-log.md` — Activity Log (§3.13 — межа між ним і подіями)
- `docs/realtime.md` — Socket.IO, `realtime.dispatch`, Notification-модуль (§3.12)
- `docs/multi-tenancy-architecture.md` — CLS, RLS, tenant-scope джоб
- `libs/shared/src/jobs/` — наявний шар, який цей документ розширює
