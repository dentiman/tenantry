# SaaS Skeleton — CLAUDE.md

Форк-скелетон для мультитенантних CRM/ERP-систем (білінг, кастомери, тікети, черги).
Базові патерни портовані з `/Users/dentiman/dev/projects/fibo-admin` і розширені.
**Фаза 1 завершена і перевірена** (2026-07-11): монорепо, auth + users end-to-end, конвеєр контрактів, CI.
**Фаза 2.1 завершена і перевірена** (2026-07-11): pg-boss + `libs/shared` (JobDispatcher/@JobHandler) + `apps/worker`.
**Фаза 2.2 завершена і перевірена** (2026-07-12): наскрізна обробка помилок — ApiError envelope + AllExceptionsFilter + toast + fieldErrors у форми.
**I18N-1 завершена і перевірена** (2026-07-12): `libs/i18n` + react-i18next в адмінці, усі рядки UI винесені в ключі.
**I18N-2 завершена і перевірена** (2026-07-12): FieldError.code + переклад toast/fieldErrors/Zod-повідомлень на фронті.
**I18N-3 завершена і перевірена** (2026-07-12): `users.locale` у БД, реальна відправка welcome-email через Mailpit локаллю юзера (закрито й давній пункт фази 2).
**DataGrid-фільтри завершені і перевірені** (2026-07-13): фільтри гріда декларуються масивом (як columns), Search→Filters перейменування, /jobs мігровано на DataGrid (+сортування).
**Files v1 завершена і перевірена** (2026-07-14): S3-сумісне сховище (dev: SeaweedFS у compose), двофазний presigned-upload, magic-bytes валідація, thumbnail (sharp у worker), cron-очистка PENDING, демо — аватар користувача на /users. Перевірено живим прогоном: PUT у SeaweedFS, CORS preflight, відхилення підробленого MIME.
Документи: `docs/architecture-proposal.md` (усі рішення з обґрунтуванням), `docs/roadmap.md` (фази),
`docs/error-handling.md` (наскрізна обробка помилок: таблиці нормалізації і каналів реакції),
`docs/i18n-plan.md` (мультиязичність: зафіксовані рішення + фази I18N-1…4),
`docs/file-storage.md` (файлова підсистема: структура, presigned-флоу, приклад end-to-end на аватарі,
формати запитів/відповідей), `README.md` (quickstart).

## Команди

```bash
pnpm docker:up            # PostgreSQL 17 + Mailpit + SeaweedFS (OrbStack у користувача, не Docker Desktop)
                          # Mailpit UI: http://localhost:8025 (SMTP :1025 — дефолти MailerService)
                          # SeaweedFS S3: http://localhost:8333 (креденшели — docker/seaweedfs/s3.json,
                          # дефолти StorageService збігаються; бакет+CORS створює сам API на старті)
pnpm db:generate          # Prisma client → libs/database/src/generated (gitignored)
pnpm db:migrate:dev       # міграції (dev; НЕ передавати ім'я через `pnpm ... -- --name X` —
                          # pnpm дублює `--`, prisma йде в інтерактивний prompt і висить;
                          # `cd libs/database && pnpm exec prisma migrate dev --name X`)
pnpm db:seed              # admin@example.com / Admin12345
pnpm api:dev              # API: http://localhost:3001, Swagger: /api/docs
pnpm worker:dev           # Worker: pg-boss споживачі + cron + welcome-email (окремий процес, без HTTP)
pnpm web:dev              # Web: http://localhost:5173 (Vite проксі /api → 3001)
pnpm openapi:generate     # apps/api/openapi.json (ts-node, потрібен .env з JWT_SECRET)
pnpm web:codegen          # orval: openapi.json → apps/web/src/api/generated
pnpm lint && pnpm typecheck && pnpm build
pnpm api:test:e2e         # 47 jest+supertest тестів; ВИМАГАЄ запущеного Postgres. Ганяються в ОКРЕМІЙ
                          # БД saas_skeleton_test (globalSetup сам створює її і мігрує) — dev-дані не чіпає
```

Після зміни контрактів/контролерів завжди: `openapi:generate` → `web:codegen` (обидва артефакти комітяться).

## Архітектура

```
apps/api        NestJS 11 (webpack-збірка). Модулі: auth, users, files (presigned upload/download),
                jobs (read-only моніторинг черг: raw SQL до pgboss.job, 42P01 → порожньо), health.
                Pino, AllExceptionsFilter (configureApp() в app.setup.ts — спільний сетап для main.ts і e2e)
apps/worker     NestJS 11 без HTTP (createApplicationContext). Хендлери job-ів + cron через pg-boss,
                MailerService (nodemailer → Mailpit), плейн i18next для email-контенту
apps/web        React 19 + Vite 7, TanStack Router/Query v5, Zustand, Tailwind 4, react-hook-form,
                HeroUI v3 (React Aria; compound-компоненти) + next-themes (light/dark/system),
                react-i18next
libs/contracts  Zod 4 схеми + z.infer типи — ЄДИНЕ джерело правди типів API (залежить лише від zod)
libs/database   Prisma 7 (adapter-pg): schema, migrations, seed, PrismaService/PrismaModule (@Global)
libs/i18n       Спільні i18next-ресурси для web (common/errors/validation); worker НЕ споживає —
                свій контент локально (apps/worker/src/locales), спільного поки немає
libs/shared     Черги: defineJob (Zod payload), JobDispatcher (абстракція, pg-boss замінюваний),
                @JobHandler() + DiscoveryService-автореєстрація, JobInboxService (processed_jobs).
                Сховище: StorageService (@aws-sdk/client-s3: presign PUT/GET, head/get/put/delete,
                ensureBucket+CORS на старті) + StorageModule (@Global)
docker/         compose (name: saas-skeleton — namespaced volume, НЕ прибирати name!): Postgres 17,
                Mailpit (SMTP :1025, UI :8025), SeaweedFS (S3 :8333, creds — seaweedfs/s3.json).
                docker-compose.prod.yml (перевірений димовим прогоном): self-hosted прод на одному
                сервері — дані в замаплених хостових директоріях ${SAAS_DATA_DIR}/{postgres,seaweedfs}
                (бекапити узгоджено!), теги запінені, порти тільки 127.0.0.1 (назовні — reverse proxy
                з TLS, для S3 зберігати Host — він у SigV4-підписі), без Mailpit. Креденшели:
                seaweedfs/s3.prod.json + .env.production (обидва gitignored, є .example);
                `pnpm docker:prod:up/down`
```

**Конвеєр типів:** Zod-схема (`libs/contracts`) → `createZodDto` (nestjs-zod v5) → Swagger
(`@ApiOkResponse({ type: Dto.Output })`, `cleanupOpenApiDoc`) → `openapi.json` → orval →
TanStack Query hooks (`useAuthLogin`, `useUsersFindAll`, …). Ручних типів API не існує.

**Auth (порт із fibo-admin «як є», рішення користувача):** access JWT 15m (`{ sub, email, role }`) +
refresh `tokenId:secret` (secret → argon2-хеш у `refresh_tokens`), ротація на кожен refresh,
theft detection (невірний secret при валідному tokenId → відкликання всіх сесій юзера).
Глобальний `JwtAuthGuard` (APP_GUARD, без Passport), відкриті роути — `@Public()`.
Фронт: access-токен тільки в пам'яті (Zustand), refresh у localStorage `saas_refresh_token`,
axios-інтерсептор із single-flight refresh на 401 (`apps/web/src/api/http-client.ts`).

**Помилки (фаза 2.2, наскрізний контракт):** єдиний envelope `ApiError` у `libs/contracts/src/error/`:
`{ statusCode, code (закритий enum), message, fieldErrors?: [{field, message}], requestId }` — фронт імпортує
тип напряму з contracts (без OpenAPI-шляху). Бекенд: `AllExceptionsFilter` (`@Catch()`) нормалізує ВСЕ:
ZodValidationException → 400 VALIDATION_ERROR + fieldErrors з issue paths; Prisma P2002 → 409 + поле
(УВАГА: Prisma 7 + adapter-pg кладе поля в `meta.driverAdapterError.cause.constraint.fields`, НЕ в
`meta.target`; а при недоступній БД кидає код `ECONNREFUSED`, НЕ P1001 — обидва перевірені на живо);
P2025 → 404; ECONNREFUSED/P1xxx/P2024 → 503; будь-який 5xx-message маскується ("Internal server error",
деталі тільки в лог з requestId). Явний 409 з полем — `fieldConflictException()` (`common/errors.ts`).
Фронт: `parseApiError()`/`isGlobalApiError()` (`apps/web/src/api/api-error.ts`); network/5xx/403 →
HeroUI `toast.danger` (глобальні QueryCache/MutationCache onError у main.tsx, дедуп 5с, `<Toast.Provider>`);
401 → refresh-інтерсептор; 4xx у формах — `applyServerError(error, form)`: fieldErrors → setError по
імені поля (звірка з getValues, тому форми МУСЯТЬ мати повні defaultValues), решта → errors.root.server.

**Черги (фаза 2.1):** job = `defineJob(name, zodSchema, { cron?, retry* })` у `libs/shared/src/jobs/definitions/`.
API: `JobsModule.forApi()` (global) → інжект `JobDispatcher` → `send(def, payload, { singletonKey?, tx? })`
(`tx` = Prisma-транзакція, транзакційна постановка через `fromPrisma`). Worker: `JobsModule.forWorker()` +
`@Injectable() @JobHandler(def) class X implements JobHandlerContract` — реєструється автоматично, cron теж.
Ідемпотентність: `JobInboxService.runOnce(context, fn)` — вставка в processed_jobs + fn в одній транзакції.
Fan-out еталон: подія `users.user-registered` (диспатчиться і з register, і з адмінського create,
singletonKey=userId) → її хендлер через inbox+tx ставить `notifications.welcome-email`.
Історія job-ів — стандартний retention pg-boss ~7 днів (рішення користувача, окремої таблиці немає).
Моніторинг — сторінка /jobs в адмінці (фільтри state/queue в URL, автооновлення 5s).

**Email (I18N-3, `apps/worker`):** `WelcomeEmailHandler` — реальна відправка (не заглушка): читає
`locale`+`name` СВІЖИМИ з БД по `payload.userId` (не з payload — стан міг змінитися між диспатчем
і обробкою), рендерить subject/body через плейн `i18next` (`apps/worker/src/i18n`,
`{ lng: locale }`) з `apps/worker/src/locales/en/notifications.json`, шле через `MailerService`
(nodemailer, дефолти на Mailpit). Це at-least-once side effect (не exactly-once як БД-ефекти
через `JobInboxService`) — pg-boss retry після падіння ПІСЛЯ успішного sendMail надішле лист
повторно; прийнятно для welcome-листа, для платіжних/юридичних листів треба окремий idempotency-шар.

**Файли (Files v1, зафіксовані рішення):** S3 API = абстракція сховища (окремого StorageDriver
немає, аналогічно pg-boss): dev — SeaweedFS з compose, прод — будь-який S3 через env `S3_*`.
MinIO НЕ використовувати (репо заархівовано 04/2026). Флоу двофазний: `POST /files` (Zod-валідація
allowlist MIME/розміру → PENDING-рядок у `files` + presigned PUT, TTL 10 хв) → браузер PUT напряму
в сховище (минаючи API; байти через NestJS не течуть, контракти лишаються JSON-only) →
`POST /files/:id/complete` (HeadObject: об'єкт існує + розмір збігається; magic bytes через
`file-type` звіряються з заявленим MIME — Content-Type клієнта недовірений; невалідний вміст →
видалення об'єкта і рядка + 400; повторний complete — ідемпотентний no-op) → READY. Ключі
`{yyyy}/{mm}/{uuid}.ext` (префікс під майбутній tenantId), назовні НЕ віддаються — доступ до байтів
тільки `GET /files/:id/download-url` (presigned GET, TTL 5 хв, тільки READY; `?variant=thumbnail`
з fallback на оригінал). Після complete зображень — джоба `files.generate-thumbnail` (worker, sharp
256px webp, ідемпотентна без inbox); покинуті PENDING чистить cron `files.cleanup-orphans` (24h,
спершу S3-об'єкт, потім рядок). `attachments` (полиморфні fileId+entityType+entityId) — таблиця під
майбутні домени, API поки немає. Демо-споживач: `users.avatarFileId` (PATCH валідує READY+image) →
`UserResponse.avatarUrl` = presigned GET мініатюри (в JSON, бо `<img>` не шле Authorization; auth-роути
аватар не пресайнять — тільки users). Фронт: `useFileUpload` (create→PUT з progress→complete, сирий
axios без інтерсепторів) + `FileDropzone` (свій, у HeroUI v3 немає) + `ChangeAvatarModal` (row action
на /users). E2E: StorageService підміняється in-memory фейком (`overrideProvider`), file-type замокано
міні-детектором magic bytes — живий SeaweedFS тестам не потрібен.

**DataGrid (`apps/web/src/components/data-grid/`, обидві сторінки /users і /jobs на ньому):**
публічний API — фабрика `createDataGrid<TFilters, TItem>()` на рівні модуля сторінки (аналог
defineFilters: замикання фіксує типи один раз, свій createContext на виклик → усе типізовано без
кастів). Повертає компаунд-набір: `Grid.Root` (тримає ВЕСЬ стан — фільтри в URL, query, selection —
і роздає контекстом), `Grid.Filters` (тулбар; фільтри масивом як columns), `Grid.Table`,
`Grid.SelectionSummary` («N selected» + Clear + опційний render-prop для bulk-дій), `Grid.filter`
(фабрики `search()`/`select({ key, options })`). Фетчинг: сторінка декларує «як фетчити» пропом
`useListQuery={(params, gridOptions) => useUsersFindAll(params, { query: gridOptions })}` —
замикання виконується ЯК ХУК усередині Root (мусить безумовно кликати той самий orval-хук; імʼя
пропа use* — вимога rules-of-hooks); Root сам домішує keepPreviousData і нормалізує page;
розширення — спред `{ ...gridOptions, refetchInterval }` (еталон — jobs.tsx). Саме замикання, а НЕ
queryOptions-обʼєкт: orval-хуки мають 4 перевантаження + DataTag, generic-over-hook плутає
виведення типів. Вибір рядків: `selection` на Root — `true` (внутрішній стан) або зовнішній
`useDataGridSelection()` (controlled); Root сам скидає вибір при зміні ЗВУЖУВАЛЬНИХ фільтрів
(пошук/доменні — вибрані рядки могли випасти з результату), але НЕ при page (накопичення між
сторінками — фіча) і НЕ при сортуванні (склад результату той самий). Кастомний бізнес-фільтр = обʼєкт `{ id, render(grid) }`
(еталон — `userStatusFilter` в users.tsx). Headless-нутрощі експортовані як escape hatch:
`useDataGridFilters` (validateSearch роуту = runtime-гарантія TFilters; debounce пошуку, скидання
page), `toGridQueryResult` (затемнення по `isPlaceholderData`, НЕ `isFetching` — інакше
refetchInterval блимає). Boolean-фільтри в URL/query їдуть РЯДКОМ `'true'/'false'` (wire-формат;
не reuse transform-схем contracts, що дають boolean). «Search» у назвах TanStack Router = URL
query, не текстовий пошук — у гріді все зветься Filters. Інвалідація списку після мутацій — за
сторінкою (queryClient + `getUsersFindAllQueryKey()`), грід нею не володіє.

**Шари backend-модуля (обов'язково):** DTO (`createZodDto` зі схеми contracts) → Service
(логіка + Prisma) → Mapper (явний мапінг Prisma→response; не витікають `passwordHash` тощо) →
Controller (HTTP + Swagger-метадані). Відповіді: сутність — плоский об'єкт;
список — `{ items, total, page, limit, totalPages }`.

## Критичні правила та підводні камені

1. **Нова shared-ліба** = три місця: `tsconfig.base.json` paths + `apps/api/tsconfig.json` paths +
   `apps/api/webpack.config.js` alias/allowlist (tsc НЕ переписує aliases — саме тому webpack).
2. **Zod 4**: нормалізація ДО валідації — `z.string().trim().toLowerCase().pipe(z.email())`
   (формат-перевірки виконуються до transform-ів). Не використовувати `z.coerce.date()` у
   response-схемах — **дати в контрактах тільки `z.iso.datetime()`** (ISO-рядки, wire-формат);
   мапери роблять `date.toISOString()`.
3. **Response-DTO**: `Dto.Output` працює лише із Zod 4; для OpenAPI обов'язковий
   `cleanupOpenApiDoc()` (nestjs-zod v5; `patchNestJsSwagger` — застарілий v4 API).
4. `operationIdFactory` у `apps/api/src/openapi.config.ts` дає `authLogin`/`usersFindAll` —
   з них orval генерує назви хуків. Не змінювати без регенерації фронта.
5. Логи пишуться в `join(process.cwd(), 'logs')` — команди api запускати з cwd `apps/api`
   (pnpm --filter це гарантує).
6. ESLint: strict-type-checked всюди; для `apps/web` вимкнено explicit-return-type;
   `throw redirect()` TanStack Router — легальний виняток only-throw-error (інлайн-disable).
7. pnpm 10 блокує build-скрипти — список дозволених у root `package.json` → `pnpm.onlyBuiltDependencies`.
8. **pg-boss v12 — ESM-only**: (а) він external у webpack-збірках → має бути ПРЯМОЮ залежністю
   apps/api і apps/worker (pnpm-строгість); runtime ок — Node 24 вміє require(esm);
   (б) Jest його не вантажить (потрібні Node ≥24.9 + experimental-vm-modules) → у e2e
   він замокан через `moduleNameMapper` (`apps/api/test/__mocks__/pg-boss.ts`); зникне з міграцією на Vitest.
9. **pg-boss send-опції**: не передавати ключі зі значенням `undefined` — його attorney-валідація
   падає (`priority must be an integer`). Опції збирати умовно (див. PgBossJobDispatcher).
10. **@aws-sdk/client-s3 + presigned PUT**: обов'язково `requestChecksumCalculation: 'WHEN_REQUIRED'`
    (+ response-аналог) у конфігу S3Client — інакше SDK вшиває в presigned URL CRC32-чексуму
    ПОРОЖНЬОГО payload (`x-amz-checksum-crc32=AAAAAA==`), сховище валідує її проти реального тіла
    і відхиляє upload 400-кою (спіймано на живому SeaweedFS). SDK — пряма залежність apps/api,
    apps/worker і libs/shared (webpack externals, як pg-boss).
11. **file-type — ESM-only** (та сама категорія, що pg-boss): types не резолвляться під
    moduleResolution=node10 → ручна декларація `apps/api/src/types/file-type.d.ts`; ts-node її бачить
    лише з `"ts-node": {"files": true}` у tsconfig (без цього openapi:generate падає); у e2e замокано
    через moduleNameMapper (`test/__mocks__/file-type.ts`). Runtime ок — Node 24 require(esm).
12. **HeroUI v3** (НЕ v2/NextUI): без Provider; `@import '@heroui/styles'` після tailwindcss у index.css;
    тема = `class` + `data-theme` на `<html>` (next-themes, `attribute={['class','data-theme']}`,
    storageKey `saas_theme`). Compound API: `Table.Content/Header/Body`, `Dropdown.Popover/Menu/Item`,
    `AlertDialog.Backdrop/Container/Dialog`, `Pagination.Content/Item/Link`. Семантичні токени в розмітці:
    `bg-background/bg-surface`, `text-foreground/text-muted/text-danger/text-link`, `border-border`.
    RHF: `register()` кладеться прямо на `<Input>` усередині `<TextField isInvalid>` + `<FieldError>`.
    Мінімалізм — рішення користувача: тільки потрібні компоненти, без пакетів іконок (інлайн-SVG).

## Зафіксовані рішення (НЕ переглядати без запиту користувача)

| Питання           | Рішення                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORM               | **Prisma 7** (Drizzle розглянуто й відхилено)                                                                                                                                       |
| Черги             | **pg-boss v12** поверх Postgres (BullMQ відхилено). ✅ Реалізовано у фазі 2.1 за власним інтерфейсом `JobDispatcher`; транзакційна постановка — `send(..., { tx })` через `fromPrisma`   |
| Мультитенантність | **Відкладена.** План: shared schema + `tenantId`, tenant = Organization + Membership, nestjs-cls + Prisma Client Extension. Postgres RLS — НЕ вмикаємо поки                         |
| Auth              | Власна реалізація fibo-admin as-is (better-auth/Keycloak/Clerk розглянуті й відхилені)                                                                                              |
| Zod               | v4 (закрито у фазі 1)                                                                                                                                                               |
| Монорепо          | pnpm + Turborepo (Nx відхилено)                                                                                                                                                     |
| Форми (web)       | **RHF + zodResolver + обгортки** в `apps/web/src/components/form/` (FormTextField/FormSelect через useController; applyServerError: 409 → setError поля, решта → errors.root.server). TanStack Form розглянуто — свідомий кандидат на майбутню міграцію, поки форм мало |
| Create user (API) | Пароль **обов'язковий** — адмін задає початковий (argon2-хеш у UsersService, у Prisma йде тільки passwordHash). Зміна пароля — НЕ через users PATCH (окремий security-флоу)          |
| Файли             | **S3 API як абстракція** (dev: SeaweedFS, Apache 2.0; Garage відхилено — AGPL, RustFS — alpha, MinIO — репо заархівовано). **Presigned двофазний upload** (proxy через API відхилено). Віддача — тільки короткоживучі presigned GET після authz. ClamAV — беклог |
| i18n              | **Бекенд — коди, текст рендерить споживач** (API не читає Accept-Language; ApiError.message — en-діагностика, юзеру не показується). i18next: react-i18next на фронтах + той самий i18next у worker (email). JSON у репо: спільне — `libs/i18n`, фічеве — `apps/*/locales`; TMS відкладено до другої мови. Стартово тільки `en`. Деталі і фази — `docs/i18n-plan.md` |

## Беклог фази 2 (пріоритети — див. docs/roadmap.md)

- ✅ pg-boss + `apps/worker` — зроблено (2.1). ✅ notifications (welcome-email через Mailpit,
  локалізовано) — зроблено (I18N-3).
- **Безпека auth**: (а) reuse-detection ротованих refresh-токенів — зараз повторне використання
  ротованого токена дає 401, але НЕ відкликає інші сесії (рядок видалено; треба `revokedAt`
  замість delete); (б) refresh у httpOnly cookie замість localStorage.
- RBAC: permissions-рядки (`tickets:write`) + `@RequirePermissions()` guard.
- Organizations + Memberships + Invitations (основа мультитенантності).
- Доменні модулі: customers (еталонний CRUD) → tickets (workflow + події) → billing
  (PaymentProvider інтерфейс + fake-провайдер → Stripe) → notifications → audit-log.
