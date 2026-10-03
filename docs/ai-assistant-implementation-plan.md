# Технічний план: PostgreSQL retrieval для AI-асистента

Оновлено: 2026-10-03. Рішення й дослідження —
[retrieval proposal](ai-assistant-retrieval-proposal.md).
Цей документ визначає послідовність змін у коді та критерії приймання.

**Уточнення тестового корпусу:** за рішенням власника поточний FMS pilot бере
всі статуси бізнесових документів, виключає російський переклад, engineering,
workbench і технічні doc_type всередині бізнесових зон. Результат: **141 документ,
553 чанки, 74 882 токени**; ADMIN бачить усі, USER — 2 документи з audience `all`. Деталі — [manifest](ai-sources/README.md).
Цей корпус **проіндексовано в PostgreSQL** (AI-2a.2, tenant `default`) — див. §1.
Це явний `all-for-testing`; обмеження draft approvals нижче описують strict default,
який не застосовується до поточного тестового FMS-профілю.

## 1. Поточний результат першого кроку

**AI-2a.1 foundation реалізовано:** PostgreSQL 17 із pgvector 0.8.6,
привілейований bootstrap extension, tenant-таблиці джерел/документів/чанків,
точний cosine search та інтеграційні тести на справжній БД.

Це завершений шар зберігання й пошуку **за готовим вектором**. Чат поки
використовує `StaticKnowledgeSource`. Offline FMS preview (AI-2a.0) також готовий: manifest, parser/chunker та
точний підрахунок токенів. **AI-2a.2 зроблено:** embedding adapter
(OpenAI/OpenRouter), повторюваний ingest із checkpoint/reuse і атомарною
публікацією, CLI `ai:docs:ingest`/`ai:docs:search`; реальний FMS-корпус
проіндексовано. Наступний крок — AI-2a.3 (`PostgresKnowledgeSource` у чаті).
Тестові вектори синтетичні: вони доводять коректність SQL та ізоляцію,
але не семантичну якість на FMS.

Перший крок бази виконано перед FMS manifest: він не потребує відправлення
реального контенту провайдеру. Пілот FMS матиме власного тенанта і
`product=fms`. Глобальна публікація — окремий інкремент AI-2b; перші таблиці
мають обов'язковий `tenant_id` та стандартний RLS без винятку для `NULL`.

## 2. Контракт бази й коду

| Компонент  | Реалізація                                                                                                | Інваріант                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PostgreSQL | dev/prod/Swarm compose, GitHub CI: `pgvector/pgvector:0.8.6-pg17-bookworm`, зафіксований multiarch digest | одна версія extension на amd64/arm64                                                                     |
| Bootstrap  | `docker/postgres/init/02-vector.sql`, `libs/database/scripts/ensure-roles.ts`                             | extension встановлює адміністратор; `saas_migrator` лишається без superuser/BYPASSRLS                    |
| Джерело    | `AiKnowledgeSource` / `ai_knowledge_sources`                                                              | tenant + product + key унікальні; `is_enabled=false`, `active_revision=NULL` за замовчуванням            |
| Документ   | `AiKnowledgeDocument` / `ai_knowledge_documents`                                                          | source + revision + canonical ID + language; path/title/hash; закритий список `Role[]` у `audience`      |
| Чанк       | `AiKnowledgeChunk` / `ai_knowledge_chunks`                                                                | document + ordinal унікальні; heading/content/hash/token count; обов'язковий ненульовий `vector(1536)`   |
| Embedding  | `knowledge/embedding-provider.ts` у `libs/shared/src/ai`                                                  | незалежний від LLM інтерфейс; v1: `text-embedding-3-small`, 1536 вимірів, cosine                         |
| Пошук      | `PostgresKnowledgeStore.search()`                                                                         | параметризований SQL тільки через `TenantTransactions.withTenantTx`; без tenant ID у доменному аргументі |

На всіх трьох таблицях: `ENABLE` + `FORCE ROW LEVEL SECURITY`, політика
`tenant_isolation` з `USING` і `WITH CHECK`, tenant-default із контексту.
Композитні FK `(tenant_id, source_id)` і `(tenant_id, document_id)` не
дозволяють прикріпити дочірній запис до чужого тенанта навіть при помилці
в коді. Видалення джерела каскадно видаляє документи й вектори.

`embedding` позначено як Prisma `Unsupported("vector(1536)")`: запис буде
параметризованим SQL, читання повертає звичайні поля та distance. Змішувати
embedding-моделі забороняє SQL CHECK, невірну розмірність — тип колонки.
Зміна embedding-моделі потребує нового профілю/міграції та переіндексації.
Модель генерації відповіді можна змінювати незалежно.

Порядок пошуку:

1. Перевірка моделі/розмірності/чисел вектора та `limit` у межах 1–50.
2. Відкриття tenant-транзакції. Усі три таблиці читаються під `saas_app`.
3. Відбір `product`, `is_enabled`, `document.revision = source.active_revision`,
   `role = ANY(audience)` та embedding-моделі.
4. Точне сортування `<=>` за cosine distance, стабільний tie-break за chunk ID.
5. Повернення top-K текстів, token count, document/chunk ID, path і revision.

Немає ANN-індексу: спочатку вимірюємо корпус. Distance не є відсотком
впевненості. Навіть ADMIN бачить лише документи, де ADMIN явно є в audience.
Роль передає довірений серверний код, не параметр клієнта. Відкритого HTTP
API для сховища наразі немає.

## 3. Поставка наступних інкрементів

| Крок                                           | Код і результат                                                                                      | Приймання                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation — зроблено**                   | образ/extension, три таблиці, RLS, профіль embedding, точний SQL search                              | реальна БД ранжує вектори, не видає чужі/неопубліковані/заборонені документи                                                  |
| **2. FMS preview — зроблено**                  | manifest, parser, chunker, `ai:docs:preview`; реалізація AI-2a.0                                     | dry-run показує включені/відхилені файли з причиною, hash, chunk count, точний token count; нуль зовнішніх API-викликів       |
| **3. FMS ingest і текстовий пошук — зроблено** | embedding API adapter, CLI `ai:docs:ingest` та `ai:docs:search`; AI-2a.2                             | реальні FMS-тексти й embeddings у PG; незмінний повторний import не викликає embedding API; природне питання повертає джерела |
| **4. AiPanel + цитати — зроблено**             | `PostgresKnowledgeSource`, вибір backend, prompt budget, Zod-контракти citations, worker/UI; AI-2a.3 | питання у чинному чаті → відповідь із перевіреними посиланнями; порожній пошук → чесна відповідь про брак даних               |
| **5. Hybrid і вимірювання — зроблено**         | FTS/GIN, `vector`/`fts`/`hybrid`, RRF, eval; AI-2a.4                                                 | порівняння трьох режимів на одному корпусі й питаннях; recall@K, p95, usage/cost                                              |
| **6. Керовані джерела**                        | Files/S3 → worker ingest, UI статусів/публікації, global publishing; AI-2b                           | контроль доступу, повторний ingest, скасування публікації, ліміти й видалення наскрізно                                       |
| **7. Доменні дані**                            | вузькі read-only tools для клієнтів, заявок тощо; AI-4                                               | актуальні структуровані дані через доменні сервіси/RLS; allowlist полів, аудит, обмежена кількість кроків                     |

### Кроки 2–3: перша практична ціль

Manifest задає `sourceKey`, `product`, дозволені шляхи,
мови, status/publish та явне зіставлення FMS audience → ролі застосунку.
Невідомі значення відхиляються. Станом на дослідження в бізнесових зонах
FMS лише 16 current-сторінок; додавання draft потребує окремого запису
allowlist для конкретної ревізії, а не загального `includeDrafts=true`.

CLI отримує корінь checkout як аргумент. Абсолютний шлях користувача не
входить у runtime env. Parser забороняє вихід за root через traversal/symlink,
читає Markdown/текст, зберігає section breadcrumb, прибирає frontmatter й
службовий контент. Chunker використовує tokenizer вибраної embedding-моделі,
ціль 400 токенів, overlap 50; preview та ingest використовують один код.

Команди (усі три реалізовано):

```text
pnpm ai:docs:preview --source fms --root <checkout> --manifest <file>
pnpm ai:docs:ingest --source fms --root <checkout> --manifest <file> --tenant <pilot-id>
pnpm ai:docs:search --product fms --tenant <pilot-id> --role USER --query "..."
```

`--tenant`/`--role` дозволені лише операторському CLI. У застосунку tenant
відновлюється із CLS/job payload, роль — із поточного користувача.

Embedding adapter окремо налаштовує URL/key/model/dimensions, timeout,
batch/concurrency, retry/backoff і перевіряє кількість/порядок результатів,
модель, finite/nonzero вектори та usage. Початково batch 32/concurrency 2.
Виклик провайдера відбувається поза DB-транзакцією. Тестовий provider має
перевіряти конвеєр без оплати, а реальний прогін — якість `en`/`ru`/`uk`.

Ingest матиме run ID, статус і manifest hash. Preview вже обчислює source revision
із SHA-256 дозволених файлів, manifest, parser version та embedding profile; змінені правила не використовують
попередню ревізію як нібито ідентичну. Нові документи/чанки пишуться як
staging. Незмінні embeddings повторно використовуються за model/profile +
content hash у дозволеному scope. Перед публікацією перевіряється повнота
manifest і кількість чанків; коротка транзакція перемикає active revision.
Старий конкурентний job не може перепублікувати попередню ревізію:
per-source lock/CAS та перевірка поточного run ID. Помилка embedding API
залишає активною попередню ревізію. Cleanup видаляє покинуті staging-версії
і зняті з публікації дані відповідно до retention.

Цей milestone виконано 2026-10-03: реальна FMS-документація завантажена через
`ai:docs:ingest`, `ai:docs:search` повертає релевантні джерела, повтор без змін —
нуль викликів API. Опис механізму й виміри — [ai-sources/README.md](ai-sources/README.md).

### Кроки 4–7: розширення без переробки транспорту

`PostgresKnowledgeSource` обчислює embedding питання, викликає store,
дедуплікує/обирає максимум 5 фрагментів і 2 500 токенів із citation metadata.
Вибір продукту задає серверна конфігурація; runtime fallback до статичного
корпусу при порожньому PG-пошуку не повинен змішувати FMS з SaaS Skeleton.

Додаткові налаштування вводяться разом зі споживачем, а не мертвими env:
`AI_KNOWLEDGE_BACKEND`, `AI_DOCS_SEARCH_MODE`, `AI_DOCS_MAX_CONTEXT_TOKENS`,
`AI_DOCS_FINAL_CHUNKS`, `AI_DOCS_VECTOR_CANDIDATES`, `AI_DOCS_FTS_CANDIDATES`.
Початково rewrite/rerank вимкнені, одна генерація на питання; порівняти
історію 4/10 ходів і вихід 768/1024 токени. Логуються лише usage/ID/latency,
не повний текст документів. Embedding ingest та query мають окремі квоти.

Глобальні матеріали AI-2b потребують окремого джерела доступу. План:
окремі global-таблиці з читанням для `saas_app`, записом лише control plane,
об'єднання дозволених результатів із tenant-індексом. Не перетворювати
поточний обов'язковий `tenant_id` на nullable без окремого security review
та тестів. Зберігаються product/audience/publication filters; додавання
глобальної гілки не відкриває tenant-дані.

Для актуальних сум, клієнтів і статусів використовуються read-only tools,
які викликають існуючі доменні сервіси. Не індексувати всю operational DB
і не давати LLM довільний SQL. RBAC, ліміти результату, audit і cancellation
перевіряються при кожному виклику; відповідь може поєднувати правила з
документації та актуальні дані tool-а.

## 4. Bootstrap, міграції й наявні інсталяції

Новий dev-volume запускає `01-roles.sql` і `02-vector.sql`. `pnpm db:roles`
встановлює extension у цільову БД та `template1`, з якої PostgreSQL створює
автоматичну Prisma shadow DB. `ws:init`/`db:reset` та e2e global setup уже
викликають цей шлях. Міграція лише перевіряє pgvector >= 0.8.6 у public;
вона не підвищує роль мігратора й не встановлює untrusted extension.

`db:roles` потребує адміністратора self-hosted PostgreSQL і доступу до
`template1`. Для managed PostgreSQL DBA провіженить extension дозволеним
провайдером способом у target і shadow database; такий шлях цим інкрементом
не перевірено. Зміна версії extension виконується адміністратором явно;
bootstrap не запускає автоматичний `ALTER EXTENSION UPDATE`.

**Локальний reset — виконано 2026-10-03 за рішенням власника.** Старі дані
не потрібні; backup/restore не входять до локального плану. Старий volume
`saas-skeleton_pgdata` видалено, створено свіжу БД: 24 міграції, pgvector 0.8.6,
seed default tenant, адміністратор, platform operator, 3 demo customers і General.

Одноразовий порядок для основного checkout (slot 0), вже виконаний:

```bash
docker compose --env-file .env -f docker/docker-compose.yml stop postgres
docker compose --env-file .env -f docker/docker-compose.yml rm -f postgres
docker volume rm saas-skeleton_pgdata
pnpm docker:up
pnpm db:generate
pnpm db:reset
```

Це видаляє локальні дані PostgreSQL. Для наступних скидань на готовому
pgvector-образі достатньо `pnpm db:reset`; видаляти volume повторно не потрібно.
У linked worktree застосовується `pnpm ws:init`, який сам керує своїм слотом.
Після reset запустити `api:dev`, `platform:dev`, `worker:dev`, `web:dev`,
`platform:web:dev` в окремих терміналах; чинні dev-процеси можна перезапустити.

Для іншої інсталяції, **де дані потрібно зберегти**, залишається логічний
backup → restore в новий PG17 volume → roles/extension → migrations → switch.
Alpine PGDATA не переноситься безпосередньо на Debian через різницю libc/locale.

Для Swarm: спершу підготувати нову БД/volume з pgvector та виконати bootstrap
через новий tools image, потім запускати API, entrypoint якого застосовує
міграції. Поточні ручні `db_roles_*` jobs запускаються після deploy, тому
оновлення наявної інсталяції потребує окремого операційного порядку; не
покладатися на звичайний rolling deploy для переходу Alpine → Debian.
Продакшн-деплой і перенесення існуючого volume не виконувались.

Джерела: [pgvector Docker](https://github.com/pgvector/pgvector#docker),
[PostgreSQL extensions](https://www.postgresql.org/docs/17/sql-createextension.html).

## 5. Перевірка першого кроку

`apps/api/test/ai-knowledge.e2e-spec.ts` перевіряє на реальній БД:
точне ранжування; фільтри product/audience/revision/enabled; відсутність
контексту; RLS read/write; композитні FK; розмірність/модель/ненульові
вектори; унікальність chunk position; каскадне видалення.
Загальний `rls.e2e-spec.ts` також охоплює всі три нові таблиці.

Перевірки виконуються на окремому workspace slot і тестовій БД:

```bash
pnpm ws:init
pnpm db:generate
pnpm api:test:e2e --testPathPatterns=ai-knowledge
pnpm api:test:e2e
pnpm platform:test:e2e
pnpm lint
pnpm typecheck
pnpm build
pnpm ws:down
```

Прогін 2026-10-03 на ізольованому слоті 1:

- `ws:init`: свіжий PG17/pgvector, reset, усі 24 міграції та seed — успішно.
- Новий retrieval suite: **9/9**; повний tenant API: **355/355**, 26 suites.
- Platform API: **23/23**.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — успішно.
- `ws:down`: тестовий слот і його volume-и прибрано; тимчасовий `.env.local`
  видалено, відновлено попередній стан основного checkout-а.
- `prisma migrate dev --create-only`: shadow replay пройшов. Prisma запропонував
  лише повторне встановлення tenant-default виразів, як у попередніх міграціях;
  цю діагностичну міграцію не застосовували й не включали до зміни.

Платні API, FMS embeddings, browser flow та перенесення production volume
до цього кроку не входять. Перевірені синтетичні вектори не є оцінкою recall
на FMS. Це результати перевірки foundation до локального reset, описаного нижче.

## 6. FMS preview — виконано

Реалізація: `libs/shared/src/ai/knowledge/ingest/`, CLI
`scripts/ai-docs-preview.ts`, [pilot manifest і usage](ai-sources/README.md).
OpenSpec change: `ai-2a-0-fms-preview`.

На локальному FMS checkout: **13 дозволених документів, 89 чанків,
13 644 embedding-токени** (разом із заголовками й overlap), 403 відхилення.
Із 16 current-документів бізнесових зон три не проходять явне зіставлення
аудиторії. Preview не розширює права автоматично. Платних API-викликів — 0.
Наступний інкремент AI-2a.2 виконано — див. нижче.

Перевірки preview та локального reset:

- Shared unit tests: **147/147**, 10 suites; admission, draft expiry/hash,
  дублікати, symlink, Unicode, token budget, BOM/CRLF та deterministic revision.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — успішно.
- OpenSpec `ai-2a-0-fms-preview --strict` — valid.
- Повторний FMS preview: byte-identical JSON; максимальний чанк — 400 токенів.
- Основний стек: обидва health endpoint і web — HTTP 200; seed login в обох
  planes; 3 customers / 1 tenant; pg-boss scheduled jobs у стані completed.
- Основний стек лишено запущеним за запитом. Повні DB e2e з попереднього кроку
  не повторювали паралельно з live dev-процесами; новий preview перевірено offline.

## AI-2a.2: результат (2026-10-03)

OpenSpec change: `ai-2a-2-fms-ingest`. Міграція `20261003150000_ai_knowledge_ingest_state`
(стан run на джерелі + індекс `content_hash`). Механізм, конфігурація й виміри —
[ai-sources/README.md](ai-sources/README.md).

- Реальний ingest FMS (tenant `default`, OpenRouter): 141 документ, 553 чанки,
  74 882 input-токени — рівно оцінка preview; повтор — `unchanged`, 0 викликів.
- `ai:docs:search` для ADMIN повертає профільні документи (WhatsApp pricing → distance ≈0.31);
  USER бачить лише 2 глосарії з audience `all`; зміна mapping → нова ревізія з 0 викликів API.
- Unit: 17 тестів embedding adapter (порядок, OpenRouter id, небезпечні URL, ретраї,
  `Retry-After`, 4xx без ретраю й без витоку ключа, невалідні відповіді/вектори, cancel);
  shared загалом **170/170**.
- E2E на справжньому Postgres (`ai-knowledge-ingest.e2e-spec.ts`, 9): публікація й фільтр ролі,
  нуль викликів без змін, embedding лише змінених чанків, збій → стара ревізія доступна і
  resume з checkpoint, superseded run, неповний snapshot, ізоляція tenant-ів; разом із
  foundation-сьютом 18/18; `rls.e2e-spec` 7/7.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — успішно.
- Виправлено під час доведення: CLI шукав tenant поза RLS-контекстом (завжди «not found»)
  → `resolve_tenant()` + перевірка в контексті; ingestor міг звітувати `AbortError`
  сусіда замість першої причини збою.

Наступний інкремент AI-2a.3 виконано — див. нижче.

## AI-2a.3: результат (2026-10-03)

OpenSpec change: `ai-2a-3-assistant-citations`. Рішення, механізм і живий прогін —
[ai-assistant-implementation.md §18](ai-assistant-implementation.md). Коротко:
`AI_KNOWLEDGE_BACKEND=postgres` + `AI_KNOWLEDGE_PRODUCT=fms` вмикають retrieval у чаті
(5 фрагментів / 2 500 токенів); embedding питання — поза транзакцією; збій embedding — явний
`FAILED`. Цитати перевіряє сервер, а текст цитати віддається з повторною перевіркою доступу.
Промпт FMS-відповіді ≈1k токенів проти ≈11k у статичного корпусу.

Наступний інкремент AI-2a.4 виконано — див. нижче.

## AI-2a.4: результат (2026-10-03)

OpenSpec change: `ai-2a-4-hybrid-search`. FTS (generated `search_vector` + GIN), режими
`vector`/`fts`/`hybrid` (RRF), поріг distance, `pnpm ai:docs:eval`. На чернетковому наборі з
40 питань `hybrid ≤ 0.8` дав Recall@5 94% і став дефолтом. Таблиця й аналіз —
[ai-sources/README.md](ai-sources/README.md), рішення —
[ai-assistant-implementation.md §19](ai-assistant-implementation.md). Набір питань потребує
перегляду власником продукту; після цього eval повторюється.

Наступне — AI-2b (керовані джерела через UI).
