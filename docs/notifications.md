# In-app сповіщення (Notification Center) — завдання на один хід

Персональний інбокс користувача: «що **я** маю знати». Дзвінок із лічильником у шапці,
панель зі списком, прочитано/непрочитано, архів, миттєва поява нового повідомлення у
відкритій вкладці. Текст, як і в Activity Log, **не зберігається** — бекенд пише
`type` + `payload` + референси на сутності, фронт рендерить через i18next і сам
перетворює референси на посилання.

Це **EDA-4** із [event-driven-architecture.md](event-driven-architecture.md) §3.12,
збудований поверх готового realtime ([realtime.md](realtime.md)): транспорт
(Socket.IO-гейтвей, Valkey, room-и `tenant:{id}:user:{id}`, ізоляція) уже працював — це
доменний модуль поверх нього, а не інфраструктура.

Статус: **реалізовано й перевірено 2026-08-16** (міграція `20260816102328_notifications`).
Скоуп V1 «інбокс» зафіксовано того ж дня; нагадування (заплановані сповіщення) свідомо
винесені в окремий наступний хід. Живий прогін: адмін створює юзера → бейдж і рядок
зʼявляються в іншого адміна без перезавантаження; welcome із **воркера** доїжджає новому
юзеру через headless-міст; прочитання в одній вкладці гасить бейдж в іншій; лист у Mailpit.
124 tenant-e2e (+21) і 11 platform-e2e зелені.

## Що змінилось проти дизайну під час реалізації

| Дизайн | Реалізація | Чому |
| --- | --- | --- |
| After-commit хук — CLS-скоуп на транзакцію | `WeakMap`, ключ — сам обʼєкт `tx` | Привʼязка стала явною: зареєструвати хук «не в ту» транзакцію неможливо навіть при вкладених викликах, і не потрібен активний CLS |
| `tenant_id` скрізь із DB-default | `notification_states` і `notification_preferences` отримують `tenantId` явно, з `TenantContextService` | PK композитний `(tenant_id, user_id[, type, channel])` — без нього не скласти `where` для upsert-у. Це легальний виняток: сервіси інфраструктурні, не доменні (той самий виняток, що в `PresenceController`). Сирий SQL для цих двох таблиць **пробували і відмовились**: Prisma-upsert компілюється в рівно той самий `INSERT … ON CONFLICT … DO UPDATE SET revision = revision + $n` (перевірено логом Postgres), тобто атомарність та сама, а типізації більше. Raw лишився лише там, де без нього не можна — колапс (нижче) |
| `newCount` рахується по `created_at > seen_at` | по `updated_at > seen_at` | Схлопнута група, у якій після останнього перегляду зʼявилась нова подія, — теж «нове»; з `created_at` вона мовчки не рахувалася б |
| Архівація — окремий стан | Архівація непрочитаного заразом ставить `read_at` | Інакше лічильник рахував би те, чого юзер уже не бачить у списку |
| Реєстр `kind → (id) => path` | `kind → route` без id | Сторінок окремих сутностей ще немає (ведемо на список). Тип значення — union реальних роутів, а не `string`: типізовані `<Link>` ловлять мертве посилання компіляцією |
| `<b>` для виділень у тексті | `<b>` для акценту, `<a>` — для сутності | Один тег на все зробив би посиланням і актора теж |
| Дефолт `defaultEnabled` читається як є | лукап анотований типом `NotificationTypeMeta` | Усі сьогоднішні типи мають `true`, і без анотації TS звужує поле до літерала, а лінтер оголошує гілку «вимкнено за замовчуванням» недосяжною |

## Межа: чим це НЕ є

Найбільший ризик модуля — його зроблять другим Activity Log. Різниця не в даних, а в
**адресаті і стані**.

| | Activity Log (є) | Notification (цей документ) | Toast (є) | Email (є) |
| --- | --- | --- | --- | --- |
| Питання | «що сталося **з сутністю**» | «що **я** маю знати» | «як пройшла **моя** дія» | «як дістати того, кого немає в застосунку» |
| Скоуп рядка | тенант + лінки на сутності | **конкретний отримувач** | нічого не зберігається | лист |
| Стан | немає (append-only) | **unread/read/archived** — це і є суть | — | — |
| Курація | усе, що варте фіда | лише те, що варте **перебивання уваги** | — | — |
| Рядків на подію | 1 | 0..N (по одному на отримувача) | 0 | 0..N |

Одна доменна зміна може породити **і активність, і N сповіщень** — це різні записи з
різними життєвими циклами. Автогенерація сповіщень з усіх активностей — та сама пастка,
що описана в §3.13 EDA («фід перетвориться на технічний лог»), тільки гірше: тут це спам,
після якого юзер вимикає дзвінок і фіча мертва.

## Зафіксовані рішення

| Питання | Рішення |
| --- | --- |
| Адресація на роль | **Матеріалізувати N рядків** при записі. Один шлях читання, простий лічильник, RLS і курсор без винятків. Ціна прийнята: зміна складу ролі після запису заднім числом не переграється |
| Хто вирішує «кому» | **Доменний модуль.** `users` сам знає, що створення юзера цікавить адмінів, і передає recorder-у готовий список `recipientIds`. Модуль notifications лишається тупим інбоксом і нічого не знає про домени. Розгортання ролі в список — експортований хелпер, який домен кличе **явно** (щоб рішення було видно в доменному коді, а SQL не дублювався) |
| Втрата доступу до сутності | **Снапшот лишається.** Фід не перевіряє права на target; `label` у payload — снапшот на момент події (та сама доктрина, що `actorLabel` в activities). Клік дасть 403/404 від сторінки сутності — це чесно: «вам про це повідомляли» |
| Розклад (нагадування) | **Окрема таблиця + cron**, окремим ходом. Тому `notifications` містить **тільки доставлені** рядки — без `status`, без `scheduledAt`. Майбутні `scheduled_notifications` матеріалізуються в `notifications` у момент настання |
| Канали | **Тільки in-app у V1.** Преференси все одно зберігаються як `(type, channel)` з `channel='in_app'` — додати email буде рядком, а не міграцією семантики |
| Platform → tenant broadcast | **Поза скопом.** `recipient_id NOT NULL`, доктрина «текст не зберігаємо» без винятків. Це інший plane (`platform-api` не підключений до гейтвею), інший життєвий цикл, інший UI |
| Дії в рядку | **Тільки перехід на сторінку** + інбокс-дії (read/unread/archive). Поля `actions[]` не заводимо взагалі: додати легко, прибрати з контракту — ні. Доменні дії живуть на сторінці сутності, де є контекст і валідація |
| Текст | Не зберігається: `type` (закритий enum) + `payload`. Рендер, переклад, формат дат — на фронті (i18n-доктрина) |
| Мутабельність | На відміну від activities — **рядок мутабельний**: `read_at`, `archived_at`, колапс. Це стан інбокса, а не журнал |
| Джерело правди | Postgres. Socket-подія — прискорення, а не доставка (правило з `realtime.md`) |
| Ревізії | Лічильник **на отримувача** в Postgres (не в Valkey, як presence): інбокс переживає рестарт брокера, presence — ні |

## Компоненти

```
┌──────────────────────────  API (apps/api)  ─────────────────────────────────┐
│  UsersService.create ── withTenantTx ─┬─ user.create                        │
│                                       ├─ activities.record(tx, …)           │
│                                       ├─ notifications.notify(tx, …)  ──┐   │
│                                       └─ publisher.publish(tx, …)       │   │
│                                            після коміту: onCommit ──────┼─▶ │
│  NotificationsController: GET /notifications, /summary, PATCH /:id,     │   │
│                           POST /mark-all-read, /seen, GET|PUT /prefs    │   │
│  RealtimeEmitter.notificationCreated → room tenant:{t}:user:{u}         │   │
└─────────────────────────────────────────────────────────────┬───────────┼───┘
                                                              │           │
┌────────────────────  WORKER (apps/worker)  ────────┐        │           ▼
│  WelcomeEmailSubscriber:                           │        │    ┌────────────┐
│    sendMail → inbox.runOnce → notify(tx, …)        │───────────▶ │  Postgres  │
│  WorkerRealtimeEmitter (headless Socket.IO Server  │        │    │notifications│
│    з тим самим Valkey-адаптером) ──────────────────┼──┐     │    │notification_│
└────────────────────────────────────────────────────┘  │     │    │  states     │
                                                        ▼     ▼    │  _prefs     │
┌──────────────────────  WEB (apps/web)  ──────┐   ┌──────────┐    └────────────┘
│  NotificationBell (badge) → NotificationPanel│◀──│  Valkey  │
│  socket патчить кеш TanStack Query           │   │ (adapter)│
│  <NotificationMessage> = <Trans> + <Link>    │   └──────────┘
└──────────────────────────────────────────────┘
```

Код по шарах:

- `libs/contracts/src/notification/` — типи, payload-схеми, реєстр метаданих, query/response;
- `libs/contracts/src/realtime/` — доповнюється socket-подіями інбокса **і переїздом
  `tenantRoom`/`userRoom`** (назви room — протокол, а не конфіг api: тепер їх формує і воркер);
- `libs/database/prisma/` — `Notification`, `NotificationState`, `NotificationPreference` + міграція;
- `libs/database/src/tenant/` — `withTenantTx` отримує after-commit хук (див. «Коли емітити»);
- `libs/shared/src/notifications/` — `NotificationRecorder` + `NotificationsModule` (@Global);
- `apps/api/src/notifications/` — DTO → Service → Mapper → Controller;
- `apps/api/src/realtime/realtime.emitter.ts` — дві нові емісії;
- `apps/worker/src/realtime/` — headless-емітер + `REDIS_URL` у конфігу воркера;
- `apps/web/src/components/notifications/` + `apps/web/src/lib/entity-routes.ts` +
  namespace `notifications` у `libs/i18n`.

## Модель даних

```prisma
/// Персональний інбокс (docs/notifications.md). На відміну від Activity — рядок
/// МУТАБЕЛЬНИЙ: read_at/archived_at/колапс. Текст не зберігається: type + payload.
model Notification {
  id          String   @id @default(uuid())
  tenantId    String   @default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)")) @map("tenant_id")
  /// Кому. NOT NULL завжди: broadcast без отримувача — поза скопом (див. рішення)
  recipientId String   @map("recipient_id")
  /// Закритий enum у контрактах (NOTIFICATION_TYPES); у БД — рядок
  type        String
  /// Параметри рендеру: снапшот-label-и + {kind,id}-референси (схема — по типу)
  payload     Json
  /// Одна канонічна ціль кліку. Nullable: буває сповіщення без переходу (welcome)
  targetKind  String?  @map("target_kind")
  targetId    String?  @map("target_id")
  /// Ключ колапсу: N однотипних подій схлопуються в один НЕПРОЧИТАНИЙ рядок
  groupKey    String?  @map("group_key")
  groupCount  Int      @default(1) @map("group_count")
  /// Актор — та сама форма, що в activities (снапшот, без FK)
  actorType   String   @map("actor_type")
  actorId     String?  @map("actor_id")
  actorLabel  String?  @map("actor_label")
  createdAt   DateTime @default(now()) @map("created_at")
  /// Час ОСТАННЬОЇ появи: колапс піднімає рядок у фіді (сортування по updatedAt)
  updatedAt   DateTime @updatedAt @map("updated_at")
  readAt      DateTime? @map("read_at")
  archivedAt  DateTime? @map("archived_at")

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  /// Композитний FK: сповіщення не може вказати на юзера чужого тенанта.
  /// Cascade: видалили юзера — інбокс іде з ним (це його особисті дані, не журнал)
  recipient User   @relation("NotificationRecipient", fields: [tenantId, recipientId], references: [tenantId, id], onDelete: Cascade)

  /// Головний запит: інбокс юзера, сортування updatedAt DESC + tie-breaker
  @@index([tenantId, recipientId, updatedAt(sort: Desc), id])
  @@map("notifications")
}

/// Стан інбокса юзера: коли востаннє відкривав панель + лічильник ревізій для
/// realtime. Один рядок на юзера, upsert при першій зміні.
model NotificationState {
  tenantId  String   @map("tenant_id")
  userId    String   @map("user_id")
  /// Момент останнього відкриття панелі — від нього рахується «нове» для badge
  seenAt    DateTime? @map("seen_at")
  /// Монотонний лічильник змін інбокса. Дає клієнту детект пропущеної події
  revision  Int      @default(0)
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation("NotificationState", fields: [tenantId, userId], references: [tenantId, id], onDelete: Cascade)

  @@id([tenantId, userId])
  @@map("notification_states")
}

/// Преференси: рядок існує ТІЛЬКИ для явного вибору юзера; дефолт живе в коді
/// (NOTIFICATION_TYPE_META) — новий тип не потребує міграції преференсів.
model NotificationPreference {
  tenantId String  @map("tenant_id")
  userId   String  @map("user_id")
  type     String
  /// 'in_app' у V1; email/push додаються рядком, не міграцією семантики
  channel  String
  enabled  Boolean

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation("NotificationPreference", fields: [tenantId, userId], references: [tenantId, id], onDelete: Cascade)

  @@id([tenantId, userId, type, channel])
  @@map("notification_preferences")
}
```

`Tenant` і `User` отримують зворотні relations. Міграція — таблиці + стандартний RLS-блок
(ENABLE + FORCE + політика `tenant_isolation` за шаблоном `20260716140000_enable_rls`;
авточек `pg_policies` у `rls.e2e-spec` підхопить усі три таблиці сам) **плюс два часткові
індекси, яких Prisma не вміє**:

```sql
-- Лічильник непрочитаних: гарячий запит, читається на кожну зміну інбокса
CREATE INDEX "notifications_unread_idx"
  ON "notifications" ("tenant_id", "recipient_id")
  WHERE "read_at" IS NULL AND "archived_at" IS NULL;

-- Колапс: НЕ БІЛЬШЕ ОДНОГО непрочитаного рядка на (отримувач, groupKey).
-- Часткова унікальність дає рівно потрібну семантику: доки юзер не прочитав —
-- нові однотипні події доливаються в той самий рядок; прочитав — наступна
-- починає нову групу. Заразом робить колапс race-safe (ON CONFLICT), а не
-- «SELECT, потім UPDATE» з гонкою між двома паралельними запитами.
CREATE UNIQUE INDEX "notifications_group_unread_uq"
  ON "notifications" ("tenant_id", "recipient_id", "group_key")
  WHERE "group_key" IS NOT NULL AND "read_at" IS NULL AND "archived_at" IS NULL;
```

**Чому сортування по `updatedAt`, а не `createdAt`.** Колапс мусить піднімати групу
нагору — інакше «3 нові коментарі» лишаються там, де було перше повідомлення тижневої
давнини. Ціна: рядок, який оновився під час гортання, перестрибує вище курсора, і на
наступній сторінці його не буде. Це прийнятно рівно тому, що той самий рядок у ту саму
мить приїжджає клієнту socket-подією і вставляється зверху — тобто аномалія
компенсується, а не ігнорується.

## Типи і реєстр (`libs/contracts/src/notification/`)

> Оновлено 2026-09-07: додано категорію **`calendar`** і пʼять її типів
> (`calendar_event.invited` / `.rescheduled` / `.cancelled` / `.rsvp_changed` / `.reminder`).
> Категорія своя, а не рядок в `organization`: це заголовок групи на екрані преференсів, і
> «нагадування про зустріч» поруч зі «створено юзера» — неправильна ментальна модель.
> `calendar_event.cancelled` — НЕмутабельний тип (як `user.password_changed`): скасування
> мусить дійти навіть до того, хто вимкнув усе інше. Деталі — `docs/calendar.md` §9.2.

```ts
export const NOTIFICATION_TYPES = [
  'user.created',           // адмінам: у тенанті з'явився юзер
  'user.password_changed',  // ЙОМУ: адмін змінив твій пароль (security, не вимикається)
  'user.welcome',           // новому юзеру, пишеться воркером після welcome-листа
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** Форма payload-у по типу: recorder валідує на записі (fail fast), фронт знає форму */
export const NOTIFICATION_PAYLOAD_SCHEMAS = {
  'user.created': z.object({ user: EntityRefSchema }),      // EntityRef — з activity/
  'user.password_changed': z.object({}),                    // текст самодостатній
  'user.welcome': z.object({ tenant: z.string() }),         // назва воркспейсу
} as const satisfies Record<NotificationType, z.ZodType>;

/**
 * Метадані типу — єдине місце, де описано поведінку. Дефолт у КОДІ, не в БД:
 * новий тип не потребує бекфілу преференсів для наявних юзерів.
 */
export const NOTIFICATION_TYPE_META = {
  'user.created':          { category: 'workspace', defaultEnabled: true, muteable: true },
  // muteable: false — сповіщення безпеки не вимикається жодними налаштуваннями.
  // Це не «забули дати вимикач», це вимога: юзер мусить дізнатись про зміну пароля
  'user.password_changed': { category: 'security',  defaultEnabled: true, muteable: false },
  'user.welcome':          { category: 'workspace', defaultEnabled: true, muteable: true },
} as const satisfies Record<NotificationType, NotificationTypeMeta>;

export const NOTIFICATION_CHANNELS = ['in_app'] as const; // email/push — окремі ходи
```

Query і відповіді (курсорні схеми з `pagination/` уже є — використовуємо їх як є):

```ts
export const NotificationFilterSchema = z.enum(['unread', 'all', 'archived']);

export const NotificationQuerySchema = CursorQuerySchema.extend({
  filter: NotificationFilterSchema.default('all'),
});

export const NotificationResponseSchema = z.object({
  id: z.uuid(),
  type: NotificationTypeSchema, // фронт усе одно має generic-fallback
  payload: z.record(z.string(), z.unknown()),
  target: z.object({ kind: z.string(), id: z.uuid() }).nullable(),
  groupCount: z.number().int().min(1),
  actorType: z.enum(['user', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export const NotificationListResponseSchema = cursorResponseSchema(NotificationResponseSchema);

/** Snapshot для badge — той самий патерн, що PresenceSnapshot */
export const NotificationSummarySchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  /** непрочитані, що з'явилися ПІСЛЯ seenAt — саме це число на бейджі */
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});
```

**Два числа замість одного — свідомо.** `unreadCount` росте, поки юзер не розбере інбокс;
якщо бейдж показує його, за тиждень там «47» і він перестає щось означати. Бейдж показує
`newCount` — з'явилося з моменту, коли ти востаннє відкривав панель. Відкрив (навіть нічого
не прочитавши) — бейдж згас, жирні рядки лишились.

## Стани одного повідомлення

```
          notify()              PATCH read:true          PATCH archived:true
   ──────────────▶ unread ────────────────────▶ read ──────────────────────▶ archived
                     ▲                            │                              │
                     └──────── PATCH read:false ──┘◀───── PATCH archived:false ──┘
```

- `unread → read` — клік по рядку (перехід) або явна дія;
- **`read → unread`** обов'язково: люди використовують інбокс як todo-лист;
- `archived` — прибрати з очей, лишивши в історії (фільтр `archived`);
- `seenAt` — не стан рядка, а мітка юзера: гасить бейдж, не чіпаючи `read_at`;
- видалення назавжди у V1 немає — прибирає retention-cron (беклог).

## Колапс і антиспам

Три механізми, які мусять бути з першого дня — бо схлопувати заднім числом неможливо:

1. **`groupKey`.** Домен передає ключ, під яким однотипні події зливаються: третє
   створення юзера підряд не додає рядок, а робить `group_count = 3` і піднімає
   `updated_at`. Рендер бере плюрал i18next (`user.created_one` / `user.created_other`).
   Реалізація — `INSERT ... ON CONFLICT` по частковому унікальному індексу вище.
2. **«Не сповіщати про власні дії».** Фільтр у recorder-і: `recipientId === actor.id` →
   рядок не створюється. Очевидно, і забувається завжди.
3. **Преференси.** Recorder відсіює отримувачів, які вимкнули тип; `muteable: false`
   ігнорує преференс за визначенням.

Пункти 2 і 3 живуть **у recorder-і, а не в доменному модулі**, хоча рішення «кому» —
доменне. Це не суперечність: «чи цікавить адмінів створення юзера» — знання домену,
«чи не сповіщаємо людину про її ж дію» і «чи не вимкнув він цей тип» — властивості
інбокса. Продублювати їх у кожному домені = гарантовано десь забути.

Тротлінг, digest і вікна агрегації — **не в V1** (потрібні реальні високочастотні типи,
яких поки немає; проєктувати наосліп нічого).

## `NotificationRecorder` (`libs/shared/src/notifications/`)

Дзеркало `ActivityRecorder` — та сама конвенція «tx перший обов'язковий аргумент».

```ts
export interface NotifyInput {
  type: NotificationType;
  /** Хто отримає. Список рахує ДОМЕН (див. рішення); порожній — легальний no-op */
  recipientIds: string[];
  /** Та сама форма, що ActivityActor — актор доїжджає і в чергу, і сюди */
  actor: ActivityActor;
  payload: Record<string, unknown>;
  target?: { kind: string; id: string };
  /** Ключ колапсу в межах отримувача; без нього кожна подія — окремий рядок */
  groupKey?: string;
}

@Injectable()
export class NotificationRecorder {
  /**
   * tx — ПЕРШИЙ обов'язковий аргумент: сповіщення пишеться в ту саму транзакцію,
   * що й доменна зміна. Інбокс не може стверджувати те, чого не сталося.
   * tenant_id не передається — DB-default із CLS, як усюди.
   *
   * Емісія в socket НЕ тут: вона реєструється хуком after-commit (нижче).
   */
  async notify(tx: Prisma.TransactionClient, input: NotifyInput): Promise<void>;
}

/**
 * Розгортання ролі в список. Експортований хелпер, який домен кличе ЯВНО —
 * щоб рішення «сповіщаємо адмінів» лишалось видимим у доменному коді, а SQL
 * не копіювався по модулях.
 */
export async function recipientsByRole(tx, role: Role, exclude?: string[]): Promise<string[]>;
```

Що робить `notify` всередині, по кроках:

1. `NOTIFICATION_PAYLOAD_SCHEMAS[type].parse(payload)` — fail fast, невалідний payload це
   баг викликача;
2. викидає з `recipientIds` актора (правило «не собі») і дублікати;
3. читає преференси решти одним запитом; лишає тих, у кого тип увімкнений (або
   `muteable: false`);
4. на кожного, хто лишився: `INSERT ... ON CONFLICT (tenant_id, recipient_id, group_key)
   WHERE …` — новий рядок або `group_count + 1` з підняттям `updated_at` і оновленням
   payload на свіжий;
5. `notification_states`: upsert із `revision = revision + 1`;
6. реєструє after-commit емісію на кожного отримувача.

## Коли емітити: after-commit хук

Емісія **не може** бути всередині транзакції: клієнт отримає подію, піде за списком і
не побачить рядка, який ще не закомічений. І не може йти через pg-boss: його polling — це
секунди, а власна доктрина (`realtime.md`) прямо забороняє вважати чергу live-транспортом.

Тому `TenantTransactions.withTenantTx` отримує чергу колбеків, що виконуються **після
успішного коміту**:

```ts
async withTenantTx<T>(fn: (tx) => Promise<T>): Promise<T> {
  const hooks: (() => void)[] = [];
  const result = await this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return this.afterCommit.runWith(hooks, () => fn(tx)); // CLS-скоуп на транзакцію
  });
  for (const hook of hooks) {
    try { hook(); } catch (e) { this.logger.warn(...); } // емісія не валить бізнес-операцію
  }
  return result;
}
```

Recorder кладе туди `() => emitter.notificationCreated(...)`. Виграш: **забути емісію
неможливо** — вона реєструється в тому ж місці, де пишеться рядок. Розглянутий і
відхилений варіант: recorder повертає створені рядки, а сервіс емітить сам після
`withTenantTx` — два кроки, які легко роз'їдуться (домен додасть сповіщення і забуде
другий рядок; тест цього не спіймає, бо REST працює).

`unreadCount`/`revision` для payload-у події читаються **в хуку**, тобто вже після коміту —
один індексований `COUNT` на отримувача (частковий індекс вище). Для fan-out-у на десятки
адмінів це десятки дешевих запитів; якщо колись стане вузьким місцем — один `GROUP BY`
замість циклу, контракт не міняється.

## Realtime-протокол

Доповнення до `libs/contracts/src/realtime/` — той самий файл, та сама доктрина версій
в імені події. Емісія — в **особистий room** `tenant:{tenantId}:user:{userId}`, який
гейтвей уже заводить на кожному сокеті.

```ts
export const REALTIME_EVENTS = {
  // …наявні presence/auth…
  notificationCreated: 'notification.created.v1',
  notificationChanged: 'notification.changed.v1',
} as const;

/** Нове сповіщення. Везе ПОВНИЙ рядок — див. «чому не тільки id» нижче */
export const NotificationCreatedSchema = z.object({
  notification: NotificationResponseSchema,
  unreadCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});

/** Зміна стану — прилітає в УСІ вкладки й на всі пристрої юзера, включно з тим,
 *  де дію зробили: прочитав на ноуті → бейдж згас на телефоні */
export const NotificationChangedSchema = z.object({
  change: z.enum(['read', 'unread', 'archived', 'seen']),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ids'), ids: z.array(z.uuid()).min(1) }),
    z.object({ kind: z.literal('all') }), // mark-all-read: список id був би на сотні рядків
  ]),
  unreadCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});
```

**Правило трьох ревізій — один в один із presence** (`realtime-internals.md`):

| Умова | Дія клієнта |
| --- | --- |
| `revision <= current` | ігнорувати (дубль або переставлена подія) |
| `revision === current + 1` | застосувати дельту до кешу |
| `revision > current + 1` | інвалідувати `GET /notifications/summary` і перший екран списку |

Різниця з presence лише в джерелі лічильника: там він у Valkey (стан ефемерний), тут — у
Postgres (`notification_states.revision`), бо інбокс мусить переживати рестарт брокера.

**Чому подія везе повний рядок, а не тільки id.** §3.12 EDA передбачала «подія несе
ідентифікатор, вміст клієнт бере в REST». Уточнюємо: доктрина вимагає, щоб **жоден стан
не жив тільки в сокеті** — і вона дотримана, бо джерелом правди лишається REST, а
`revision` дає resync при будь-якій втраті. Але робити HTTP-запит на кожен рядок,
який сервер уже тримає в руках, — зайвий roundtrip і мигання порожнього рядка в панелі.
Payload — прискорення, не доставка.

## Міст із воркера

Частина сповіщень народжується у **воркері** (welcome, а далі всі нагадування — тобто
більшість майбутніх). Воркер до Socket.IO не підключений, і це єдина інфраструктурна
робота в цьому ході.

`docs/event-driven-architecture.md` §3.12 накидав план: воркер пише в Redis Stream
`realtime.dispatch`, окремий читач в `apps/api` робить `emit`. Цей план **переглянуто
2026-08-16** (він ніде не був реалізований — нотатка, а не зафіксоване рішення):

| Варіант | Оцінка |
| --- | --- |
| **Headless Socket.IO Server у воркері** ⭐ | `new Server({ adapter: createAdapter(valkey) })` **без** `listen()`. Емісія в room іде через той самий адаптер, що й між репліками api, і доїжджає до клієнтів. ~30 рядків, нуль нового протоколу, нуль нових режимів відмови. Ціна: `socket.io` як залежність воркера і зайвий читач стріму адаптера (клієнтів у нього нуль) |
| Власний стрім `realtime.dispatch` | Це переписування транспорту, який уже є: свій формат кадру, своя consumer-group, свій ack/claim, свій моніторинг, свій набір багів. Виправдано було б, якби воркер не мав доступу до Valkey — але він його матиме однаково |

Рішення: **headless-емітер**, `realtime.dispatch` не заводити. Наслідки для інфри
однакові в обох варіантах: воркеру потрібен `REDIS_URL` (у compose і в swarm-стеку його
поки має тільки `api`), і константи room-ів переїжджають у `libs/contracts/src/realtime/`,
бо тепер їх формують два процеси.

## REST API

| Метод | Шлях | operationId | Призначення |
| --- | --- | --- | --- |
| GET | `/api/notifications?filter=&cursor=&limit=` | `notificationsFindAll` | Курсорний список (keyset по `updatedAt, id`) |
| GET | `/api/notifications/summary` | `notificationsGetSummary` | Snapshot бейджа: `unreadCount`, `newCount`, `revision` |
| PATCH | `/api/notifications/:id` | `notificationsUpdate` | `{ read?: boolean, archived?: boolean }` — стан одного рядка |
| POST | `/api/notifications/mark-all-read` | `notificationsMarkAllRead` | Масово; повертає `summary` |
| POST | `/api/notifications/seen` | `notificationsMarkSeen` | Панель відкрито → гасимо бейдж |
| GET | `/api/notifications/preferences` | `notificationsGetPreferences` | Ефективні преференси = дефолти з коду ⊕ рядки БД |
| PUT | `/api/notifications/preferences` | `notificationsSetPreferences` | Upsert списку `{type, channel, enabled}` |

Усі — **тільки свій інбокс**: `recipientId` завжди береться з `@CurrentUser()`, ніколи з
запиту. Параметра «чужий інбокс» не існує в контракті взагалі (RLS ізолює тенанти, але не
юзерів усередині тенанта — тут це відповідальність сервісу, і вона мусить бути в одному
місці).

`PATCH /:id` неіснуючого або чужого рядка → 404 через `P2025` (наявна нормалізація в
`AllExceptionsFilter`), не 403 — існування чужого рядка не підтверджуємо.

## Приклад 1 — синхронно: створення юзера

`UsersService.create` уже живе у `withTenantTx` і вже пише активність — додається один виклик:

```ts
const admins = await recipientsByRole(tx, Role.ADMIN, [actor.sub]);
await this.notifications.notify(tx, {
  type: 'user.created',
  recipientIds: admins,
  actor: { type: 'user', id: actor.sub, label: actor.email },
  payload: { user: { kind: 'user', id: user.id, label: user.name ?? user.email } },
  target: { kind: 'user', id: user.id },
  // Колапс: адмін, який масово заводить команду, отримає ОДИН рядок «створено 5 юзерів»
  groupKey: 'user.created',
});
```

Що станеться: рядок у `notifications` кожному адміну (крім автора), `revision + 1` у
кожного, після коміту — `notification.created.v1` в їхні особисті room-и. Ті, хто онлайн,
бачать появу без перезавантаження; хто офлайн — побачить при наступному вході.

## Приклад 2 — асинхронно: welcome з воркера

`WelcomeEmailSubscriber` уже шле лист і пише активність `email.sent` через
`inbox.runOnce`. У ту саму транзакцію додається сповіщення:

```ts
await this.inbox.runOnce(envelope, 'welcome-email', async (tx) => {
  await this.activities.record(tx, { /* email.sent, як зараз */ });
  await this.notifications.notify(tx, {
    type: 'user.welcome',
    recipientIds: [data.userId],
    actor: { type: 'system' },
    payload: { tenant: tenantName },
  });
});
```

Гарантія успадковується від inbox-у: **exactly-once відносно повідомлення**, тобто ретрай
job-а не продублює рядок в інбоксі (на відміну від самого листа, який at-least-once).
Емісія йде через headless-емітер воркера в той самий room.

## Фронтенд

- **`NotificationBell`** у `app-layout` — іконка + бейдж `newCount` (нуль → бейджа немає).
  Дані: `useNotificationsGetSummary` (той самий патерн, що presence snapshot);
- **`NotificationPanel`** — `Sheet` праворуч (той самий примітив, що `ActivityDrawer`,
  тому поведінка і стилі вже відомі). Три фільтри (Unread / All / Archived) через
  `ToggleGroup`, «Load more» з накопиченням у стані — як в `ActivityDrawer`; на
  відкриття шле `POST /seen`;
- **`NotificationCard`** — **один елемент на два хости**: те, що спливло тостом збоку,
  лежить у центрі тим самим бабликом (як у macOS). Дві верстки для одного повідомлення
  розійшлися б при першій же зміні, тому картка одна, а різняться лише обгортки:
  `NotificationItem` (рядок списку) і `NotificationToastItem` (тост). Керування в обох
  зʼявляється на hover/focus: **круглий × у ЛІВОМУ верхньому куті** із заходом на край
  картки (як у macOS) і **⋯** (меню: прочитано/непрочитано, архів) у правому. Обидві
  кнопки перемикаються `hidden`/`flex`, а не прозорістю: з `opacity-0` невидима кнопка
  лишалась би клікабельною. Перша версія малювала їх приглушеним сірим 24×20 без фону —
  формально видимі (`opacity: 1`), а на темній картці не помітні; тому кружечок має
  власний фон, рамку й тінь. Семантика × різна і це навмисно: у тості — просто сховати (стан не змінюється,
  рядок лишається непрочитаним у центрі), у центрі — **архівувати** (закриття мусить
  лишити слід, інакше картка повернулась би при наступному відкритті панелі).
  `role="button"` картка отримує **тільки** в тості: у центрі всередині тексту живе
  посилання на сутність, а лінк усередині `role="button"` — невалідна ARIA; там
  клавіатурний шлях дає сам лінк, а в тості (де лінків немає) роль обовʼязкова, бо інакше
  з клавіатури центр із тоста не відкрити.
- **Спливне сповіщення (тост) у стилі macOS** — `realtime/notification-toast.ts` +
  `NotificationToastItem`. Приїжджає збоку на **живу** socket-подію, показує ТІЛЬКИ щойно
  отримане, зникає за 6 с, по кліку відкриває центр. Оформлення дає **власна композиція
  `Toast`** (не стокова обгортка) — фон, рамку й тінь малює сама картка, інакше вийшов би
  баблик у баблику. Решта рішень:
  - **окрема черга** (`new ToastQueue({ maxVisibleToasts: 1 })`) і окремий
    `<Toast.Provider>`. Спільна з тостами помилок витісняла б їх — а в них різна
    семантика: сповіщення це «сталася подія» (**зверху справа, під дзвінком** — звідти ж
    росте лічильник, тож око йде за тостом до інбокса; зміщено вниз на висоту хедера
    `h-14`, щоб не накривати шапку), помилка це «твоя дія не пройшла» (**знизу справа**).
    Перевірено вимірюванням у браузері: тост сповіщення `top=72px` при
    `headerBottom=56px`, правий край 1264 при ширині вʼюпорта 1280; тост помилки — 16px
    від нижнього і правого краю;
  - попередній тост **закривається явно** (`queue.close(lastKey)`): `maxVisibleToasts: 1`
    лише ховає зайві, і вони виринали б по черзі, хоча вже неактуальні;
  - тост НЕ показується, коли панель відкрита — юзер уже дивиться в інбокс;
  - показується тільки на `notification.created.v1`, ніколи після resync чи на
    завантаженні сторінки: інакше на кожному reconnect вивалювалося б старе;
  - текст рендерить **той самий** `NotificationMessage` (проп `plain`, без лінків: увесь
    тост — одна ціль кліку), тому текст сповіщення не живе у двох місцях;
  - стан панелі переїхав у Zustand-стор `notification-ui.store.ts`: його читає і пише код
    поза React-деревом (socket-підписка вирішує, чи показувати тост, і сама відкриває
    панель по кліку);
- **`NotificationItem`** — непрочитані візуально виділені; клік = `read: true` + перехід
  за `target`. **Панель закривається тільки якщо клік справді кудись веде**: коли цільова
  сторінка вже відкрита, закриття читалося б як «центр згорнувся сам собою» — юзер
  натиснув, нічого не змінилось, а список зник. Порівнюється з поточним `pathname`;
- **`NotificationMessage`** — `<Trans>` по ключу `notifications:${type}` з payload-ом;
  невідомий тип → generic-ключ (фронт старіший за бекенд не падає), як у `ActivityMessage`;
- **`entity-routes.ts`** — реєстр `kind → (id) => path` в **одному** місці:

  ```ts
  const ENTITY_ROUTES: Record<string, (id: string) => string> = {
    user: (id) => `/users?highlight=${id}`, // сторінок сутностей ще немає — поки список
  };
  // невідомий kind → рендеримо label без <Link>, нічого не ламається
  ```

  Саме він робить те, що вимагалось: фронт зі знання про сутність будує посилання і
  вкладає його в текст повідомлення, а бекенд про роути не знає нічого;
- **socket-підписка** — у наявному singleton-клієнті: `notification.created.v1` вставляє
  рядок у кеш першої сторінки і оновлює summary, `notification.changed.v1` патчить; обидва
  проходять перевірку ревізії, розрив → `invalidateQueries`;
- **налаштування** — секція в тій самій панелі: список типів із перемикачами
  (`muteable: false` — рядок без перемикача з підписом «завжди») на штатному `Switch`
  із `libs/ui`;
- **i18n** — namespace `notifications` у `libs/i18n` (фронтовий). Не плутати з
  `apps/worker/src/locales/en/notifications.json` — то контент листів, інший процес,
  спільного між ними немає.

```json
{
  "user": {
    "created_one": "<b>{{actor}}</b> added user <b>{{user}}</b>",
    "created_other": "<b>{{actor}}</b> added {{count}} users",
    "password_changed": "<b>{{actor}}</b> changed your password",
    "welcome": "Welcome to <b>{{tenant}}</b>"
  },
  "unknown": "You have a new notification"
}
```

## Тести (e2e, `apps/api/test/notifications.e2e-spec.ts`)

- `POST /users` → рядок кожному адміну, **крім автора**; отримувач бачить його в
  `GET /notifications`, автор — ні;
- колапс: три створення підряд → у адміна ОДИН рядок із `groupCount: 3`; після
  `PATCH read:true` четверте створює новий рядок (перевіряє саме частковий унікальний індекс);
- `summary`: `newCount` після `POST /seen` = 0 при незмінному `unreadCount`;
- стани: read → unread → archived, фільтри віддають правильні набори;
- чужий рядок: `PATCH` по id сповіщення іншого юзера того ж тенанта → 404 (не 403);
- ізоляція тенантів: сповіщення A не видно з контексту B (прямі перевірки — через
  `SystemPrismaService`, як в решті сьютів);
- преференси: вимкнений тип не створює рядка; `muteable: false` створює **попри** спробу
  вимкнути;
- ревізії: `revision` зростає рівно на 1 на кожну зміну; подія з `revision + 2` (симуляція
  пропуску) веде клієнтський редьюсер у resync — юніт на редьюсер, не e2e;
- realtime (у наявному `realtime.e2e-spec` — там уже є жива Valkey): дві вкладки одного
  юзера отримують `notification.created.v1`, вкладка іншого юзера того ж тенанта — ні;
- RLS-авточек `pg_policies` підхопить три нові таблиці без змін у тесті.

## Обсяг одного ходу (порядок імплементації)

1. **Контракти**: `libs/contracts/src/notification/` (типи, payload-схеми, реєстр
   метаданих, query/response/summary) + socket-схеми і переїзд room-констант у
   `realtime/`; експорт з index (tenant-plane).
2. **БД**: три моделі + міграція (таблиці, RLS-блок, **два часткові індекси сирим SQL**) →
   `db:generate`.
3. **After-commit хук** у `TenantTransactions` + юніт на нього (колбек не викликається при
   rollback; падіння колбека не валить транзакцію).
4. **Recorder**: `libs/shared/src/notifications/` (`NotificationRecorder`,
   `recipientsByRole`, `NotificationsModule` @Global) → в AppModule api і worker.
5. **API**: `apps/api/src/notifications/` — DTO → Service (keyset, summary, стани,
   преференси) → Mapper → Controller; `RealtimeEmitter` += дві емісії.
6. **Воркер**: headless-емітер + `REDIS_URL` (`.env.example`, compose, swarm-стек,
   CI-сервіс уже є).
7. **Інтеграція**: `UsersService.create` (адмінам), `setPassword` (юзеру),
   `WelcomeEmailSubscriber` (welcome).
8. **Конвеєр**: `openapi:generate` → `web:codegen` (обидва артефакти комітяться).
9. **Web**: bell, panel, item, message, `entity-routes`, socket-підписка, налаштування;
   namespace `notifications` у `libs/i18n`.
10. **Тести** (список вище) + **доки**: шапка `CLAUDE.md`, статус тут, `roadmap.md` §2.1,
    `realtime.md` § «Що лишилось» і §3.12 EDA (рішення по мосту).

Definition of Done — **виконано 2026-08-16**: `pnpm lint && pnpm typecheck && pnpm build`
зелені; `api:test:e2e` 124/124, `platform:test:e2e` 11/11; живий прогін проти запущених
api + worker + web підтвердив усі пункти:

| Перевірка | Результат |
| --- | --- |
| api → socket: `user.created` доїхав другому адміну | ✔ `unread=1`, бейдж без перезавантаження |
| **worker → socket**: `user.welcome` доїхав новому юзеру (headless-міст) | ✔ подія з ІНШОГО процесу через Valkey-адаптер |
| `read` в одній вкладці → дельта в іншу | ✔ `notification.changed.v1`, `unread=0` |
| REST `summary.revision` == revision із socket-події | ✔ доказ, що емісія справді after-commit |
| welcome-лист у Mailpit | ✔ |

У браузері перевірено окремо: бейдж, панель, **посилання на сутність усередині тексту**
повідомлення (`<a href="/users">Olena Kovalenko</a>`), гасіння бейджа на відкриття панелі,
екран налаштувань із «Always on» для немутабельного типу і робочий перемикач (обхід UI-1);
консоль без помилок.

**Тост (додано того ж дня)** перевірений у браузері: приїжджає збоку на живу подію
(«notify-bot@example.com added 4 users, latest Андрій Лисенко» — плюрал схлопнутої групи
працює й тут), «View» відкриває центр (`role="dialog"` = Notifications), при **відкритій
панелі** нових тостів не зʼявляється (0 за прогін).

## Поверхні картки: тост і рядок центру — це РІЗНІ поверхні (2026-09-08)

`NotificationCard` лишається одним компонентом на два хости, але поверхню тепер задає проп
`floating`, і це не косметика:

| Хост              | Поверхня                                                               |
| ----------------- | ------------------------------------------------------------------------ |
| тост (`floating`) | висить над сторінкою: власний `bg-popover` + `shadow-lg` (тінь оверлея) |
| рядок центру      | лежить на фоні панелі: без власного фону і без тіні, лише межа          |

Доки цієї межі не було, кожен рядок центру носив `bg-popover` поверх такого самого фону панелі
і кидав тінь рівня «попап» — тобто список виглядав як стос із тридцяти спливних вікон. Разом із
подвоєним hairline (`frontend/theming.md` §1.3.5) це й давало «розмиту двопіксельну» рамку,
помітну насамперед у темній темі.

**Наведення НЕ міняє колір картки.** Блакитна обводка `hover:border-primary/50` знята: у списку
брендовий колір означає ДІЮ або вибір, а не «під курсором», тож картка під мишею читалась як
щойно вибрана. Клікабельність показує курсор, а меню ⋯, що проявляється на hover, і так каже,
що рядком можна керувати.

**Непрочитане показуємо накладкою** `bg-accent` — тією самою, що виділяє пункт меню, вибраний
рядок таблиці й активний пункт навігації (`frontend/theming.md` §1.3.3). У тості її НЕМАЄ
навмисно: щойно спливле й так непрочитане, а `bg-accent` поверх `bg-popover` замінив би фон, а не
ліг на нього — прозора накладка працює лише на елементі без власної поверхні.

## Обмеження V1 / беклог

- ✅ **Нагадування** (заплановані сповіщення) — **зроблено 2026-09-07** разом із календарем
  (`docs/calendar.md` §8, він і був першим споживачем): `scheduled_notifications` +
  cron-сканер `notifications.dispatch-scheduled` з атоміарним `claim`-ом, перепланування і
  скасування в тій самій транзакції, що доменна зміна, політика `stale` проти доставки
  «навздогін». Шар спільний — жодного `calendar_` у назвах колонок; домени поза календарем
  беруть той самий `ScheduledNotificationService`.
- **Email як другий канал**: правило «не прочитано за N хвилин → лист», перевірка presence
  перед відправкою. Схема преференсів готова (`channel`), відкладений тригер тепер теж є
  (див. пункт вище) — бракує самої доставки і claim-before-send для листів, які не можна
  надіслати двічі.
- Watchers/підписки на сутність, пороги й агрегати, digest, тротлінг — з появою
  високочастотних типів (tickets).
- Snooze, «нагадати пізніше», групування в UI по днях, звук.
- Broadcast з platform-плейну (потребує nullable-отримувача або окремої таблиці — свідомо
  не ламаємо модель заради цього зараз).
- Web Push (service worker, VAPID, підписки на пристрій) — окремий скоуп.
- Retention-cron для архіву (за зразком `files.cleanup-orphans`) — коли з'явиться обсяг.
- Ліміт «не більше N рядків на юзера» — після вимірювання реального навантаження.
