# WhatsApp-канал: рішення, архітектура, фази

**Статус: дизайн зафіксовано 2026-10-13, нічого не збудовано.** Це продовження [chat.md](chat.md)
(§1, §4.6, §4.9, §4.10, §7): там — модель чату і чому він такий, тут — як на нього сідає перший
зовнішній канал і в якому порядку це будується. Докази й сирі факти — у
[whatsapp-research/](whatsapp-research/) (знімок 2026-10-13, англійською):
[Meta Cloud API](whatsapp-research/meta-cloud-api.md), [код fms-api](whatsapp-research/fms-api-review.md),
[продуктові правила fms](whatsapp-research/fms-product-rules.md),
[опенсорс-патерни](whatsapp-research/oss-patterns.md).
**Потоки по фічах (UI → система → виклики Meta → вебхуки) і підготовка в Meta —
[whatsapp-feature-flows.md](whatsapp-feature-flows.md).**

Читати після [chat.md](chat.md), [event-driven-architecture.md](event-driven-architecture.md)
(конверт, `publish(tx, …)`, DLQ) і [multi-tenancy-architecture.md](multi-tenancy-architecture.md)
(§5 `resolve_tenant`, §8 черги).

---

## 0. Що зафіксовано 2026-10-13

Рішення власника (з розмови про наступний крок після `CHAT-0.2b`):

| # | Рішення | Наслідок |
| --- | --- | --- |
| W0.1 | **Єдиний канал у плані — WhatsApp (Meta Cloud API).** SMS, email та інші не плануються | жодних `if (type === …)` ні в плані, ні в схемі під невикористані канали |
| W0.2 | **Ядро канального шару не знає про WhatsApp.** Другий провайдер (наприклад Twilio) — це адаптер і рядок у реєстрі, без змін ядра | `Channel.type` (що бачить клієнт: `WHATSAPP`) відокремлено від `Channel.provider` (транспорт: `meta_cloud`, потім можливо `twilio`); шов доводиться тестом-контрактом (§4.12) |
| W0.3 | **Звужено все, що не веде до каналу.** Знято: згадки `@user`, `chat.mentioned`, `notification_level`, presence-крапку, редагування/видалення внутрішніх реплік, UI керування учасниками, `SNOOZED`, SLA, авто-маршрутизацію | фази `0.3` і `CHAT-1` як окремі більше не існують (§6) |
| W0.4 | **Беремо всі корисні й рекомендовані саме для WhatsApp фічі** | каталог у §5 з рівнями «обов'язково / рекомендовано / пізніше / ні» |

Решта цього документа — рекомендації, які чекають фіксації власником там, де це не сказано прямо
(реєстр відкритих питань — §7).

---

## 1. Принципи

1. **Канал — адаптер, домен про нього не знає.** Доменний код розмов не містить жодної умови
   по провайдеру; усе провайдерське — за інтерфейсом (§4.2).
2. **Спочатку сире, потім розбір.** Підписаний вебхук пишеться як є в тій самій транзакції, що
   й job розбору; 200 віддається після коміту. Розбір повторюваний (replay) і ідемпотентний.
3. **Арбітр дедупу — Postgres**, не Redis і не перевірка в коді (`chat.md` §4.5). Приклад
   зворотного: Chatwoot бере Redis-лок *до* коміту й губить повідомлення, якщо транзакція впала, а
   Meta повторила вебхук; fms-api має check-then-insert на неунікальному індексі.
4. **Вихідне — спочатку рядок, потім відправка** (`QUEUED` → `SENDING` → `SENT`). Cloud API не має
   ключа ідемпотентності на відправку (§2, п.1), тож рядок із власним id — єдина опора.
5. **Тиха втрата заборонена.** Усе, що не вдалося маршрутизувати чи розібрати, лишає рядок із
   кодом причини, який бачить оператор (інцидент `3e67a5e7` у fms-api: тенант не визначався —
   вебхуки мовчки відкидались із 200).
6. **Класифікація помилок — частина контракту адаптера**, не рядок у логах (§4.5).

---

## 2. Факти Cloud API, що змінюють дизайн

Повний довідник — [meta-cloud-api.md](whatsapp-research/meta-cloud-api.md). Тут лише те, що
впливає на рішення.

| # | Факт | Наслідок |
| --- | --- | --- |
| 1 | **Відправка не має ідемпотентності** (ні ключа, ні клієнтського референсу; кожен прийнятий POST дає новий `wamid`). Єдине — `biz_opaque_callback_data`, яке повертається у статусі | outbox із власним id, у `biz_opaque_callback_data` кладемо id повідомлення; повтор «наосліп» заборонено (§4.5) |
| 2 | **200 на відправку = прийнято, не доставлено.** Істина — у вебхуках `statuses`; `delivered` може бути пропущений (одразу `read`); порядок не гарантований | статус рухається лише вперед, змінюється одним атомарним `UPDATE` (§4.4) |
| 3 | **Вебхуки: at-least-once, без порядку, ретраї до 7 днів, до 1000 оновлень у одному POST (до 3 МБ), історії немає; ретраї йдуть усім підписаним застосункам.** Таймаут ~20 с (виведено з docs дзвінків) | сире тіло зберігаємо; ліміт тіла Express (100 КБ) для цього маршруту піднімаємо; кожен `change` обробляємо незалежно |
| 4 | **Підпис** `X-Hub-Signature-256` = HMAC-SHA256 від тіла ключем *app secret*; GET-рукостискання `hub.challenge` | потрібен `rawBody`; порівняння сталого часу; без підпису нічого не пишемо (fms-api і Evolution підпису не перевіряють) |
| 5 | **Callback можна перевизначити на рівні WABA і номера** (пріоритет номер > WABA > застосунок), **але вебхуки шаблонів і акаунта завжди йдуть на callback застосунку** | два види входу: URL каналу і «застосунковий» (§4.3) |
| 6 | **Вікно 24 год** відкриває повідомлення *або дзвінок* користувача, скидається кожним новим; поза ним — лише затверджені шаблони; помилка `131047`. Вікно 72 год від реклами (click-to-WhatsApp) — лише про тарифікацію, не про дозвіл слати вільний текст | `customer_last_message_at` від часу Meta; перевірка і при постановці, і у воркері (§4.5) |
| 7 | **Медіа:** id у вебхуці живе 7 днів, URL — 5 хв, потрібен Bearer-токен; вхідний ліміт 100 МБ; завантажене нами — 30 днів | копіюємо одразу; рядок `PENDING` + окремий job, не всередині ingest-транзакції (§4.8) |
| 8 | **Номер телефону може бути відсутній.** З квітня 2026 вебхуки несуть BSUID (`user_id`, `from_user_id`, …); при використанні юзернейму `wa_id`/`from` приходять лише якщо була взаємодія за 30 днів чи контакт у книзі Meta. Відправка: `to` (телефон) або `recipient` (BSUID); авторизаційні шаблони BSUID не приймають | ідентичність = кілька адрес у одного контакта з `kind`; ключувати на телефоні неможливо (§4.6) |
| 9 | **Редагування клієнтом приходить як `unsupported` (`type: edit`)**; події `edit`/`revoke` — лише для Coexistence-номерів | плейсхолдер у стрічці; повноцінного редагування/видалення не будуємо |
| 10 | **Шаблон: категорію вирішує Meta** (UTILITY, визнаний маркетинговим, затверджується як MARKETING), паузи за якістю (3 год → 6 год → disabled), ім'я видаленого затвердженого шаблону заблоковане 30 днів, правки 1/24 год | локальний кеш із статусом, якістю, категорією; захист відправки (§4.9) |
| 11 | **Тарифікація — за повідомлення.** Шаблони платні за категорією й країною; **з 2026-10-01 платними стають і сервісні (не шаблонні) відповіді та utility-шаблони у вікні** (джерело — [Meta, non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages): «Effective October 1, 2026, Meta will charge on a per-message basis for service messages»; ставка = ставці utility/authentication у ринку, обсягових знижок немає; головна сторінка `pricing.md` ще каже «безкоштовно» — не оновлена). **Сторонні джерела (Techweez 2026-09-28, Twilio, respond.io) пишуть про 1000 безкоштовних сервісних повідомлень на місяць на номер — на сторінках Meta цього не знайдено, не покладатися без перевірки** | блок `pricing` зі статусів зберігаємо з першого дня (§4.4); облік вартості — окрема, пізніша фаза |
| 12 | **Ліміти:** охоплення нових користувачів поза вікном — на рівні *business portfolio* (старт 250/24 год), пропускна здатність 80 повідомлень/с на номер, пара відправник→отримувач 1 повідомлення/6 с (`131056`) | помилки throttling → ретрай із бекофом; ліміти показуємо в здоров'ї каналу |
| 13 | **Модель акаунтів змінюється:** WABA розділяється на WhatsApp Business Account і Messaging Account; поле `messaging_account_id` у відправці (перша фаза — H2 2026, друга — H1 2027) | в credentials каналу зберігаємо `messagingAccountId` опційно; `phone_number_id` — не єдиний ключ маршрутизації |
| 14 | **Тест:** публічний тестовий номер Meta, отримувачі з allow-списку (помилка `131030` поза ним; ліміт 5 отримувачів — одне джерело) | розробка й CI — на fake-адаптері; реальний номер — лише ручна перевірка (§4.12, §6) |

---

## 3. Що беремо з чужого досвіду

Деталі й посилання на файли — [fms-api-review.md](whatsapp-research/fms-api-review.md) і
[oss-patterns.md](whatsapp-research/oss-patterns.md).

### 3.1. fms-api (власний продакшн-досвід)

| Беремо | Уникаємо |
| --- | --- |
| Ідентичність розмови = (наш номер, номер співрозмовника), клієнт — необов'язковий атрибут; створення розмови стійке до гонки (unique + перечитування переможця) | Відправка синхронно в HTTP-запиті, без стану `QUEUED`, ключа й ретраїв: падіння після виклику Meta = невідстежене повідомлення |
| Сире тіло вебхука пишеться до розбору; **команда replay** по збережених рядках | Відсутній підпис; будь-хто, хто знає `phone_number_id`, може підсунути повідомлення |
| Тенант береться з відправника (номера), не з акаунта (виправлення `3e67a5e7`); `sender` визначається **для кожного `change`**, не з `entry[0]` | Дедуп `existsByExternalId` + неунікальний індекс |
| Монотонний статус із семантикою помилки (`supersedes()`): помилка не перекриває Delivered/Read, запізнілий Sent не скасовує Failed | Усі помилки Meta → один HTTP 400; ніякої класифікації |
| Медіа: `Pending` → job → стрім на диск → перевірка розміру й sha256 → термінальні `Failed`/`Expired` | Глобальний автоінкремент замість `seq` розмови; жорстко зашиті 7/30 днів життя медіа |
| Підписка на вебхуки — явна, на рівні WABA, з перевизначенням на номер (`e996dcd8`); трьохстан «знаємо / не знаємо» для читань у провайдера (`c358abc5`) | «Тиха» відмова: невідомий номер чи статус без повідомлення — лише рядок логу |

### 3.2. Опенсорс (Chatwoot — основний референс; решта — за окремими темами)

| Беремо | Уникаємо |
| --- | --- |
| Сира подія → швидка відповідь → job (Chatwoot, Typebot, courier) | Redis як єдиний дедуп / лок до коміту (Chatwoot, courier) |
| Контакт має **кілька ідентифікаторів** (телефон, BSUID, батьківський BSUID); розмова прив'язана до точної ідентичності; ротація (`user_changed_number`, `user_id_update`) додає **аліас**, автоматичного злиття немає (Chatwoot `user_id_rotation_service`) | Синтетичні аліаси номерів там, де це може бути інший абонент (аргентинський `549`) |
| Нормалізація номерів зберігає `wa_id` як прийшов і шукає за списком кандидатів (BR/AR/MX) | Маршрутизація за `display_phone_number` (Chatwoot): ключ — `phone_number_id` або ключ каналу |
| Класи помилок відправки: throttled / retryable / permanent (courier `handlers/meta/whatsapp/api.go`) | Відсутність класифікації (Chatwoot позначає `failed` будь-яку відмову) |
| Кеш відправлених зовнішніх id, щоб статус, що випередив запис id, не губився (courier); у нас — таблиця «паркування» (§4.4) | Статус, що не знайшов повідомлення, мовчки відкидається (Chatwoot) |
| Журнал HTTP-викликів до провайдера з маскуванням секретів (`ChannelLog` у courier) | Токен у відкритому JSONB (Chatwoot); змішані версії Graph API |
| Фонове здоров'я каналу: якість, ліміт, статус; код `190` → стан «потрібна повторна авторизація» | Ретраї в пам'яті процесу (Evolution) |
| Плейсхолдер для невідомих типів, `referral`, `in_reply_to`, відлуння Coexistence зі статусом `delivered` | Неофіційні протоколи (Baileys, whatsapp-web.js): ризик блокування, поза продуктом |

Ліцензії: courier/mailroom — BSL 1.1, Typebot — FSL, Ticketz — AGPL → **лише патерни, не код**;
Chatwoot — MIT (поза каталогом `enterprise/`).

---

## 4. Архітектура каналу

### 4.1. Модель даних (доповнення до `chat.md` §4.2)

Усі таблиці — за шаблоном MT-2 (RLS ENABLE/FORCE, `tenant_id` з DB-default, композитні FK).
Нижче лише відмінності від `chat.md`, а не повторення.

| Таблиця | Ключові колонки / обмеження | Примітка |
| --- | --- | --- |
| `messaging_accounts` | `provider` (`meta_cloud`), `name`, **`externalId`** (WABA id — звичайна індексована колонка), `messagingAccountId?`, `credentials` (зашифровано: токен доступу), `appSecret?` (зашифровано; запасний — платформний), `verifyToken`, `webhookKey` (випадковий, унікальний), `tokenKind` (`system_user` / `temporary` / `unknown`), `tokenExpiresAt?`, `tokenCheckedAt`, `scopes`, `status` (`CONNECTED` / `NEEDS_REAUTH` / `DISABLED`), `webhookSubscribedAt`, `lastSyncAt`, `lastError` | **один на тенанта**: `UNIQUE (tenant_id, provider)`; обмеження знімається, коли знадобиться другий WABA. Це «налаштування WhatsApp» тенанта (§4.13). Секрети шифруються `CryptoService` (AES-256-GCM, `v1:`), у відповідях маскуються |
| `channels` | `accountId` → `messaging_accounts`, `type` (`WHATSAPP`), `provider`, **`externalId`** (WhatsApp: `phone_number_id`), `displayPhoneNumber`, `verifiedName`, `qualityRating`, `codeVerificationStatus`, `nameStatus`, `accountMode?` (`SANDBOX`/`LIVE`), `limits` (JSON), `isEnabled`, `isDefault`, `providerMissingAt?`, `syncedAt`, `settings` (reopen-вікно, підпис) | **канал = номер телефону, синхронізований із Meta**, а не введений вручну (§4.13). `UNIQUE (provider, externalId)` серед не-`providerMissing` — номер не може бути у двох тенантів |
| `channel_contacts` | `channelId`, `displayName` (профільне ім'я), **`customerId?`** (nullable), `optIn` (джерело й час), `lastInboundAt` | замінює `CustomerChannelIdentity` з `chat.md`: контакт існує й без клієнта, привʼязка — окрема дія агента |
| `channel_contact_addresses` | `contactId`, `kind` (`phone` / `bsuid` / `parent_bsuid`), `value`, `UNIQUE (channelId, kind, value)` | аліаси при ротації додаються, не замінюються |
| `conversations` (+колонки) | `channelId`, `contactId`, `customerLastMessageAt` (час Meta від останнього вхідного), `assigneeId`, `resolvedAt` | відкрита розмова на контакт — частковий `UNIQUE (contactId) WHERE status <> 'RESOLVED'` |
| `chat_messages` (+колонки) | `direction`, `channelId`, `externalId`, `senderContactId`, `replyToId` / `replyToExternalId`, `failure` (JSON: код, заголовок, деталі), `sentAt`, `deliveredAt`, `readAt`, `attempts`, `providerMeta` (JSON: `pricing`, opaque id) | частковий `UNIQUE (tenant_id, channel_id, external_id) WHERE external_id IS NOT NULL`; `MessageStatus` + `SENDING`; `played` (голосове) → `READ` із прапорцем у `providerMeta` |
| `channel_webhook_events` | `channelId`, `receivedAt`, `body` (сире), `payloadHash UNIQUE (channelId, hash)`, `state` (`RECEIVED` / `PROCESSED` / `FAILED` / `PARKED`), `error` | під RLS (тенант уже відомий); retention за cron (пропозиція — 30 днів) |
| `channel_pending_statuses` | `channelId`, `externalId`, `status`, `occurredAt`, `payload` | статус, що випередив запис `external_id`; перевіряється при записі id і крон-підмітанням |
| `channel_templates` | `channelId`, `name`, `language`, `category`, `status`, `quality`, `components` (JSON), `parameterFormat`, `rejectedReason`, `syncedAt` | кеш, джерело правди — Meta |
| `channel_logs` | `channelId`, `type` (`receive` / `send` / `status` / `media_fetch` / `token` / `verify`), `request`/`response` (маскування), `durationMs` | retention; підтримка «у мене не працює WhatsApp» |
| `channel_unroutable_events` | **без `tenant_id`**, без RLS; `provider`, `keyHash`, `reason`, `ip`, `receivedAt` | запис лише через `SECURITY DEFINER`-функцію; читає лише platform-api; сире тіло не зберігається |

Відхилення від `chat.md`, зафіксовані тут: `CustomerChannelIdentity` → `channel_contacts` +
`channel_contact_addresses`; `chat_messages.senderCustomerId` → `senderContactId`;
`conversations.customerId` → через контакт (`contact.customerId`).

**Як збудовано в CHAT-2a (відхилення від таблиці вище).**
`channel_webhook_events` — **на акаунт**, а не на канал (одна доставка може називати кілька номерів), з
`UNIQUE (account_id, payload_hash)`, станами `RECEIVED/PROCESSED/FAILED/UNROUTABLE` і тілом як `text`.
`chat_messages` має ще `provider_sent_at` — час провайдера. Пошук акаунта за ключем вебхука — друга
SELECT-політика `webhook_key_lookup` на `messaging_accounts` + `resolve_account_by_key()` (під FORCE RLS
`SECURITY DEFINER` власника сам по собі нічого не бачить). Черга ingest — `standard`, без ключа на
відправника (порядок записує `seq`, провайдер його не гарантує, а `key_strict_fifo` блокувався б
постійно впалою роботою); коректність тримають часткові UNIQUE. Сирі байти — `express.raw`,
змонтований лише на `/api/public/channels/*` у `configureApp()`. FK з розмов/повідомлень на канал і контакт — `NO ACTION`
(не `RESTRICT`: каскад від тенанта, що скидає демо-тенанта, мусить проходити).

### 4.2. Контракт адаптера

`chat.md` §4.6 дає один інтерфейс; досвід fms-api (понад десять вузьких інтерфейсів провайдера) і
вимога W0.2 вимагають **розділити за можливостями**: ядро вимагає мінімум, решта — опційні
capability, які адаптер заявляє.

```ts
interface ChannelAdapter {
  readonly provider: string;                 // 'meta_cloud' | 'fake' | (пізніше) 'twilio'
  readonly type: ChannelType;                // 'WHATSAPP'
  readonly capabilities: ChannelCapabilities;

  /** Підпис над СИРИМИ байтами; адаптер сам знає схему (HMAC-SHA256 / інша) */
  verifyWebhook(req: RawWebhookRequest, creds: ChannelCredentials): boolean;
  /** GET-рукостискання (якщо провайдер його має) */
  handshake?(query: Record<string, string>, creds: ChannelCredentials): string | null;
  /** 0..N подій: провайдери батчать (Meta — до 1000 за POST) */
  parseWebhook(raw: Buffer, ctx: ParseContext): NormalizedEvent[];
  /** Кидає ChannelSendError з класом, див. §4.5 */
  send(ctx: OutboundContext): Promise<{ externalId: string }>;
}

interface ChannelCapabilities {
  freeformWindowHours?: number;              // 24 для WhatsApp; відсутнє = немає вікна
  templates: boolean;
  media: { inbound: boolean; outbound: boolean; maxBytes: Record<MediaKind, number>; mime: Record<MediaKind, string[]> };
  readReceipts: boolean;
  typingIndicator: boolean;
  reactions: boolean;
  maxTextLength: number;
}

// Опційні можливості — окремі інтерфейси, не частина ядра
interface TemplateCapability  { listTemplates(...): ...; /* пізніше: submit/edit/delete */ }
interface MediaCapability     { fetchInbound(ref, creds): Promise<Readable>; uploadOutbound(...): Promise<string> }
interface HealthCapability    { checkHealth(creds): Promise<ChannelHealth> }
interface ConnectionCapability{ validateCredentials(...): ...; subscribeWebhook(...): ...; unsubscribeWebhook(...): ... }
interface ReadReceiptCapability { markRead(externalId, opts: { typing?: boolean }, creds): Promise<void> }
```

`NormalizedEvent` — дискримінована об'єднана Zod-схема в `libs/contracts`: `message` (нормалізований
вміст), `status`, `template-status`, `channel-health`, `identity-change`, `echo`, `unsupported`. Усе
провайдерське (Graph-поля, `pricing`, `referral`) живе в `providerMeta`, ядро його не читає.

Реєстр — мапа `provider → adapter` (як `PaymentProvider` у `event-driven-architecture.md` §3.9).
**Першим пишеться `FakeChannelAdapter`** (той самий прийом, що `FakeLlmProvider`): детермінований,
вміє будь-який сценарій (статуси, відмови кожного класу, повтори, вікно), його вебхуки підписуються
тестовим секретом — тобто весь публічний шлях, **включно з перевіркою підпису**, обкатується без
акаунта Meta.

### 4.3. Вхід: вебхук

Два входи в один контролер: `/public/channels/:provider/:webhookKey` і
`/public/channels/:provider/app` (див. п.5 у §2).

1. **GET** (рукостискання): `webhookKey` → акаунт; `hub.verify_token` порівнюється з токеном
   *акаунта*, а не з глобальним секретом (fms-api порівнює з `kernel.secret`); відповідь — `hub.challenge`.
   Невідомий ключ → 403.
2. **POST**: потрібен `rawBody` і підвищений ліміт тіла (до 3 МБ) для цього маршруту.
   Ключ акаунта → `resolve_account_by_key()` (`SECURITY DEFINER`, за зразком `resolve_tenant(slug)`)
   → `runWith(tenantId)` → розшифрувати app secret акаунта (чи платформний) → **перевірити підпис над сирими байтами**.
   Підпис не пройшов → 401, нічого не пишемо. Ключ невідомий/канал вимкнений → **200** і запис у
   `channel_unroutable_events` (відповідь не має бути оракулом; і Meta не мучить ретраями 7 днів).
3. Для кожного `change` за `metadata.phone_number_id` знаходиться канал цього акаунта (`channels.externalId`); номера немає, вимкнений чи не цього акаунта →
   `UNROUTABLE` із причиною (а не мовчазне відкидання). `sender` береться **з кожного `change`**,
   не з `entry[0]`.
4. Одна `withTenantTx`: `INSERT channel_webhook_events` (з `payloadHash` як дешевий захист від
   дослівного повтору) → `publish(tx, channels.ingest-webhook, { eventId })` → коміт → **200**.
   «Отруйний» (валідно підписаний, але нерозбірний) payload теж отримує 200 і стан `FAILED` — інакше
   Meta повторює його 7 днів і може відключити підписку (урок courier).
5. **«Застосунковий» вхід** (`/app`) приймає те, що не можна перевизначити: шаблони й події акаунта.
   Маршрутизація — за WABA id (`channels.externalGroupId`), що може дати **кілька тенантів**
   (`resolve_channels_by_group()` повертає набір); кожному тенанту подія доставляється окремо.
6. Іменований rate limit `channel-webhook` (механіка AUTH-0, `RateLimit` + Redis) — щедрий,
   по ключу й IP: статусів приходить у ~3 рази більше за повідомлення.

Для `ingest` у воркері (`MessageInboxService.runOnce` — лише для БД-ефектів, дедуп — індекс):

1. розібрати події адаптером; для `message`: `INSERT … ON CONFLICT DO NOTHING RETURNING` по
   `(channel_id, external_id)` — повернутий рядок = нове; решта кроків (лічильники, емісія, публікація
   `chat.message-posted.v1`) лише за нього;
2. контакт → адреса (§4.6) → відкрита розмова контакту або нова (політика reopen, §7 O-W4);
   `customer_last_message_at = час Meta`;
3. `seq` через наявний інкремент-і-повернення (`chat.md` §4.3); вставка — тільки у `withTenantTx`;
4. медіа — рядок `PENDING` + `publish(tx, channels.fetch-media, …)` у цій же транзакції;
5. `status` → §4.4; `identity-change` → аліас; `template-status`/`channel-health` → свої обробники;
6. емісія у браузер — after-commit через headless-міст воркера (`chat.md` §3, §4.9).

Порядок вставки в межах одного контакту серіалізує `singletonKey = channelId:contactAddress`
(альбоми приходять паралельними вебхуками; Chatwoot для цього тримає Redis-мутекс з ретраями).

### 4.4. Статуси

- Знайти повідомлення за `external_id` **або** за `biz_opaque_callback_data` (наш id): другий шлях
  потрібен, коли статус випередив запис `external_id` (§4.5).
- Рух — одним атомарним оператором: `UPDATE … SET status = $n WHERE rank($n) > rank(status)`,
  шкала `QUEUED < SENDING < SENT < DELIVERED < READ`; **`FAILED`** — виняток (портується `supersedes()`
  з fms-api): не перекриває `DELIVERED`/`READ`, запізнілий `SENT` не скасовує `FAILED`. Помилка
  пишеться лише якщо статус справді рухнувся, і очищається пізнішим доказом доставки.
- Не знайшли повідомлення → **паркування** в `channel_pending_statuses` (а не «тихе відкидання»);
  перевіряється при записі `external_id` і крон-підмітанням з обмеженим числом спроб.
- Зберігаємо блок `pricing` (`type`, `category`) і `conversation` (якщо є) у `providerMeta`.
- Подія в браузер — `chat.message-updated.v1` (`chat.md` §4.8): «перечитай» без стану.

### 4.5. Вихід

```
POST /conversations/:id/messages (body | template | media, clientMessageId)
  → access + adapter.canSendFreeform(conversation, now)  → 422 CHANNEL_WINDOW_CLOSED (швидка відповідь)
  → withTenantTx: INSERT chat_messages(QUEUED, seq, clientMessageId) + лічильники
                  publish(tx, channels.deliver-outbound, { messageId }, { singletonKey: conversationId })
                  onCommit → емісія
  → 201, рядок у QUEUED
воркер deliver-outbound:
  1) UPDATE … SET status='SENDING', attempts=attempts+1 WHERE id=$1 AND status IN ('QUEUED','SENDING')
  2) повторна перевірка вікна (авторитетна: чергу можна було прочекати до 23:59→00:01)
  3) adapter.send() із таймаутом; opaque id = id повідомлення
  4) успіх → external_id + SENT; помилка → клас (нижче)
```

**Класи помилок** (адаптер мапить коди провайдера; тут — Meta, класифікація наша, звірити з Meta):

| Клас | Коди Meta | Дія |
| --- | --- | --- |
| `WINDOW_CLOSED` | 131047 | `FAILED`, UI пропонує шаблон; не ретраїти |
| `PERMANENT` | 131026 (не WhatsApp-номер), 131008/131009/100/135000 (параметри), 132000/132001/132012/132016/132018 (шаблон), 131053/131052 (медіа) | `FAILED` з кодом, не ретраїти |
| `POLICY` | 131049 (ліміт маркетингу), 131050 (відписка від маркетингу), 130497 | `FAILED`; 131049 — не раніше ніж за 24 год |
| `RATE_LIMITED` | 130429, 131056, 80007 | ретрай із бекофом (`Retry-After`/4^X с для 131056) |
| `AUTH` | 190, 0, 3, 10 | акаунт → `NEEDS_REAUTH`, сповіщення адміну, повідомлення лишається `QUEUED` до відновлення |
| `TRANSIENT` | 131000, 131016, 131057, 133004, 5xx, таймаут | ретрай із бекофом |
| `HUMAN` | 131048, 131031, 130403, 131042, 131045 | `FAILED`, канал → стан з поясненням |

**Дірка «впав між викликом Meta і записом `external_id`»** — єдина невідворотна для at-least-once.
Політика (чесна, не прихована): повторна доставка job-а на рядок `SENDING` без `external_id`
**не шле наосліп**; вона чекає вікно (~60 с) на статус із нашим opaque id, який виставить
`external_id`; якщо його немає — рядок стає `FAILED(outcome_unknown)` і агент бачить «не вдалося
підтвердити, відправити ще раз?» з явною дією. Місце `biz_opaque_callback_data` у тілі відправки в
локальній документації не підтверджене (§8) — звірити першим.

**Порядок.** `chat.md` §4.10 пропонує `key_strict_fifo`. Meta порядок не гарантує, тому FIFO дає
лише порядок *відправки*, а ціна — блокування розмови. Рекомендація (O-W3): залишити FIFO по розмові,
але **обробник ніколи не кидає на постійних помилках і сам переводить рядок у `FAILED` після N
спроб (лічильник `attempts` у рядку)** — тоді ключ не зависає назавжди, а EDA-2 перестає бути жорсткою
передумовою (лишається бажаною для «застряглих» job-ів).

### 4.6. Ідентичність і клієнти

- Адреса зберігається **як прийшла** (`wa_id`), додатково — нормалізована E.164 через
  `libphonenumber-js` (залежність уже є в `apps/api` і `libs/contracts`, правила пари —
  `apps/api/src/common/phone.ts`). Пошук — за списком кандидатів (BR 9-та цифра, MX `521`);
  синтетичних аліасів там, де це міг би бути інший абонент (AR `549`), не створюємо.
- Для нового контакта кілька ідентифікаторів у вхідному: пріоритет телефон → BSUID → батьківський
  BSUID; якщо контакт уперше зʼявився лише з BSUID, історія лишається за BSUID.
- Подія `user_changed_number` / `user_id_update` → **аліас** до наявного контакта; конфлікт кількох
  контактів — лог і задача людині, автоматичного злиття **немає**.
- Привʼязка до `customers`: автоматично лише коли **рівно один** клієнт має цей номер
  (`customers.phone`/контакти); інакше контакт «не привʼязаний», агент привʼязує або створює
  клієнта з розмови. Автосторення клієнта з невідомого номера — ні (O-W5).
- Авторизаційні шаблони не можна слати на BSUID-only контакт — перевірка в `send`-гарді.

### 4.7. Доступ до клієнтських розмов

Функція доступу лишається **одна** (`ConversationAccessService`). Для `kind = CUSTOMER`
вмикається гілка `access = 'tenant'`, яку `chat.md` §4.4 свідомо відклала «до появи сценарію» —
сценарій тепер є: клієнтську розмову бачать усі активні користувачі тенанта, поки немає RBAC
(O-W1). Участь (`conversation_participants`) для таких розмов означає «займається» — призначений
і той, хто відповідав; персональні непрочитані з'являються в момент призначення/відповіді
(`chat.md` §4.3, «нюанс shared inbox»), черга «нерозібраних» — це фільтр `assigneeId IS NULL`.
Внутрішні розмови лишаються `private` без змін. Негативний e2e: користувач тенанта B не бачить розмову
тенанта A (RLS), а в межах тенанта internal-канали лишаються приватними.

### 4.8. Медіа

Вхідне: повідомлення зберігається одразу з `media: PENDING` → job `channels.fetch-media`: взяти URL
(або перезапитати — він живе 5 хв), стрім з Bearer-токеном, перевірка розміру й `sha256`,
magic bytes (`file-type`, як у Files v1), `StorageService.putObject` + `File` одразу `READY` +
рядок `attachments (entityType='chat_message')`; термінальні `FAILED`/`EXPIRED`; код `401` →
акаунт у `NEEDS_REAUTH`. Строки життя беремо з документації Meta (id у вебхуці — 7 днів), не
вгадуємо. Вихідне: файл завантажується звичайним presigned-потоком у наш S3, воркер вантажить його
в Meta (`POST /{phone-number-id}/media`) і шле за `id`, а не за посиланням (посилання кешується
10 хв, а `131053` залежить від ASN) — `id` кешується для повторних шаблонів із медіа-хедером.
Таблиця форматів і лімітів (аудіо — лише Ogg/OPUS mono, відео — H.264+AAC, зображення 5 МБ …) —
у `capabilities.media` і в [довіднику](whatsapp-research/meta-cloud-api.md) §4.

### 4.9. Шаблони

Кеш `channel_templates`: курсорна синхронізація за cron + події `message_template_status_update`,
`…quality_update`, `template_category_update`, `…components_update` (приходять на «застосунковий»
вхід). Вибір шаблону в композері: мова, змінні (іменовані `{{name}}` і позиційні `{{1}}`), хедер
з медіа, кнопки (URL, quick reply). Захисти відправки: шаблон існує, `APPROVED`, не на паузі,
змінні заповнені, категорія сумісна з контактом (авторизаційний — не BSUID-only), канал не в
`NEEDS_REAUTH`. Створення/редагування шаблонів із CRM — пізніше (O: перший реліз — шаблони
створюють у Meta Business Manager, CRM їх синхронізує).

### 4.10. Здоров'я каналу і оператор

- Job `channels.check-health` (cron): якість номера, ліміт охоплення, статус, пропускна здатність;
  код `190` → акаунт `NEEDS_REAUTH` (UI показує банер «перепідключити», як `Reauthorizable` у Chatwoot).
- Журнал `channel_logs` на кожен HTTP-виклик до провайдера (секрети замасковані).
- У platform-web: перегляд `channel_unroutable_events`, `channel_webhook_events` у стані
  `FAILED`/`PARKED`, **replay** (CLI + кнопка) — безпечний завдяки індексу дедупу.
- Cron-чистки: сирі події (30 днів), логи, запаркована черга.

### 4.11. Безпека

- Секрети каналу — у зашифрованій колонці (`CryptoService`), у відповідях API маскуються
  (останні 4 символи, як `secretHint` для AI-ключа); ніколи в логах.
- Підпис обов'язковий для **кожного** каналу (на відміну від Chatwoot, де ручний канал без секрету
  пропускає перевірку): якщо секрету нема, канал не активується.
- Один номер — один тенант: унікальний індекс + перевірка токена віддалено під час підключення
  (запит до Graph із введеним токеном має повернути саме цей `phone_number_id`).
- Retention сирих payload-ів і PII: §7 O-W8. Видалення клієнта анонімізує його повідомлення
  (за зразком `customers.md`).
- E2E: підпис не пройшов → нічого не записано; тенант A не може отримати payload тенанта B;
  повторний `Promise.all` однакового `external_id` → один рядок.

### 4.12. Як Twilio сяде на цей шов

Для другого провайдера міняється **лише** адаптер і вміст `credentials`/`provider`:

| Що | Хто відповідає |
| --- | --- |
| формат тіла (Meta — JSON; Twilio — `application/x-www-form-urlencoded`), схема підпису, рукостискання | `verifyWebhook` / `handshake` / `parseWebhook` адаптера — це чому ядро передає **сирі байти** і `content-type`, а не розібраний JSON |
| ключ маршрутизації (`webhookKey` у URL — універсальний; зовнішні id — `externalId` акаунта й каналу) | колонки каналу, типи ключів провайдеро-нейтральні |
| шаблони (Twilio має свій механізм) і їхні статуси | `TemplateCapability` + нормалізовані `template-status` |
| словник статусів і помилок | адаптер мапить у наші `NormalizedStatus` і класи помилок (§4.5) |
| вікно, ліміти, вартість | `capabilities` і `providerMeta` |

Про Twilio тут лише контур (деталі їхнього API **не перевірені** — Recalled). Доказ готовності шва —
**набір контракт-тестів адаптера** (`libs/shared/src/channels/adapter.contract.ts`), який проганяється
проти `fake` і `meta_cloud`; другий реальний провайдер має пройти той самий набір без змін ядра.

### 4.13. Підключення акаунта і синхронізація номерів

Налаштування тенанта (адмін): **один WhatsApp Business Account на тенанта** (WABA id, токен, app secret).
Номери не вводяться руками — вони **синхронізуються з Meta**, а адмін лише вмикає потрібні.

1. **Зберегти** WABA id і токен → `messaging_accounts` (`status = CONNECTED` лише після п.2).
2. **Перевірити токен** (`GET /debug_token`): `is_valid`, тип, `expires_at`, `scopes` мають містити
   `whatsapp_business_management` і `whatsapp_business_messaging` (§4.14); перевірити доступ до WABA
   (`GET /{waba-id}`) — помилка `200` означає, що системний користувач не має доступу до цього WABA.
3. **Синхронізувати номери:** `GET /{waba-id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,throughput` з курсорною
   пагінацією → upsert у `channels` за `externalId`. Новий номер зʼявляється з `isEnabled = false`;
   зниклий у Meta — `providerMissingAt` (канал із розмовами **не видаляється**; у fms-api force-delete
   каскадно знищує розмови). Той самий job (cron + кнопка «Оновити») оновлює якість і ліміти — окремого
   health-job для номерів не потрібно.
4. **Підписка на вебхук — явна дія**, а не побічний ефект збереження (урок `e996dcd8`): `POST
   /{waba-id}/subscribed_apps` з `override_callback_uri` = URL акаунта (`/public/channels/meta_cloud/{webhookKey}`);
   стан читається назад (`GET …/subscribed_apps`) і показується в UI. Підписка на рівні WABA означає,
   що **ключ вебхука належить акаунту**, а вибір каналу всередині — за `phone_number_id`.
5. **Увімкнути номер** (`isEnabled`), один зробити `isDefault` (для виходу без вибору номера).

Тестовий акаунт і номер Meta проходять той самий шлях; `accountMode = SANDBOX` (якщо поле віддається),
і працює лише до 5 отримувачів із allow-списку (помилка `131030` поза ним). Чи приймає тестовий WABA
`subscribed_apps` з перевизначенням — **перевіряється першим на живому акаунті** (§8): якщо ні, для
тесту вебхук задається один раз на рівні застосунку в Meta-дашборді, а маршрутизація лишається за
`phone_number_id`.

**Що взято з fms-api (`MessagingAccount` → `MessageSender`) і що ні.** Дворівнева модель
«акаунт → відправники», синхронізація upsert-ом за зовнішнім id, окрема явна підписка на вебхук,
«перевірка зʼєднання» — беремо. Не беремо: WABA id всередині зашифрованого JSON (звідси
`WhatsAppAccountLocator`, що завантажує **всі** акаунти й розшифровує кожен); «глобальні» акаунти без
тенанта, що розмили межу (інцидент `3e67a5e7`); побічні ефекти CRUD акаунта на підписку; токен без типу й
терміну дії; метадані номера як JSON із валідацією замість колонок; реєстрацію номера з CRM
(`request_code`/`verify_code`/PIN — робиться в Meta Business Manager) і каскадне видалення.

### 4.14. Токен доступу: варіанти

Meta (`access-tokens.md`) розрізняє: **тимчасовий токен користувача** (панель «API setup» у дашборді,
генерується заново при кожному відкритті; «закінчується швидко, перегенеровувати треба кожні кілька
годин»; лише для першого тестового повідомлення — спостережені 15 хв у документації не підтверджені,
але узгоджуються з «швидко»), **токен системного користувача** (Business settings → System users;
довгоживучий, при створенні обирається строк дії; `debug_token` показує `expires_at: 0` для
безстрокового) і **токен Business Integration System User** (лише після Embedded Signup).

| Варіант | Як працює | Плюси | Мінуси |
| --- | --- | --- | --- |
| **A. Токен системного користувача (рекомендовано для всього, включно з тестовим акаунтом)** | у Business settings створити admin system user, призначити застосунок (Manage app) і WABA, згенерувати токен із `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`; вставити в налаштування | не спливає (або дає знати про строк); той самий шлях у тесті й проді; `debug_token` дає тип/термін/права | потрібен один раз пройти налаштування в Meta; треба зберігати як секрет |
| **B. Тимчасовий токен лише як «димовий тест»** | дозволити вставити, `tokenKind = temporary`, показувати зворотний відлік; після спливу акаунт автоматично `NEEDS_REAUTH` | швидко перевірити зв'язок за 5 хв | синхронізація, відправка й вебхуки перестають працювати через хвилини-години; не може бути джерелом правди |
| **C. Токен лише в `.env` для dev** | `META_DEV_TOKEN` у `.env.local` | не треба UI | другий шлях конфігурації, який не тестує справжній; ризик витоку |
| **D. Обмін тимчасового на довгий користувацький** (`fb_exchange_token`, Recalled) | кнопка продовження | менше ручної роботи | токен привʼязаний до людини, не до бізнесу; губиться при зміні пароля/виході; не для сервісу |
| **E. Embedded Signup** (пізніше) | код → токен Business Integration System User | кожен клієнт підключає себе сам | потрібен статус Tech Provider і App Review (§7 O-W2) |

Повна підготовка в Meta (застосунок, WABA, секрет, вебхук, тестовий номер) — [whatsapp-feature-flows.md](whatsapp-feature-flows.md) §F0.

**Що з цього бачить продукт.** Складність варіанта A — не в нашому коді, а в разовому налаштуванні на
боці Meta. У налаштуваннях тенанта лишається одна інтеграція і три поля: **WABA id**, **токен**,
**app secret** (потрібен лише для перевірки підпису вебхука; запасний — платформний). Адреса вебхука
й токен рукостискання генеруються нами й показуються в тому ж екрані.

**Разове налаштування в Meta для A** (за `access-tokens.md`; хто володіє бізнес-портфелем — один раз):
1. Business settings (`business.facebook.com/settings`) → **System users** → **Add**: імʼя, роль
   **Admin** (бачить усі WABA портфеля) або **Employee** (лише призначені).
2. У користувача → **Assign assets** → вибрати застосунок → право **Manage app**.
3. Для ролі Employee додатково: Accounts → WhatsApp Accounts → потрібний WABA → **Add people** → цей
   system user.
4. **Generate token**: вибрати застосунок, строк дії, права `business_management`,
   `whatsapp_business_management`, `whatsapp_business_messaging` → скопіювати токен (показується раз).
5. WABA id — у WhatsApp Manager / Business settings → WhatsApp Accounts; app secret — App dashboard →
   Settings → Basic.

Усе це замінює Embedded Signup, коли клієнт не технічний (кнопка «Підключити через Facebook»; пізніше).

**Рекомендація:** A як єдиний «справжній» шлях; B дозволити з явним бейджем «тимчасовий» і
відліком — щоб перший зв'язок можна було перевірити без Business settings; C, D не робити.
Реалізація навколо токена: `debug_token` при збереженні і щодоби (`tokenCheckedAt`), сповіщення
адмінові за 7 днів до `tokenExpiresAt`, код `190` → `NEEDS_REAUTH` (повідомлення лишаються `QUEUED`), токен
ніколи не повертається API (лише маска — останні 4 символи) і не потрапляє в `channel_logs`.
**Звірити першим на вашому тестовому акаунті:** який саме тип і строк має наявний токен, чи доступний
для тестового WABA system user.

---

## 5. Каталог фіч WhatsApp

Рівні: **О** — обов'язково, **Р** — рекомендовано, **П** — пізніше, **Н** — ні. Фази — §6.

### Вхідні повідомлення

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| text | О | 2a/3a | |
| image / video / audio (голосові) / document / sticker | О | 2c/3b | `voice`-прапорець; сервер копіює файл (§4.8) |
| location | О | 3a | карточка з посиланням на карту |
| contacts (vCard) | Р | 3a | карточка; дія «створити клієнта» — пізніше |
| reaction (вхідна) | О | 3a | прикріплюється до цільового повідомлення, не окрема бульбашка; `emoji` відсутній = зняття |
| interactive `button_reply` / `list_reply`, quick-reply кнопка шаблону | О | 3a | як текст із підписом; `payload` у `providerMeta` |
| `context` (відповідь на повідомлення), `forwarded` | О | 3a | цитата в бульбашці, бейдж «переслано» |
| unsupported / placeholder (`131051`, `131060`, `edit`) | О | 3a | рядок-заглушка, щоб стрічка не мала дірок |
| системні події ідентичності (`user_changed_number`, `user_id_update`) | Р | 3c | аліас, §4.6 |
| `referral` (click-to-WhatsApp) | Р | 3c | зберігаємо; карточка «з реклами» |
| `edit` / `revoke` (лише Coexistence) | П | — | |
| `order`, каталоги, Flows (`nfm_reply`), опитування | П | — | до того — плейсхолдер |
| групи | Н | — | Groups API поза продуктом |

### Вихідні повідомлення

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| text (до 4096), відповідь із `context` | О | 2b/3a | 422 `CHANNEL_WINDOW_CLOSED` поза вікном |
| template (хедер-медіа, змінні, кнопки) | О | 3b | єдиний спосіб писати поза вікном |
| image / video / audio / document за `id`, підпис, ім'я файлу | О | 3b | ліміти й MIME — з `capabilities` |
| mark as read (сині галочки) + **індикатор набору** | Р | 3a | на перегляд агентом; індикатор живе до 25 с або до відповіді |
| location, reaction (вихідні) | Р | 3b | |
| interactive: reply buttons, list, cta_url | П | — | швидкі дії агента, лише у вікні |
| contacts, sticker (вихідні) | Н | — | |

### Статуси й облік

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| sent / delivered / read / failed / played | О | 2b/3a | §4.4 |
| помилка з кодом, заголовком і деталями у `failure` | О | 3a | UI показує людську причину за кодом (i18next) |
| `pricing` / `conversation` зі статусів | О | 3a | зберігати з першого дня |
| облік вартості по каналу й тенанту, звірка | П | — | модель `NUMERIC`, правило 22 AGENTS.md |

### Шаблони

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| синхронізація, статуси, якість, паузи, перекласифікація | О | 3b | |
| вибір у композері, змінні (іменовані й позиційні), хедер-медіа, URL/quick-reply | О | 3b | |
| створення/редагування/видалення з CRM, resumable upload хедера | П | — | першим релізом — Meta Business Manager |
| TTL, карусель, LTO, купони, MPM, call-permission, Flows | Н | — | |
| авторизаційні шаблони (OTP одноразового коду) | П | — | окремий сценарій (2FA, `auth-hardening-plan.md`); BSUID не підтримується |

### Канал і експлуатація

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| підключення акаунта в налаштуваннях тенанта: WABA id, токен, app secret; перевірка токена (`debug_token`); явна підписка на вебхук; **синхронізація номерів із Meta** | О | 3a | §4.13, §4.14 |
| Embedded Signup | П | — | потрібен статус Tech Provider і App Review |
| здоров'я: якість, ліміт охоплення, пропускна здатність, `NEEDS_REAUTH` | Р | 3c | |
| журнал викликів `channel_logs` | Р | 2c | |
| згода/відписка: запис `optIn`, вебхук `user_preferences`, код `131050` | Р | 3c | блокує маркетингові шаблони на відписаний контакт |
| реєстрація номера, PIN, ім'я, бізнес-профіль із CRM | Н | — | робиться в Meta Business Manager (fms-api будував це окремим великим шматком) |
| Coexistence (номер одночасно в додатку WhatsApp Business), історія | П | — | вебхуки `smb_message_echoes`, `history` |
| Calling, Payments, Catalogs, Groups, Business AI, Marketing Messages Lite | Н | — | |
| Direct Send API (бета, utility без попередньо створеного шаблону) | П | — | стежити за GA |

### Робочий процес

| Фіча | Рівень | Фаза | Примітка |
| --- | --- | --- | --- |
| політика reopen: вхідне відкриває закриту розмову в межах вікна, старше — нова (за замовчуванням 24 год у `channels.settings`) | О | 2b | |
| статуси `OPEN` / `PENDING` / `RESOLVED`, призначення, черга «нерозібраних», внутрішні нотатки | О | 2b | `SNOOZED` — ні |
| привʼязка контакта до клієнта, «створити клієнта з розмови» | О | 2a | |
| сповіщення про вхідне (призначеному / у чергу) | О | 0.2c/2a | |
| швидкі відповіді, автопривітання, робочі години | П | CHAT-4 | |
| масові розсилки | П | CHAT-4 | потребують згоди, лімітів охоплення, пейсингу |
| CSAT-опитування, бот і передача людині, AI-чернетки | П | CHAT-4 | AI-автовідповіді — після відповіді на O-W7 |
| атрибуція реклами | П | — | `referral` уже зберігається |
| fake-адаптер, симулятор вхідних, фікстури реальних payload-ів | О | 2a | основа тестів і демо |

---

## 6. Фази

Нумерація зберігається (`CHAT-0`, `CHAT-2` цитуються в `docs/ai-assistant.md` і коді). Замінюється
таблиця `chat.md` §7.3, починаючи з `0.2c`.

| Фаза | Обсяг | Передумови |
| --- | --- | --- |
| **CHAT-0.2c — сповіщення** (звужена) | `chat.message_received` із колапсом по розмові, подія `chat.message-posted.v1` і перший підписник `chat-notify` у воркері, `markReadByTarget`. **Знято: presence-крапка** (задача 5.2 та вимога `chat/area` у change). Саме цей шов потім використовує вхідне з каналу | `0.2b` |
| ~~CHAT-0.3~~ | **Знято як фаза.** Вкладення переїжджають у `2c`; керування учасниками замінюється призначенням (`2b`); згадки, `notification_level`, редагування/видалення внутрішніх реплік — відкинуто (W0.3) | — |
| ~~CHAT-1~~ | **Знято як окрема фаза.** Мінімум (статуси `OPEN/PENDING/RESOLVED`, призначення, нотатки, черга) входить у `2b`; `SNOOZED`, SLA, авто-маршрутизація → `CHAT-4` | — |
| **CHAT-2a — клієнтська розмова на fake-каналі: вхідне** *(збудовано 2026-10-13: код, міграція й тести в `openspec/changes/chat-2a-channel-inbound`; жива перевірка на dev-стенді — задачі 9.x)* | схема §4.1; **блок «Вебхук» акаунта** (адреса з `CHANNEL_WEBHOOK_BASE_URL`, verify token, час останнього вебхука, лічильники за 24 год — працює й на fake; сама підписка в Meta — 3a, §F3); `FakeChannelAdapter`; публічний вебхук (ключ каналу, підпис, рукостискання, сире сховище, `unroutable`); ingest із дедупом; контакти й адреси; привʼязка до клієнта; гілка `access = 'tenant'` для `CUSTOMER`; фільтри «мої / нерозібрані / всі»; **симулятор вхідних** (dev-ендпоінт + CLI `pnpm chat:simulate`); UI: канал у списку, картка контакта, привʼязка клієнта. Іменований rate limit | `0.2c`, `customers` (є) |
| **CHAT-2b — відповідь** | вихідна черга `QUEUED → SENDING → SENT/FAILED`, вікно (422 + перевірка у воркері), класи помилок, статуси вперед, паркування, галочки в бульбашці, reopen, `OPEN/PENDING/RESOLVED`, призначення, внутрішні нотатки, системні події + `activities` | `2a` |
| **CHAT-2c — медіа й оператор** | вкладення в обидва боки (пайплайн §4.8 на fake), `channel_logs`, перегляд подій у platform-web, replay, retention-крони, контракт-тести адаптера | `2b` |
| **CHAT-3a — WhatsApp: зв'язок і текст** | `MetaCloudAdapter`; підключення акаунта (WABA id, токен) з перевіркою, явна підписка, синхронізація номерів; підпис і рукостискання; усі вхідні типи §5; статуси й `pricing`; вікно; текст, `context`, mark-as-read + індикатор набору; таксономія помилок Meta; ручна перевірка на публічному тестовому номері | `2c` |
| **CHAT-3b — шаблони й медіа** | синхронізація й вебхуки шаблонів, вибір у композері, змінні, медіа-хедер; медіа Meta (fetch/upload, ліміти); локація й реакція | `3a` |
| **CHAT-3c — експлуатація** | здоров'я, `NEEDS_REAUTH`, згода/відписка, події ідентичності й аліаси, `referral`-карточка, ранбук (токен, підписка, тестовий номер) | `3b` |
| **CHAT-4 — зрілість** | пошук (`tsvector` + GIN), швидкі відповіді, автопривітання/робочі години, SLA, `SNOOZED`, розсилки, CSAT, бот/AI, облік вартості, Embedded Signup, Coexistence | — |

**Принцип зрізів** (як у `chat.md` §7.2): кожен завершується екраном, який можна показати. Після `2a`
видно вхідне від симулятора у спільній скриньці; після `2b` — повний діалог із галочками на fake;
після `3a` — справжнє повідомлення з телефону на тестовому номері.

**Інваріанти, які закладаються в `2a`** (відкласти дорожче за їх запис): `provider` окремо від
`type`; сирі байти й `content-type` у контракті адаптера; частковий UNIQUE по `external_id`;
`SENDING` у шкалі статусів; `customer_last_message_at` із часу провайдера; контакт без клієнта;
кілька адрес на контакт; `channel_unroutable_events` без тенанта.

**Передумови:** `customers` — є; `ENCRYPTION_KEY`/`CryptoService` — є; rate limiting — механізм є
(`libs/shared/src/auth/throttler`, потрібен лише новий іменований ліміт; запис «rate limiting відсутній»
у `chat.md` §5 п.7 застарів); **EDA-2** — знижується з обов'язкової до бажаної за умови з §4.5
(O-W3).

---

## 7. Відкриті питання (потрібне рішення власника)

**Рішення власника 2026-10-13:** O-W1…O-W5 прийняті **як рекомендовано** (позначені ✓ — рекомендація стала рішенням). O-W6…O-W9 відкриті; жодне не блокує CHAT-2a.

| # | Питання | Рекомендація |
| --- | --- | --- |
| **✓ O-W1** | Хто бачить клієнтські розмови | усі активні користувачі тенанта (`access = 'tenant'`); видимість за каналами/командами — з RBAC |
| **✓ O-W2** | Модель Meta-додатка: свій застосунок у кожного тенанта чи один застосунок оператора платформи | перший реліз — ручні credentials (app secret — в акаунті тенанта, запасний платформений); Embedded Signup — після отримання статусу Tech Provider |
| **✓ O-W3** | `key_strict_fifo` по розмові + EDA-2 як бажана, чи best-effort порядок | FIFO з обробником, що не зависає (§4.5) |
| **✓ O-W4** | Політика reopen (існує як Q3 у `chat.md` §8) | 24 год у `channels.settings`; одна відкрита розмова на контакт |
| **✓ O-W5** | Автостворення клієнта з невідомого номера | ні; контакт «не привʼязаний», агент привʼязує або створює |
| O-W6 | Показувати тенантам вартість повідомлень | пізніше; зберігаємо дані вже зараз |
| O-W7 | AI-автовідповіді в WhatsApp і політика Meta для «AI-провайдерів» (діє з 2026-02-16, оновлена 2026-05-12; сторінку з деталями не отримано) | заблоковано до перевірки політики; чернетки для агента (людина натискає «надіслати») — окреме питання до тієї ж політики |
| O-W8 | Retention сирих payload-ів і PII, видалення за запитом (GDPR) — розширює Q5 у `chat.md` | сирі події 30 днів; транскрипт — за політикою тенанта |
| O-W9 | Як фіксується згода (opt-in) для шаблонів | поле `optIn` контакта з джерелом (вхідне від клієнта = згода на сервісні; маркетинг — окремий запис) |

---

## 8. Звірити перед реалізацією

Не підтверджено локальною документацією або суперечить собі (деталі — «Unverified» у
[довіднику](whatsapp-research/meta-cloud-api.md)):

1. 13 сторінок Meta збереглися як 404, зокрема `pricing/ai-providers`, `get-started`,
   `direct-send/get-started`, `webhooks/reference/pricing`, `business-phone-numbers/ai-enabled-numbers`.
2. Де саме в тілі відправки стоїть `biz_opaque_callback_data` (Recalled — верхній рівень); від цього
   залежить схема примирення в §4.5.
3. Чи підписувати HMAC саме над сирими байтами (так і Recalled), і поведінка екранування не-ASCII.
4. Чи працює відправка за BSUID (`recipient`) — changelog каже «з липня 2026», розділ ще «coming soon».
5. Чинна ціна сервісних повідомлень після 2026-10-01 (rate card, опублікований до 2026-09-01). Окремо: чи існує щомісячна безкоштовна квота 1000 на номер (лише сторонні джерела).
6. Ліміт отримувачів тестового номера (5) — одне джерело.
7. Чи існує API видалення/редагування *наших* відправлених повідомлень (у локальних доках немає).
8. Усе про Twilio — Recalled.
10. **Вебхук на спільному WABA/застосунку.** Callback на WABA — один; app у нас спільний з fms-api, а на тестовому WABA уже стоїть override fms. Перевірити першим у 3a: чи працює перевизначення **на рівні номера** (`webhook_configuration.override_callback_uri` на `/{phone-number-id}`; за документацією пріоритет номер > WABA > застосунок) на тестовому номері — тоді наш номер піде на наш URL, не чіпаючи WABA. (R — механіку виклику й наявність на тестовому номері не перевірено.) Запасні варіанти: окремий тестовий номер/WABA для нас; relay. Номер, який використовує fms, не можна брати для нас без домовленості.
9. ~~На живому тестовому акаунті~~ (закрито частково — §8.1; лишилось: `POST subscribed_apps`, відправка, вебхук): тип і строк чинного токена (`debug_token`); чи приймає тестовий WABA `subscribed_apps` з `override_callback_uri`; чи віддає `/{waba-id}/phone_numbers` тестовий номер і поле `account_mode`; чи доступний для нього system user; точний набір `fields` для списку номерів.

### 8.1. Результати живої проби (2026-10-13, `pnpm whatsapp:probe`) — повна таблиця API й особливостей: [whatsapp-research/live-probe-2026-10-13.md](whatsapp-research/live-probe-2026-10-13.md)

Тестовий WABA «Test WhatsApp Business Account», app `kolvix masseging`, Graph v23.0:

| Питання | Результат |
| --- | --- |
| Токен | `SYSTEM_USER`, `is_valid`, `expires_at: 0` (безстроковий), `app_id` збігається. Scopes: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging` (+ `manage_app_solution`, `whatsapp_business_manage_events`). Системний користувач для тестового WABA **доступний** — варіант A працює |
| `GET /{waba}` | працюють усі запрошені поля: `name`, `timezone_id`, `message_template_namespace`, `account_review_status: APPROVED`, `business_verification_status: verified`, `health_status` |
| `GET /{waba}/phone_numbers` | віддає тестовий номер: `+1 555-000-0001`, `status: CONNECTED`, `quality_rating: GREEN`, `name_status: APPROVED`, **`account_mode: LIVE`**, `platform_type: CLOUD_API`, `throughput.level: STANDARD`, `code_verification_status: NOT_VERIFIED`. Усі запитані `fields` прийняті |
| `GET /{waba}/subscribed_apps` | повертає `override_callback_uri` на рівні WABA — **поле існує і читається**. Запис (`POST`) на цьому WABA ще не перевірено |
| `GET /{waba}/message_templates` | 25 шаблонів, усі `APPROVED` (+ `hello_world`, `jaspers_market_*`) |
| `health_status` | `can_send_message: BLOCKED` на рівні WABA, код **141006**: помилка способу оплати, «блокує розмови, ініційовані бізнесом». Бізнес і app — `AVAILABLE`. Тобто **надсилання шаблонів (поза вікном) на цьому WABA, найімовірніше, не спрацює**, доки не додано спосіб оплати; відповіді у відкритому вікні 24 год — не перевірено |

**Обережно — спільний WABA.** У `subscribed_apps` уже стоїть `override_callback_uri` на
`fms-dev.example.net:8443/api/public/webhooks/whatsapp` — цей тестовий WABA використовує fms-api. Один WABA має
**один** `override_callback_uri` на застосунок: наш `POST /{waba}/subscribed_apps` з іншим URI **зніме вебхуки
fms-dev**. Не викликати без домовленості; для нашого тесту — окремий тестовий WABA/номер, або тимчасово
перенаправити і потім повернути значення (збережено в цьому записі).

Наслідки для плану: `account_mode` і `health_status` синхронізація отримує; `health_status` треба відображати в
стані каналу (§4.10, F19) — на ньому видно блокування оплатою, `errors[].error_code` + `possible_solution`.

**Відправка (2026-10-13).** `POST /{phone-id}/messages` з шаблоном `hello_world` на номер зі списку отримувачів
→ HTTP 200, `message_status: "accepted"`, `messages[0].id = wamid.…`, `contacts[].wa_id` повернувся. Тобто Meta **прийняла**
повідомлення попри `health_status: BLOCKED` (141006). Це лише синхронна відповідь «прийнято»: фактичну
доставку (`sent/delivered/read` або `failed` з кодом) показує лише вебхук — його ще не перевірено. Перевірити
на пристрої отримувача, що повідомлення дійшло.

**Текст у відкритому вікні (2026-10-13).** Отримувач написав на тестовий номер першим → відкрилося вікно 24 год →
`POST /{phone-id}/messages` з `type: text` (`text.body`, `biz_opaque_callback_data` на верхньому рівні тіла) →
HTTP 200, `messages[0].id = wamid.…`, `contacts[].wa_id`. На відміну від шаблону, у відповіді на текст **немає поля
`message_status`** — адаптер не має на нього спиратись як на ознаку успіху (успіх = 2xx + `messages[0].id`).
Цей виклик іде **попри** `health_status: BLOCKED` (141006) — тож блокування оплатою відповідей у вікні не
зачепило. `biz_opaque_callback_data` Meta прийняла на верхньому рівні (повернеться у вебхуку — перевірити).

---

## 9. Що не робимо

Неофіційні протоколи (Baileys, whatsapp-web.js, WAHA-engines) — ризик блокування номера; другий
канал до появи реального сценарію; портал і віджет (рішення `chat.md` §1); Groups, Calling,
Payments, Catalogs; реєстрація номера й бізнес-профіль із CRM; «клієнт друкує…» (Meta цього сигналу
не віддає).
