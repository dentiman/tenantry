# Activity Log (журнал активностей) — завдання на один хід

Журнал бізнес-подій для CRM/ERP-доменів: «створено користувача», «надіслано лист»,
«переназначено тікет». Одна подія може стосуватися кількох сутностей (фільтрація по
кожній), текст **ніколи не зберігається** — бекенд пише код типу + параметри, фронт
рендерить через i18next у локалі юзера (наша зафіксована i18n-доктрина, застосована ще раз).

Це **презентаційний фід для людини**, НЕ audit log (комплаєнс, diff полів, гарантована
незмінність — окрема майбутня сутність із беклогу) і НЕ event sourcing (події не є
джерелом правди — джерело правди лишаються доменні таблиці).

Статус: **реалізовано й перевірено 2026-07-21** (міграція `20260721095830_activity_log`).
Документ = специфікація, за якою реалізовано за один хід на вже наявних модулях
(users + welcome-email) — customers не чекали. Модель — за W3C Activity Streams 2.0
(actor–verb–object–target): запозичуємо модель даних, не wire-формат (JSON-LD для
внутрішньої CRM надлишковий). Живий прогін: create user на `/users` → у фіді
`user.created` (sync, tx, актор = адмін) одразу + `email.sent` (async, worker, актор =
система) після обробки; лист у Mailpit; курсор перевірено e2e (5 подій, 2 стор.+хвіст,
без дублів/пропусків). 69 tenant-e2e (+6 нових), RLS-авточек підхопив обидві таблиці.

> **Оновлено після EDA-1 (2026-08-04):** асинхронний запис не змінився по суті, але переїхав
> на конвеєр повідомлень — `WelcomeEmailHandler` → `WelcomeEmailSubscriber`,
> `JobInboxService.runOnce(context, fn)` → `MessageInboxService.runOnce(envelope, consumerId, fn)`.
> Виграш для фіду: **актор їде в конверті події**, тому `email.sent` тепер пишеться від імені
> адміна, який створив користувача, а не від безликої системи. Межа «Activity Log vs domain
> events» описана в [event-driven-architecture.md](event-driven-architecture.md) §3.13.

## Зафіксовані рішення

| Питання             | Рішення                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Модель              | Дві таблиці: `activities` + `activity_links` (поліморфні `entityType+entityId`, як `attachments`). Варіант «лінки масивом у jsonb» відхилено — дорога фільтрація, непрозоро для RLS-міркувань                              |
| Текст події         | **Не зберігається.** `type` (закритий enum) + `payload` (параметри зі снапшот-label-ами). Рендер, переклад і формат дат — повністю на фронті                                                                               |
| Актор               | Окремі колонки `actorType/actorId/actorLabel`, НЕ лінк — «хто зробив» є завжди і семантично відрізняється від «кого стосується»; system/cron теж актори                                                                    |
| `actorId` без FK    | Свідомо: активність — снапшот, юзера можуть видалити (users.remove — hard delete), фід мусить лишатись читабельним. `actorLabel` — снапшот на момент події                                                                 |
| Мутабельність       | **Append-only**: жодних update/delete через API. Retention-cron — беклог (не «на виріст», а коли з'явиться реальний обсяг)                                                                                                 |
| Запис (sync)        | В ту саму транзакцію, що й доменна зміна (`withTenantTx`) — фід ніколи не бреше                                                                                                                                            |
| Запис (async)       | У worker-і через `MessageInboxService.runOnce` **після** side effect-у — активність успадковує гарантію «не гірше, ніж сам ефект»                                                                                          |
| Читання             | `GET /activities` — **курсорна** пагінація (перший курсорний ендпоінт: фід нескінченний, «page 47» безглуздий, offset пливе на вставках)                                                                                   |
| `role` лінка        | Nullable-колонка з першого дня (бекфілити семантику заднім числом неможливо), заповнюється лише при неоднозначності. Словник: `subject`/`target`/`source`/`context`, валідація — на рівні Zod-схеми типу події, не колонки |
| Розміщення recorder | `libs/shared/src/activities/` (спільний для api і worker, як messaging) — нова shared-ліба НЕ потрібна, гачок «три місця» не спрацьовує                                                                                    |

## Компоненти

```
┌────────────────────────  API (apps/api)  ─────────────────────────────┐
│  UsersService.create ──┐ withTenantTx: user.create                    │
│                        ├──▶ ActivityRecorder.record(tx, …)  ──┐       │
│                        └──▶ jobDispatcher.send(…, { tx })     │       │
│  ActivitiesController: GET /activities (курсор, фільтр по сутності)   │
└───────────────┬───────────────────────────────────────────────┼───────┘
                │ pg-boss (users.user-registered.v1/welcome-email)│
                ▼                                                ▼
┌──────────────────────  WORKER (apps/worker)  ─────┐   ┌──────────────────┐
│  WelcomeEmailSubscriber:                          │   │  Postgres        │
│    sendMail (at-least-once)                       │──▶│  activities      │
│    inbox.runOnce → ActivityRecorder.record(tx, …) │   │  activity_links  │
│    (exactly-once по messageId:consumerId)         │   │  (RLS, як усі)   │
└───────────────────────────────────────────────────┘   └────────┬─────────┘
                                                                 │
┌────────────────────────  WEB (apps/web)  ───────────────────────┴──────┐
│  /users → row action «Activity» → ActivityDrawer → useActivitiesFindAll│
│  <ActivityMessage>: t(`activities:${type}`, payload) + Intl-дата       │
└─────────────────────────────────────────────────────────────────────────┘
```

Код по шарах (створюється в цьому завданні):

- `libs/contracts/src/activity/` — типи подій, payload-схеми, query/response.
- `libs/contracts/src/pagination/` — доповнюється курсорними схемами.
- `libs/database/prisma/` — моделі `Activity`/`ActivityLink` + міграція (таблиці + RLS).
- `libs/shared/src/activities/` — `ActivityRecorder` + `ActivitiesModule` (@Global).
- `apps/api/src/activities/` — DTO → Service → Mapper → Controller (стандартні шари).
- `apps/worker/src/subscribers/welcome-email.subscriber.ts` (на момент написання —
  `handlers/welcome-email.handler.ts`) — доповнюється записом `email.sent`.
- `apps/web/src/features/activities/components/` + `libs/i18n` namespace `activities`.

## Модель даних

```prisma
// Журнал бізнес-подій (docs/activity-log.md). Append-only: без updatedAt,
// без UPDATE/DELETE через API. Текст НЕ зберігається — type + payload,
// рендерить фронт (i18n-доктрина: бекенд — коди).
model Activity {
  id         String   @id @default(uuid())
  tenantId   String   @default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)")) @map("tenant_id")
  // Закритий enum у контрактах (ACTIVITY_TYPES); у БД — рядок (нові типи без міграції)
  type       String
  actorType  String   @map("actor_type")  // 'user' | 'system'
  // БЕЗ FK на users свідомо: снапшот — юзера можуть видалити, фід мусить жити
  actorId    String?  @map("actor_id")
  actorLabel String?  @map("actor_label") // снапшот (email/ім'я) на момент події
  // Параметри для рендеру: снапшот-label-и + {kind, id}-референси (схема — по типу)
  payload    Json
  createdAt  DateTime @default(now()) @map("created_at")

  tenant Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  links  ActivityLink[]

  // Опора для композитного FK з activity_links
  @@unique([tenantId, id])
  // Tenant-wide фід + tie-breaker курсора
  @@index([tenantId, createdAt(sort: Desc), id])
  @@map("activities")
}

// Прив'язка події до сутностей, яких вона стосується (1 подія → N сутностей).
// Поліморфний (entityType — рядок), без FK на сутність — як attachments.
model ActivityLink {
  activityId String  @map("activity_id")
  tenantId   String  @default(dbgenerated("nullif(current_setting('app.tenant_id'::text, true), ''::text)")) @map("tenant_id")
  entityType String  @map("entity_type") // 'user' | 'customer' | 'ticket' …
  entityId   String  @map("entity_id")
  // Семантика зв'язку: 'subject' | 'target' | 'source' | 'context'; NULL коли
  // неоднозначності немає. Словник валідує Zod-схема типу події, не БД
  role       String?

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Композитний FK: лінк не може вказати на активність чужого tenant-а
  activity Activity @relation(fields: [tenantId, activityId], references: [tenantId, id], onDelete: Cascade)

  @@id([activityId, entityType, entityId])
  // Головний запит: фід сутності
  @@index([tenantId, entityType, entityId])
  @@map("activity_links")
}
```

`Tenant` отримує зворотні relations `activities`/`activityLinks`. Міграція — таблиці +
стандартний RLS-блок (той самий шаблон, що в `20260716140000_enable_rls`):

```sql
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activities"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
-- те саме для "activity_links"
```

Гранти для `saas_app` дає наявний `ALTER DEFAULT PRIVILEGES` — окремих не треба.
Авточек `pg_policies` у `rls.e2e-spec` підхопить нові таблиці сам (обидві мають
`tenant_id`) — «забута політика» впаде в CI.

## `role` у лінках: навіщо

`payload` і `links` — дві проєкції події: payload — для **рендеру тексту**, links —
для **запитів**. Поки запит один («усе по сутності») — role не потрібна. Вона потрібна,
коли запити розрізняють _характер_ участі:

- **Та сама сутність двічі** (без role нерозв'язно): `customer.merged` →
  `(customer, A, 'source')` + `(customer, B, 'target')`;
- **Дія над сутністю vs контекст**: лист контакту по тікету → `(contact, 'target')` +
  `(ticket, 'context')` + `(customer, 'context')` — UI може фільтрувати «тільки дії
  _над_ тікетом»;
- **Учасник, не актор**: `ticket.reassigned` → `(ticket, 'subject')` +
  `(user, Іван, 'source')` + `(user, Марія, 'target')`.

## Контракти (`libs/contracts/src/activity/`)

> **Оновлено 2026-10-05 (docs/modules.md §7.1).** `ACTIVITY_TYPES` більше не
> пишеться руками: кожен модуль оголошує свої типи в контрактах
> (`calendar/calendar.activities.ts`: `defineActivityTypes({ ns, prefix }, { тип: { payload,
> textVariant? } })`), root `libs/contracts/src/activity-types.ts` їх збирає, перелік і
> payload-схеми виводяться звідти. `EntityRefSchema` — у `activity/activity-definition.ts`.
> Тексти — у неймспейсі власника (`calendar.json` → `activity.*`); платформні — у
> `activities.json`. Блок нижче — історичний вигляд V1.

```ts
// Референс на сутність усередині payload: id — для майбутнього лінка на сторінку,
// label — СНАПШОТ назви на момент події (сутність можуть перейменувати/видалити,
// фід рендериться без join-ів на живі таблиці)
export const EntityRefSchema = z.object({
  kind: z.string().min(1),
  id: z.uuid(),
  label: z.string(),
});

export const ActivityLinkRoleSchema = z.enum(['subject', 'target', 'source', 'context']);

// Закритий перелік типів — єдине місце додавання нового типу події
export const ACTIVITY_TYPES = ['user.created', 'email.sent'] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

// Payload-схема ПО ТИПУ: recorder валідує на записі (fail fast — невалідний payload
// не потрапить у append-only таблицю), фронт знає форму для рендеру
export const ACTIVITY_PAYLOAD_SCHEMAS = {
  'user.created': z.object({
    user: EntityRefSchema, // kind: 'user'
  }),
  'email.sent': z.object({
    template: z.string(), // 'welcome' — ключ у i18n фронта
    recipient: EntityRefSchema,
    email: z.email(), // снапшот адреси, на яку реально пішов лист
  }),
} as const satisfies Record<ActivityType, z.ZodType>;

// Query: стрічка сутності — по парі {entityType, entityId}. Загальна стрічка воркспейсу —
// окремий ендпоінт і схема (WorkspaceActivityQuerySchema), див. «Читання: GET /api/activities/workspace»
export const ActivityQuerySchema = CursorQuerySchema.extend({
  entityType: z.string().min(1),
  entityId: z.uuid(),
  type: ActivityTypeSchema.optional(),
});

export const ActivityResponseSchema = z.object({
  id: z.uuid(),
  type: ActivityTypeSchema, // фронт усе одно має generic-fallback на невідомий тип
  actorType: z.enum(['user', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()), // форму звужує ACTIVITY_PAYLOAD_SCHEMAS[type]
  createdAt: z.iso.datetime(), // як усі дати в контрактах — ISO-рядок, формат — Intl на фронті
});
```

Курсорні схеми — у `libs/contracts/src/pagination/` (поруч із offset-ними, НЕ замість):

```ts
export const CursorQuerySchema = z.object({
  cursor: z.string().optional(), // непрозорий токен; формат — деталь бекенда
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function cursorResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(), // null = кінець фіда
  });
}
```

Курсор — `base64url("{createdAt ISO}|{id}")`, keyset-умова
`(created_at, id) < (cursor.createdAt, cursor.id)` при сортуванні
`createdAt DESC, id DESC` (tie-breaker по id обов'язковий — та сама причина, що в
users.service). Сервіс бере `limit + 1` рядків: зайвий є → `nextCursor` з останнього
віддаваного, немає → `null`.

## `ActivityRecorder` (`libs/shared/src/activities/`)

```ts
export type ActivityActor =
  | { type: 'user'; id: string; label: string } // label = email/ім'я з auth-контексту
  | { type: 'system' }; // worker/cron — актора-людини немає

export interface RecordActivityInput {
  type: ActivityType;
  actor: ActivityActor;
  payload: Record<string, unknown>;
  links: { entityType: string; entityId: string; role?: ActivityLinkRole }[];
}

@Injectable()
export class ActivityRecorder {
  /**
   * tx — ПЕРШИЙ обов'язковий аргумент свідомо: recorder фізично неможливо викликати
   * поза транзакцією доменної зміни (API) чи inbox-у (worker). tenant_id не передається
   * ніде — DB-default із CLS, як у всіх таблицях.
   */
  async record(tx: Prisma.TransactionClient, input: RecordActivityInput): Promise<void> {
    // fail fast: невалідний payload — це баг викликача, а не дані
    const payload = ACTIVITY_PAYLOAD_SCHEMAS[input.type].parse(input.payload);
    const activity = await tx.activity.create({
      data: {
        type: input.type,
        actorType: input.actor.type,
        actorId: input.actor.type === 'user' ? input.actor.id : null,
        actorLabel: input.actor.type === 'user' ? input.actor.label : null,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await tx.activityLink.createMany({
      data: input.links.map((l) => ({ activityId: activity.id, ...l })),
    });
  }
}
```

`ActivitiesModule` — @Global у `libs/shared` (за зразком `StorageModule`), імпортується
в AppModule обох застосунків (api + worker). Конвенція: **recorder ніколи не викликається
поза транзакцією доменної зміни** — сигнатура це виключає.

## Приклад 1 — синхронний запис: створення користувача

Правило: активність — у ту саму транзакцію, що й доменна зміна. Або сталося обидва,
або нічого.

`UsersService.create` переїжджає у `withTenantTx`; постановка `userRegisteredJob` —
туди ж через `{ tx }` (це і є еталон транзакційної постановки з фази 2.1; поточний
try/catch «черга некритична» прибирається — атомарність краща за м'яку деградацію,
бо fan-out породжує welcome-лист, який без події не має сенсу). Контролер починає
передавати актора:

```ts
// users.controller.ts
@Post()
create(@Body() dto: CreateUserDto, @CurrentUser() actor: JwtPayload) {
  return this.usersService.create(dto, actor);
}

// users.service.ts
async create(data: CreateUser, actor: JwtPayload): Promise<UserWithAvatar> {
  // …перевірка existing + argon2, як зараз…
  return this.tenantTx.withTenantTx(async (tx) => {
    const user = await tx.user.create({
      data: { ...rest, passwordHash },
      include: { avatarFile: true },
    });

    await this.activities.record(tx, {
      type: 'user.created',
      actor: { type: 'user', id: actor.sub, label: actor.email },
      payload: {
        user: { kind: 'user', id: user.id, label: user.name ?? user.email },
      },
      links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
    });

    await this.jobDispatcher.send(
      userRegisteredJob,
      { userId: user.id, email: user.email },
      { singletonKey: user.id, tx },
    );

    return user;
  });
}
```

Що в БД (tenant_id ніде в коді — DB-default із CLS; MT лишається невидимою для домену):

```
activities:     { id: a1, type: 'user.created', actor_type: 'user',
                  actor_id: <admin>, actor_label: 'admin@example.com',
                  payload: {"user":{"kind":"user","id":"u1","label":"Іван Петренко"}} }
activity_links: { activity_id: a1, entity_type: 'user', entity_id: 'u1', role: 'subject' }
```

## Приклад 2 — асинхронний запис: `email.sent` із worker-а

Факт настає у worker-і: HTTP-запиту давно немає, актор — система. Ланцюжок наявний:

```
create user (api, tx) ─▶ users.user-registered.v1 ─▶ підписник welcome-email ─▶ sendMail
                                                                                    │
                                                                     activity 'email.sent'
```

`WelcomeEmailHandler` доповнюється (сигнатури на момент написання: `handle(payload, context)`,
`inbox.runOnce(context, fn)` — runOnce всередині вже йде через `withTenantTx`,
CLS піднятий registrar-ом із payload.tenantId; після EDA-1 це `handle(data, envelope)` і
`inbox.runOnce(envelope, consumerId, fn)` — актуальний код у
`apps/worker/src/subscribers/welcome-email.subscriber.ts`):

```ts
async handle(payload: WelcomeEmailPayload, context: JobContext): Promise<void> {
  const user = await this.prisma.user.findUnique({
    where: { id: payload.userId },
    select: { locale: true, name: true }, // свіжі з БД, не з payload — як зараз
  });
  const locale = user?.locale ?? 'en';
  const name = user?.name ?? payload.email;

  // 1) side effect — at-least-once (задокументована семантика welcome-листа)
  const subject = i18n.t('notifications:welcome.subject', { lng: locale });
  const html = i18n.t('notifications:welcome.body', { lng: locale, name });
  await this.mailer.send(payload.email, subject, html);

  // 2) запис активності — exactly-once відносно job-а
  await this.inbox.runOnce(context, async (tx) => {
    await this.activities.record(tx, {
      type: 'email.sent',
      actor: { type: 'system' }, // лист відправила система; хто створив юзера —
                                 // видно з окремої 'user.created'. Кожна подія
                                 // має свого чесного актора
      payload: {
        template: 'welcome',
        recipient: { kind: 'user', id: payload.userId, label: name },
        email: payload.email,
      },
      links: [{ entityType: 'user', entityId: payload.userId, role: 'target' }],
    });
  });
}
```

**Порядок «runOnce ПІСЛЯ sendMail» — свідомий.** Розклад падінь:

| Падіння                          | Наслідок                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| впав `sendMail`                  | retry pg-boss; активності нуль — **фід не бреше** (не записали те, чого не було)                                                               |
| між `sendMail` і commit-ом inbox | лист продубльовано (at-least-once, як і сьогодні), активність — **один раз**: другий прохід `runOnce` побачить jobId у processed_jobs і скіпне |
| запис активності _до_ відправки  | ТАК НЕ РОБИТИ: при падінні мейлера фід стверджує, що лист пішов                                                                                |

Активність успадковує гарантію «не гірше, ніж сам ефект»: лист — at-least-once,
запис про нього — exactly-once відносно job-а.

## Читання: `GET /api/activities`

```http
GET /api/activities?entityType=user&entityId=u1&limit=30
Authorization: Bearer eyJ…
```

Сервіс (keyset, а не Prisma-cursor — умова складена):

```ts
const cursor = decodeCursor(query.cursor); // base64url → { createdAt, id } | null
const rows = await this.prisma.activity.findMany({
  where: {
    links: { some: { entityType: query.entityType, entityId: query.entityId } },
    ...(query.type && { type: query.type }),
    ...(cursor && {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    }),
  },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: query.limit + 1, // зайвий рядок = є наступна сторінка
});
```

Відповідь `200` (два записи з прикладів вище):

```json
{
  "items": [
    {
      "id": "a2",
      "type": "email.sent",
      "actorType": "system",
      "actorId": null,
      "actorLabel": null,
      "payload": {
        "template": "welcome",
        "recipient": { "kind": "user", "id": "u1", "label": "Іван Петренко" },
        "email": "ivan@acme.com"
      },
      "createdAt": "2026-07-19T14:32:05.412Z"
    },
    {
      "id": "a1",
      "type": "user.created",
      "actorType": "user",
      "actorId": "9e84c717-…",
      "actorLabel": "admin@example.com",
      "payload": {
        "user": { "kind": "user", "id": "u1", "label": "Іван Петренко" }
      },
      "createdAt": "2026-07-19T14:32:04.981Z"
    }
  ],
  "nextCursor": null
}
```

## Читання: `GET /api/activities/workspace` (загальна стрічка воркспейсу)

«Що відбувається в компанії» по ВСІХ юзерах — для віджета «Остання активність» на дашборді. Query —
лише `cursor` і `limit`; курсор і порядок ті самі (`createdAt DESC, id DESC`), відповідь —
`ActivityListResponse`. Межу тенанта тримає RLS, як і в решти читань.

**Хто що бачить — рішення, а не збіг обставин.** Ендпоінт відкритий КОЖНОМУ юзеру тенанта, тому
склад стрічки обмежений **типами, які власник типу дозволив показувати всім** — `workspace: true` у
його визначенні (`ActivityTypeDef`, `libs/contracts/src/activity/activity-definition.ts`).
Дефолт — «ні»: нова подія не з'явиться в чужій стрічці, поки її автор цього явно не вирішить.
`WORKSPACE_ACTIVITY_TYPES` (`activity-types.ts`) лише збирає позначені типи, а сервер фільтрує за
ним у самому запиті (`type IN …`), тож приховані типи не з'їдають слотів сторінки й не ламають курсор.
Клієнт набір типів змінити не може.

Дозволено: `customer.*` (створено, змінено відповідального, архівовано, відновлено, видалено),
`user.created` / `user.enabled` / `user.disabled`. **Свідомо ні:**

- безпекові — `user.password_changed`, `user.sessions_revoked`, `user.email_changed`: це не
  справа колег;
- `calendar_event.*` — приватна подія не має бути видна нікому, окрім учасників, а активність про
  це нічого не знає і спитати календар не може (`activities` — рівень нижче календаря, а доступ до
  запису тримає сама функція доступу календаря). Календар має власну агенду на дашборді. Коли
  видимість зможе виражатись на рівні запису активності (напр. поле у payload), типи календаря
  можна буде допустити;
- `settings.*`, `email.sent` — для них є журнал налаштувань і картка юзера.

Інваріант тримають e2e (`activities.e2e-spec.ts`, блок «workspace feed»): фільтр за позначкою
типу, ізоляція тенантів, курсор з прихованими подіями між видимими, 401 без токена. Дозволити
безпековий тип — отже зламати тест.

Фронтенд: `DashboardActivityWidget` (`features/activities/components/`) — той самий `ActivityFeed`
з власним `useFeedQuery`, у слоті `dashboardWidgets` ([modules.md](modules.md) §4.1).

## Читання в control plane: `GET /api/tenants/:tenantId/activities` (platform-api)

Стрічка подій УСЬОГО тенанта на картці тенанта в platform-web — операційний зріз для
оператора («що там сталося вчора о 15:00»), а не копія бізнес-екрану: повної хронології
тенанта в tenant-плані немає ні в кого, навіть в адміна (загальна стрічка воркспейсу
відфільтрована за типами).

- **Оператор бачить УСІ типи** (рішення 2026-10-18), зокрема безпекові (`user.password_changed`,
  `user.sessions_revoked`) і `calendar_event.*` з назвами приватних подій, — більше, ніж будь-який
  юзер тенанта. Без фільтра за сутністю; необов'язковий фільтр `type`. Перегляд у
  `platform_audit_events` не пишеться (відкладено).
- **Межа тенанта — лише `where: { tenantId }`.** platform-api читає через `SystemPrismaService`
  (BYPASSRLS), тому RLS тут не працює; невідомий тенант → 404.
- **Нічого не дублюється.** Курсор, сортування і мапінг — `readActivityPage` /
  `toActivityResponse` у `libs/shared/src/activities/activity-page.ts`, ті самі, що в
  `apps/api` (там вони лише передають RLS-клієнт). Контракт — `TenantActivityQuerySchema`
  (`CursorQuerySchema` + `type?`) у `libs/contracts/src/platform/tenant-activity.schema.ts`;
  схема відповіді — та сама `ActivityListResponseSchema`.
- **Рендер — спільний** (`libs/ui/src/activities/`, див. «Фронтенд: рендер фіда»): картка тенанта
  ставить `ActivityPanel` у праву колонку з хуком `useTenantActivitiesFindAll`.

Інваріант тримає `apps/platform-api/test/tenant-activities.e2e-spec.ts`: подій чужого тенанта у
відповіді немає, тип поза `WORKSPACE_ACTIVITY_TYPES` присутній, фільтр за типом, курсор без дублів
і пропусків на рівних `createdAt`, 400 на зламаний курсор, 404 і 401.

## Фронтенд: рендер фіда

Демо-споживач (за зразком ChangeAvatarModal): row action «Activity» на `/users` →
`ActivityDrawer` → `useActivitiesFindAll` (orval, operationId `activitiesFindAll`).
Із появою картки юзера (`/users/$userId`) сама стрічка живе в окремому `ActivityFeed`, а
драйвер лишив собі тільки оболонку: два хости — одна верстка (той самий принцип, що з
`NotificationCard`).
Хостів у стрічки тепер три: `ActivityDrawer`, `ActivityPanel` (постійна бічна колонка
карток юзера і кастомера — власна висота, свій скрол, `sticky` з `lg`) і журнал змін
налаштувань компанії.

> **Оновлено 2026-10-18.** `ActivityFeed`, `ActivityPanel` і `ActivityMessage` переїхали в
> `libs/ui/src/activities/` (`@saas-skeleton/ui/activities`; шлях належить модулю `activities`
> у `modules.config.ts`, а не infra-рівню `libs/ui`): їх рендерить і platform-web (стрічка
> тенанта). Джерела даних у бібліотеці немає — хост передає `useFeedQuery({ cursor, isEnabled })`
> хука свого згенерованого клієнта, а `feedKey` скидає накопичене при зміні стрічки. У
> `apps/web/src/features/activities/components/` лишились тонкі обгортки з тими самими пропами
> `entityType`/`entityId` (дефолтне джерело — `useActivitiesFindAll`).
Пагінація — накопичення items у локальному стані з ЛІНИВИМ довантаженням: маркер у кінці
списку під `IntersectionObserver` (без `root`, тобто відносно вьюпорта — вкладений скрол
панелі браузер враховує сам, тож хост не передає сюди свій контейнер). Кнопки «Load more»
більше немає; ключ `loadMore` лишився підписом до спінера довантаження.
`useInfiniteQuery` через orval-конфіг — і далі беклог.

Ключі — `libs/i18n`, namespace `activities` (спільний для обох фронтів; ключ = тип події).
Тексти типів фіч — окремими файлами власників `libs/i18n/src/locales/en/activities/<модуль>.json`
(`customers`, `calendar`, `chat`), які `libs/i18n/src/index.ts` зливає в той самий неймспейс:

```json
{
  "user.created": "<b>{{actor}}</b> created user <b>{{user}}</b>",
  "email.sent": "System sent \"{{template}}\" email to <b>{{recipient}}</b> ({{email}})",
  "unknown": "Activity: {{type}}"
}
```

`<ActivityMessage activity={a}>`:

- `t(\`activities:${a.type}\`, { actor: a.actorLabel, user: payload.user.label, … })`через`<Trans>`(виділення`<b>` без dangerouslySetInnerHTML);
- невідомий `type` (фронт старіший за бекенд) → generic-ключ `activities:unknown` —
  фід не падає;
- дата — `Intl.DateTimeFormat` з `createdAt` (ISO-рядок), **ніколи не інтерполюється
  в текст повідомлення**;
- `EntityRef.id` у v1 нікуди не лінкується (сторінок сутностей ще немає) — рендериться
  label; лінки з'являться разом із customers.

Разом у фіді юзера:

```
14:32  admin@example.com created user Іван Петренко      ← sync, tx
14:32  System sent "welcome" email to Іван Петренко       ← async, worker
```

## Тести (e2e, `apps/api/test/activities.e2e-spec.ts`)

- `POST /users` → у БД рівно одна `user.created` + лінк `(user, id, subject)`;
  actor = токен адміна (pg-boss в e2e замокано — `email.sent` перевіряється
  живим прогоном, як усі worker-ефекти).
- `GET /activities` по сутності: віддає її події, НЕ віддає чужі; фільтр `type`;
  курсор — створити >limit подій, пройти дві сторінки, без дублів/пропусків,
  останній `nextCursor: null`.
- Ізоляція: активність tenant-а A не видна з контексту B (запити під токеном B);
  прямі перевірки рядків — через `SystemPrismaService` (під saas_app поза CLS — 0 рядків).
- RLS-авточек `pg_policies` у наявному `rls.e2e-spec` покриє обидві таблиці без змін.
- Recorder: невалідний payload для типу → викид (юніт або через e2e неможливий — досить
  юніта на `record`).

## Обсяг одного ходу (порядок імплементації)

1. **Контракти**: `libs/contracts/src/activity/` (типи, payload-схеми, query/response) +
   курсорні схеми в `pagination/`; експорт з index (tenant-plane).
2. **БД**: моделі в `schema.prisma` + міграція `activity_log` (таблиці + RLS ENABLE/FORCE/
   політики за шаблоном enable_rls) → `db:generate`.
3. **Recorder**: `libs/shared/src/activities/` — `ActivityRecorder`, `ActivitiesModule`
   (@Global); імпорт у AppModule api і worker.
4. **API**: `apps/api/src/activities/` — DTO → Service (keyset) → Mapper → Controller
   (`GET /activities`, Swagger-метадані, operationId `activitiesFindAll`).
5. **Інтеграція sync**: `UsersService.create` → `withTenantTx` (+ `@CurrentUser()` у
   контролері, `send(..., { tx })`, прибрати try/catch навколо диспатчу).
6. **Інтеграція async**: `WelcomeEmailHandler` + `inbox.runOnce` після `sendMail`
   (після EDA-1 — `WelcomeEmailSubscriber`).
7. **Конвеєр**: `openapi:generate` → `web:codegen` (обидва артефакти комітяться).
8. **Web**: `ActivityDrawer` + `ActivityMessage` + row action на `/users`;
   namespace `activities` у `libs/i18n`.
9. **Тести**: `activities.e2e-spec` + юніт на recorder.
10. **Доки**: оновити шапку CLAUDE.md (фаза завершена) і цей документ (статус).

Definition of Done: `pnpm lint && pnpm typecheck && pnpm build` зелені; `api:test:e2e`
зелений (включно з новим сьютом і RLS-авточеком); живий прогін — create user на `/users` →
у Drawer дві події (`user.created` одразу, `email.sent` після обробки worker-ом),
лист у Mailpit; курсор перевірений на >30 подіях.

## Обмеження v1 / беклог

- `user.updated` з diff-ом полів (`changes: [{field, from, to}]`) — окремий хід: дизайн
  снапшота змін (whitelist полів, маскування чутливого) не тягнути в v1.
- ~~Tenant-wide фід~~ — зроблено: `GET /activities/workspace` (див. вище). Лишилось допустити в нього
  події календаря, коли приватність виражатиметься на рівні запису активності.
- Лінки з фіда на сторінки сутностей — коли з'являться сторінки (customers).
- `useInfiniteQuery` через orval-конфіг замість накопичення items у власному стані.
- Retention-cron (system-scope, за зразком cleanup-orphans) — коли з'явиться обсяг.
- Audit log (комплаєнс, гарантована незмінність, diff) — **окрема сутність**, не
  розширення активіті.
- Активності від customers/tickets (`customer.merged`, `ticket.reassigned` з role
  source/target) — разом з еталонним доменом.
