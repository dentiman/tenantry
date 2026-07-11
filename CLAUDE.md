# SaaS Skeleton — CLAUDE.md

Форк-скелетон для мультитенантних CRM/ERP-систем (білінг, кастомери, тікети, черги).
Базові патерни портовані з `/Users/dentiman/dev/projects/fibo-admin` і розширені.
**Фаза 1 завершена і перевірена** (2026-07-11): монорепо, auth + users end-to-end, конвеєр контрактів, CI.
**Фаза 2.1 завершена і перевірена** (2026-07-11): pg-boss + `libs/shared` (JobDispatcher/@JobHandler) + `apps/worker`.
Документи: `docs/architecture-proposal.md` (усі рішення з обґрунтуванням), `docs/roadmap.md` (фази), `README.md` (quickstart).

## Команди

```bash
pnpm docker:up            # PostgreSQL 17 (OrbStack у користувача, не Docker Desktop)
pnpm db:generate          # Prisma client → libs/database/src/generated (gitignored)
pnpm db:migrate:dev       # міграції (dev)
pnpm db:seed              # admin@example.com / Admin12345
pnpm api:dev              # API: http://localhost:3001, Swagger: /api/docs
pnpm worker:dev           # Worker: pg-boss споживачі + cron (окремий процес, без HTTP)
pnpm web:dev              # Web: http://localhost:5173 (Vite проксі /api → 3001)
pnpm openapi:generate     # apps/api/openapi.json (ts-node, потрібен .env з JWT_SECRET)
pnpm web:codegen          # orval: openapi.json → apps/web/src/api/generated
pnpm lint && pnpm typecheck && pnpm build
pnpm api:test:e2e         # 40 jest+supertest тестів; ВИМАГАЄ запущеного Postgres; ЧИСТИТЬ таблиці БД
```

Після зміни контрактів/контролерів завжди: `openapi:generate` → `web:codegen` (обидва артефакти комітяться).

## Архітектура

```
apps/api        NestJS 11 (webpack-збірка). Модулі: auth, users, health. Pino, PrismaExceptionFilter
apps/worker     NestJS 11 без HTTP (createApplicationContext). Хендлери job-ів + cron через pg-boss
apps/web        React 19 + Vite 7, TanStack Router/Query v5, Zustand, Tailwind 4, react-hook-form,
                HeroUI v3 (React Aria; compound-компоненти) + next-themes (light/dark/system)
libs/contracts  Zod 4 схеми + z.infer типи — ЄДИНЕ джерело правди типів API (залежить лише від zod)
libs/database   Prisma 7 (adapter-pg): schema, migrations, seed, PrismaService/PrismaModule (@Global)
libs/shared     Черги: defineJob (Zod payload), JobDispatcher (абстракція, pg-boss замінюваний),
                @JobHandler() + DiscoveryService-автореєстрація, JobInboxService (processed_jobs)
docker/         compose (name: saas-skeleton — namespaced volume, НЕ прибирати name!)
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

**Черги (фаза 2.1):** job = `defineJob(name, zodSchema, { cron?, retry* })` у `libs/shared/src/jobs/definitions/`.
API: `JobsModule.forApi()` (global) → інжект `JobDispatcher` → `send(def, payload, { singletonKey?, tx? })`
(`tx` = Prisma-транзакція, транзакційна постановка через `fromPrisma`). Worker: `JobsModule.forWorker()` +
`@Injectable() @JobHandler(def) class X implements JobHandlerContract` — реєструється автоматично, cron теж.
Ідемпотентність: `JobInboxService.runOnce(context, fn)` — вставка в processed_jobs + fn в одній транзакції.

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
10. **HeroUI v3** (НЕ v2/NextUI): без Provider; `@import '@heroui/styles'` після tailwindcss у index.css;
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

## Беклог фази 2 (пріоритети — див. docs/roadmap.md)

- ✅ pg-boss + `apps/worker` — зроблено (2.1). Наступний споживач — notifications (welcome-email,
  Mailpit у dev), підключається в `UserRegisteredHandler`.
- **Безпека auth**: (а) reuse-detection ротованих refresh-токенів — зараз повторне використання
  ротованого токена дає 401, але НЕ відкликає інші сесії (рядок видалено; треба `revokedAt`
  замість delete); (б) refresh у httpOnly cookie замість localStorage.
- RBAC: permissions-рядки (`tickets:write`) + `@RequirePermissions()` guard.
- Organizations + Memberships + Invitations (основа мультитенантності).
- Доменні модулі: customers (еталонний CRUD) → tickets (workflow + події) → billing
  (PaymentProvider інтерфейс + fake-провайдер → Stripe) → notifications → audit-log.
