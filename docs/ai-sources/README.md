# FMS: manifest, preview, ingest і пошук

`pnpm ai:docs:preview` читає локальний Markdown checkout, перевіряє admission,
розбиває дозволені тексти на чанки й рахує токени. БД, ключі й мережа не потрібні.
Це підготовка індексації; запис embeddings у PostgreSQL робить `ai:docs:ingest`,
перевірку пошуку — `ai:docs:search` (розділи нижче).

```bash
pnpm ai:docs:preview --source fms \
  --root /path/to/fms-api/fms-docs \
  --manifest docs/ai-sources/fms-pilot.json \
  --output /tmp/fms-docs-preview.json
```

`--json` друкує звіт у stdout; для чистого JSON використовуйте `pnpm --silent`.
За замовчуванням звіт містить метадані, хеші, кількість токенів і причини
відхилення. `--include-content` додає тексти для локальної перевірки чанків.
Exit code: 0 — є дозволені документи; 2 — жодного; 1 — помилка конфігурації/CLI.
Абсолютний root і приватні тексти не включаються в репозиторій.

## Що визначає manifest

| Поле                     | Призначення                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `sourceKey`, `product`   | Стабільна ідентичність джерела та продукту                                                |
| `allowedDirectories`     | Відносні POSIX-директорії; дозволені вкладені `.md`                                       |
| `statusPolicy`           | `current-or-approved` за замовчуванням або явний `all-for-testing`                        |
| `allowedDocumentTypes`   | Необов’язковий allowlist типів; у FMS відсікає технічні сторінки всередині бізнесових зон |
| `languages`              | `en`, `ru`, `uk`; решта відхиляються                                                      |
| `audienceMapping`        | Явне зіставлення FMS audience → `ADMIN`/`USER`; `[]` не дає доступу                       |
| `chunking.targetTokens`  | Максимум токенів embedding-тексту включно із breadcrumb; пілот 400                        |
| `chunking.overlapTokens` | Максимальний overlap усередині секції; пілот 50                                           |
| `draftApprovals`         | Винятки для конкретних draft-файлів: path, SHA-256, reviewer, reviewAfter                 |

## Поточний тестовий профіль (за рішенням власника)

`fms-pilot.json` включає бізнесові директорії 010–120 (130–190 поки відсутні),
мови `en`/`uk`, **усі статуси** через `statusPolicy: all-for-testing`.
Статус може бути current/draft/historical/інший або бути відсутнім;
`draft: true` також не блокує тестовий документ. Draft approvals не потрібні.
Правило `publish: false` залишається окремою забороною публікації.

Виключені `ru/`, `000_docs`, `200_engineering`, `300_workbench`, root README,
`400_user_manual` (окрема вітрина manual, поза бізнесовими зонами) та ресурси.
`allowedDocumentTypes` додатково відбирає бізнесові типи всередині дозволених
директорій: concept/capability/workflow/business_rule/acceptance_scenario,
business_reference/how_to/tutorial/prototype, а також area_overview/glossary/
external_reference. Типи взято з `000_docs/000_10_documentation_structure.md` FMS.
API, integration_contract, data_reference та migration виключені навіть з
бізнесових директорій. Посилання на інші документи не обходяться.

Аудиторія `all` зіставлена з `ADMIN` і `USER`; решта відомих audience
поточного бізнесового корпусу — лише з `ADMIN`. Для кількох audience береться
об'єднання ролей. На FMS це дає USER доступ до 2 документів (глосарії
`010_90` і `050_90`), ADMIN — до всіх 141.
Root_admin/product/finance/engineering для тесту не відсікають бізнесову
сторінку від ADMIN.
Нова невідома audience все ще потребує явного запису в manifest.

За відсутності `statusPolicy` діє **current-or-approved**: current без draft flag
або draft із точним SHA-256 оригінальних UTF-8 байтів, reviewer і `reviewAfter`
пізнішою за сьогодні (UTC). Інші статуси відхиляються. Тестовий режим не змінює
цей default інших джерел. Reviewer — атрибуція ручного review, CLI не
автентифікує особу. Зміна status policy змінює manifest hash і source revision.

Frontmatter вимагає title, canonical_id, language, audience; неправильні типи
YAML та product mismatch відхиляються. Якщо заданий `allowedDocumentTypes`,
`doc_type` обов'язково має належати цьому списку.

Символічні посилання не обходяться; traversal у manifest заборонений.
Ліміт файлу — 1 MiB, обходу — 10 000 filesystem entries. Усі документи з
дубльованою парою canonical ID + language відхиляються. YAML aliases не дозволено.
CLI призначений для локального checkout, який не змінюється під час читання;
це не серверний upload endpoint для файлової системи іншого користувача.

## Як формуються чанки

CommonMark AST → секції за заголовками → breadcrumb + текст. Frontmatter,
HTML-вузли, адреси зображень, definitions і fenced code, крім plain-text
діаграм, не потрапляють у embedding. Таблиці залишаються читабельним текстом.
Markdown-посилання зберігають підпис. Це очищення формату; runtime-захист
від prompt injection залишається окремою відповідальністю асистента.

Локальний `cl100k_base` відповідає профілю `text-embedding-3-small`, 1536 dimensions.
Чанки закінчуються на межі Unicode code point; близька межа слова має перевагу.
Overlap обмежений токенами й половиною попереднього фрагмента, між секціями його
немає. Хеш чанка включає breadcrumb. `embeddingTokens` — сума повного тексту,
який піде на embedding; на FMS він збігся з usage OpenRouter до токена (74 882).

Revision — SHA-256 manifest, parser version, embedding profile та хешів усіх
допущених файлів. Це snapshot вмісту, а не git commit; змінені правила також
змінюють revision. Зміна алгоритму вимагає оновлення `PARSER_VERSION`.
CLI/parser не імпортуються в runtime barrel `libs/shared/src/ai/index.ts`;
майбутній worker ingest має окремо узгодити ESM parser з Nest webpack.

## Вимірювання 2026-10-03

На FMS checkout із 416 Markdown-файлами, з поточним тестовим профілем:

- **141 документ, 553 чанки, 74 882 embedding-токени**.
- 266 файлів поза дозволеними директоріями (зокрема російський переклад,
  engineering та workbench).
- 9 технічних документів усередині бізнесових зон відхилено за doc_type.
- Усі 141 допущені документи — `en`; current і draft обидва включені.
- Платних API-викликів: **0**. Це offline preview, а не запис embeddings у БД.

Попередній strict-профіль давав 13 документів / 89 чанків / 13 644 токени;
це історичний вимір, він більше не описує поточний тестовий manifest.

## Ingest: `pnpm ai:docs:ingest`

```bash
pnpm ai:docs:ingest --source fms \
  --root /path/to/fms-api/fms-docs \
  --manifest docs/ai-sources/fms-pilot.json \
  --tenant default            # slug або id активного tenant-а
```

Будує той самий snapshot, що й preview, і записує його в `ai_knowledge_*`
**обраного tenant-а** під RLS. `--tenant` — довірений аргумент оператора, не
параметр API. Slug резолвиться через `resolve_tenant()`, як при логіні:
`tenants` теж під RLS, і поза tenant-контекстом `saas_app` власного рядка не
бачить. CLI відмовляється працювати під роллю з `SUPERUSER`/`BYPASSRLS` —
лише `saas_app` із `DATABASE_URL`.

Як це працює (`libs/shared/src/ai/knowledge/ingest/`):

- **Run ownership.** `begin` під `FOR UPDATE` записує в джерело новий
  `ingest_run_id` і `ingest_status=running`. Кожен staging-запис і публікація
  знову блокують рядок джерела й перевіряють, що run досі той самий, —
  старший конкурентний запуск отримує `Ingest run superseded` і нічого не
  пише й не публікує.
- **Staging.** Документи нового запуску пишуться з `revision = runId`, тому
  пошук (`d.revision = s.active_revision`) їх не бачить до публікації.
- **Виклики провайдера поза транзакціями.** Batch (дефолт 32) і concurrency
  (дефолт 2) обмежені; кожен завершений batch одразу зберігається
  (checkpoint). Перший збій зупиняє сусідні worker-и й повертається як
  причина.
- **Reuse.** Перед embedding читаються вже збережені вектори того самого
  джерела (активна ревізія **і** staging попередніх невдалих запусків) за
  `content_hash` + модель. Тому повтор після збою дозамовляє лише решту, а
  зміна одного чанка — один embedding. Між tenant-ами reuse немає: чужі
  вектори невидимі під RLS.
- **Публікація.** Одна коротка транзакція: перевірка повноти (кількість
  документів і чанків = snapshot), видалення всіх інших ревізій джерела
  (стара активна й покинуті staging), перейменування staging у revision
  snapshot-а, перемикання `active_revision`, `ingest_status=complete`,
  `manifest_hash`.
- **Без змін.** Якщо `active_revision` уже дорівнює revision snapshot-а і
  джерело увімкнене — нуль викликів провайдера (`unchanged: true`).
- **Збій.** `ingest_status=failed`, попередня активна ревізія лишається
  доступною для пошуку без змін.

Помилки CLI не друкують тексти, SQL чи тіло відповіді провайдера: для
провайдера — лише код (`embedding-http-429`, `embedding-invalid-vector`…),
для решти — загальне повідомлення.

### Конфігурація embeddings

Профіль зафіксований у коді: `text-embedding-3-small`, 1536 вимірів, cosine.
Зміна моделі = нова версія індексу, не env-змінна.

| Змінна                                          | Дефолт | Призначення                                                        |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `AI_EMBEDDING_BASE_URL`, `AI_EMBEDDING_API_KEY` | —      | окремий endpoint; задається **парою**                              |
| `AI_BASE_URL`, `AI_API_KEY`                     | —      | fallback, якщо окремий endpoint не заданий                         |
| `AI_EMBEDDING_TIMEOUT_MS`                       | 45000  | timeout одного запиту (≤ 120 000)                                  |
| `AI_EMBEDDING_RETRIES`                          | 2      | ретраї 408/429/5xx/мережі (≤ 3); `Retry-After` > 10 с — без ретраю |
| `AI_EMBEDDING_BATCH_SIZE`                       | 32     | текстів на запит (≤ 128)                                           |
| `AI_EMBEDDING_CONCURRENCY`                      | 2      | паралельних запитів (≤ 4)                                          |

Дозволені хости — лише `api.openai.com` і `openrouter.ai` по HTTPS; для
OpenRouter модель запитується як `openai/text-embedding-3-small`.

## Пошук: `pnpm ai:docs:search`

```bash
pnpm ai:docs:search --product fms --tenant default --role ADMIN \
  --query "How are WhatsApp conversations billed?" --limit 5
```

Робить embedding питання (≤ 2048 токенів) і точний cosine-пошук у
PostgreSQL лише серед опублікованої ревізії увімкнених джерел продукту, з
фільтром audience за роллю. Повертає JSON: `inputTokens` і `items` з
шляхом, заголовком, ревізією, текстом чанка й `distance` (менше — ближче;
це не калібрована впевненість).

## Ingest FMS 2026-10-03

Tenant `default`, OpenRouter:

- Перший запуск: 141 документ, 553 чанки, **74 882 input-токени** (рівно
  оцінка preview), ≈12 с.
- Повтор: `unchanged: true`, 0 викликів, 0 токенів, ≈3 с.
- `[ADMIN] How are WhatsApp conversations billed?` → перші два результати з
  `010_10_20_whatsapp_pricing_reference.md` (distance ≈0.31).
- Український запит про створення користувача знаходить релевантні
  розділи, але слабше (≈0.63–0.71): корпус англомовний.
- Після відкриття `all` для USER повторний ingest опублікував нову ревізію
  (змінився manifest hash) з **0 викликів провайдера** — усі 553 embeddings
  перевикористано.
- `[USER]` бачить лише два глосарії: на питання про WhatsApp — глосарій
  (distance ≈0.70), документи pricing для нього закриті.
