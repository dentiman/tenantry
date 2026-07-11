# SaaS Skeleton — CLAUDE.md

Форк-скелетон для мультитенантних CRM/ERP-систем (білінг, кастомери, тікети, черги).
Базові патерни портовані з `/Users/dentiman/dev/projects/fibo-admin` і розширені.
**Фаза 1 завершена і перевірена** (2026-07-11): монорепо, auth + users end-to-end, конвеєр контрактів, CI.
Документи: `docs/architecture-proposal.md` (усі рішення з обґрунтуванням), `docs/roadmap.md` (фази), `README.md` (quickstart).

## Команди

```bash
pnpm docker:up            # PostgreSQL 17 (OrbStack у користувача, не Docker Desktop)
pnpm db:generate          # Prisma client → libs/database/src/generated (gitignored)
pnpm db:migrate:dev       # міграції (dev)
pnpm db:seed              # admin@example.com / Admin12345
pnpm api:dev              # API: http://localhost:3001, Swagger: /api/docs
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
apps/web        React 19 + Vite 7, TanStack Router/Query v5, Zustand, Tailwind 4, react-hook-form
libs/contracts  Zod 4 схеми + z.infer типи — ЄДИНЕ джерело правди типів API (залежить лише від zod)
libs/database   Prisma 7 (adapter-pg): schema, migrations, seed, PrismaService/PrismaModule (@Global)
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

## Зафіксовані рішення (НЕ переглядати без запиту користувача)

| Питання           | Рішення                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORM               | **Prisma 7** (Drizzle розглянуто й відхилено)                                                                                                                                       |
| Черги             | **pg-boss** поверх Postgres (BullMQ відхилено; транзакційна постановка = outbox не потрібен). Реалізація у фазі 2, за власним інтерфейсом `JobDispatcher`, щоб форки могли замінити |
| Мультитенантність | **Відкладена.** План: shared schema + `tenantId`, tenant = Organization + Membership, nestjs-cls + Prisma Client Extension. Postgres RLS — НЕ вмикаємо поки                         |
| Auth              | Власна реалізація fibo-admin as-is (better-auth/Keycloak/Clerk розглянуті й відхилені)                                                                                              |
| Zod               | v4 (закрито у фазі 1)                                                                                                                                                               |
| Монорепо          | pnpm + Turborepo (Nx відхилено)                                                                                                                                                     |

## Беклог фази 2 (пріоритети — див. docs/roadmap.md)

- pg-boss + окремий `apps/worker` (той самий доменний код, інший entry-point); ідемпотентність:
  singletonKey + стан-переходи (`updateMany where status`) + processed_jobs inbox.
- **Безпека auth**: (а) reuse-detection ротованих refresh-токенів — зараз повторне використання
  ротованого токена дає 401, але НЕ відкликає інші сесії (рядок видалено; треба `revokedAt`
  замість delete); (б) refresh у httpOnly cookie замість localStorage.
- RBAC: permissions-рядки (`tickets:write`) + `@RequirePermissions()` guard.
- Organizations + Memberships + Invitations (основа мультитенантності).
- Доменні модулі: customers (еталонний CRUD) → tickets (workflow + події) → billing
  (PaymentProvider інтерфейс + fake-провайдер → Stripe) → notifications → audit-log.
