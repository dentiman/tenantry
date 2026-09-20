# SaaS Skeleton — agent instructions

This repository is a forkable foundation for multitenant CRM/ERP products. Preserve the
existing architectural decisions and conventions unless the user explicitly asks to revisit
them. Keep changes narrowly scoped, inspect the relevant implementation and documentation
before editing, and do not overwrite unrelated work in a dirty worktree.

## Repository map

- `apps/api`: tenant/data-plane NestJS API on port 3001. Contains auth, users, files,
  activities, and health. All tenant access is scoped through `TenancyModule` and PostgreSQL
  RLS.
- `apps/platform-api`: control-plane NestJS API on port 3002. Contains platform auth,
  tenant lifecycle management, and pg-boss job monitoring. It uses `SystemPrismaModule` and
  the `saas_platform` role; never import tenant context into this application.
- `apps/worker`: NestJS application context without HTTP. Contains pg-boss handlers, cron
  jobs, thumbnail generation, and localized email delivery.
- `apps/web`: tenant React SPA on port 5173.
- `apps/platform-web`: control-plane React SPA on port 5174.
- `libs/contracts`: Zod 4 request/response schemas and inferred API types. This is the only
  source of truth for API types. Platform contracts are exposed through the `/platform`
  package subpath and are not re-exported from the root entry point.
- `libs/database`: Prisma 7 schema, migrations, seed, database roles, tenant context,
  tenant-aware transactions, and system Prisma access.
- `libs/i18n`: shared frontend i18next resources.
- `libs/shared`: shared error handling, jobs, inbox idempotency, activity recording, and S3
  storage infrastructure.
- `docker`: local PostgreSQL 17, Mailpit, and SeaweedFS configuration plus the self-hosted
  production compose file.
- `docs`: detailed architecture, roadmap, commands, error handling, i18n, file storage,
  database seed/reset, multitenancy, and activity-log documentation.

Read the relevant focused document before changing a subsystem:

- `docs/architecture-proposal.md`
- `docs/roadmap.md`
- `docs/commands.md`
- `docs/error-handling.md`
- `docs/i18n-plan.md`
- `docs/file-storage.md`
- `docs/database-seed.md`
- `docs/multi-tenancy-architecture.md`
- `docs/activity-log.md`

## Core architecture rules

### API contracts and backend modules

The type pipeline is:

`Zod schema -> createZodDto -> Swagger/OpenAPI -> orval -> TanStack Query hooks`

- Do not create handwritten API request or response types. Infer types from Zod schemas in
  `libs/contracts`.
- Backend modules follow `DTO -> Service -> Mapper -> Controller`.
- Services own business logic and Prisma calls. Mappers explicitly convert Prisma records to
  responses so fields such as `passwordHash` never leak.
- Return a flat object for a single entity and
  `{ items, total, page, limit, totalPages }` for paginated lists.
- API dates are ISO strings declared with `z.iso.datetime()`. Do not use `z.coerce.date()` in
  response schemas; mappers call `date.toISOString()`.
- In Zod 4, normalize before format validation with a pipeline such as
  `z.string().trim().toLowerCase().pipe(z.email())`.
- Response DTOs use `Dto.Output`, and OpenAPI generation must run through
  `cleanupOpenApiDoc()`.
- Do not change `operationIdFactory` casually: its output defines generated orval hook names.
- All routes are authenticated by default. Mark intentional public routes with `@Public()`.

After changing tenant API contracts or controllers, run and commit both generated artifacts:

```bash
pnpm openapi:generate
pnpm web:codegen
```

After changing platform API contracts or controllers, run and commit both platform artifacts:

```bash
pnpm platform:openapi:generate
pnpm platform:web:codegen
```

### Multitenancy and database access

- PostgreSQL RLS is the primary tenant-isolation enforcement mechanism.
- Tenant scoping must remain invisible to domain services. The Prisma extension sets
  `app.tenant_id`; it does not inject `where: { tenantId }`, and database defaults populate
  tenant columns. A `tenantId` added to ordinary domain service arguments is a design smell.
- Use `TenantTransactions.withTenantTx` for tenant transactions. Raw Prisma `$transaction`
  bypasses the tenant extension and is forbidden by ESLint.
- Synchronous business effects that must be atomic belong in the same tenant transaction.
  Pass the transaction to `ActivityRecorder.record(tx, ...)` and transactional job dispatch.
- Use `SystemPrismaService` only for explicitly system-wide work such as control-plane access
  or system cron jobs. Do not use it to bypass tenant isolation in domain code.
- Tenant tables require `tenant_id`, appropriate composite foreign keys/indexes, and RLS
  policies with both `USING` and `WITH CHECK`. Follow existing migrations exactly.
- Tests that need cross-tenant setup or assertions use `SystemPrismaService`; tenant-domain
  behavior must still be exercised through the tenant-scoped path.
- The database roles are fixed: `saas_migrator` owns/migrates schema, `saas_app` is the
  restricted runtime role, and `saas_platform` has the deliberate control-plane bypass.
- The platform API has separate identities, JWT secret, and database role. Tokens from the
  tenant and platform planes must never validate across planes.
- `pnpm db:reset` is destructive and local-development-only. It drops and recreates the whole
  database, restores roles/default privileges, deploys migrations, and seeds data. Do not
  replace it with `prisma migrate reset`, which invalidates grants tied to the `public` schema
  OID.

### Authentication

- Tenant access JWTs contain `{ sub, email, role, tenantId }`; `tenantId` always comes from the
  database record.
- Tenant refresh tokens use `tenantId:tokenId:secret`, rotate on refresh, and store only an
  Argon2 hash of the secret.
- Public self-registration does not exist. Tenant administrators create users; platform
  operators create tenants and their initial administrator.
- Login checks both `user.isActive` and `tenant.isActive` and returns the same unauthorized
  response for either failure.
- Tenant web keeps the access token in memory and the refresh token in local storage. Platform
  web deliberately persists its 60-minute access token in local storage because it currently
  has no refresh flow.

### Errors and localization

- Every API failure is normalized to the shared `ApiError` envelope:
  `{ statusCode, code, message, fieldErrors?, requestId }`.
- Keep error codes closed and machine-readable. The frontend localizes codes; backend
  diagnostic messages are English and are not user-facing copy.
- `AllExceptionsFilter` must continue to normalize Zod errors, known Prisma errors, database
  availability failures, and unexpected exceptions. Mask all 5xx response details while
  logging them with `requestId`.
- For form errors, use the existing `applyServerError`: known field errors call `setError`, and
  remaining 4xx errors use `errors.root.server`. Forms need complete `defaultValues` so field
  names can be validated safely.
- Network errors, 5xx responses, and 403 responses go through the global deduplicated toast
  path; 401 is handled by the refresh interceptor.
- UI text belongs in i18next resources. The backend emits codes/data, not localized UI text.
  Worker email content uses its local i18next resources and the user's current locale.

### Jobs and activities

- Define jobs with `defineJob`/`defineTenantJob` and a Zod payload schema.
- API code injects `JobDispatcher`; worker handlers use `@Injectable()` and `@JobHandler(def)`.
- Tenant jobs always carry `tenantId`; dispatch obtains it from tenant context and worker
  registration restores tenant context from the payload.
- When building pg-boss send options, omit absent keys instead of assigning `undefined`.
- Use `JobInboxService.runOnce` for idempotent database effects. External email delivery is
  at-least-once unless a dedicated provider-level idempotency mechanism is added.
- Activities store a closed event type and structured payload, never rendered prose. Frontends
  render messages through i18next.
- Record synchronous activities inside the business transaction. Record asynchronous
  activities through inbox-protected handler work after the corresponding side effect.
- The activity feed uses keyset pagination ordered by `(createdAt, id) DESC`; preserve cursor
  stability and avoid offset pagination.

### Files and object storage

- S3 API is the storage abstraction. Local development uses SeaweedFS; production may use any
  compatible S3 implementation through `S3_*` environment variables.
- Upload is two-phase: create a `PENDING` file and presigned PUT, upload directly from the
  browser, then complete after `HeadObject`, size, and magic-byte validation.
- Never trust client `Content-Type`. Invalid content is deleted from storage and the database.
- Only `READY` files receive short-lived presigned download URLs. Storage object keys are not
  exposed as public API.
- Keep `requestChecksumCalculation: 'WHEN_REQUIRED'` and its response equivalent in S3 client
  configuration; otherwise presigned uploads can contain a checksum for an empty body.
- Image completion dispatches idempotent thumbnail generation. A cron job removes abandoned
  pending uploads.

### Frontend and UI

- Both frontends use React 19, Vite 7, TanStack Router/Query, Zustand, Tailwind 4,
  react-hook-form, react-i18next, and shadcn/ui on Base UI (style `base-nova`).
- Shared UI lives in `libs/ui`: the single theme (`styles.css`), vendored registry primitives
  (`components/ui/**`), the data grid, form wrappers, and shared helpers. Neither application
  has its own `components/ui/`. Details: `docs/frontend/ui-stack.md`.
- Registry primitives are vendored on purpose. Inspect updates with
  `pnpm dlx shadcn@4.19.0 diff <name>` inside `libs/ui`, and check the local-edit registry
  first: edits are marked with the comment "ЛОКАЛЬНА ПРАВКА реєстру" and a blind update
  would silently drop them. Run app blocks from the target application directory.
- Theme files own semantic color pairs, typography, and theme-level radius values. Control
  height, padding, focus geometry, popup placement, and density variants stay in component
  recipes; do not add a select-specific height token to the theme.
- Compose parts (`DialogContent`, `TableHead`, `DropdownMenuItem`); do not use compound
  namespaces. Substitute the rendered element with `render={<Button/>}`, not `asChild`.
- Do not write a wrapper over a primitive that already exists in the registry. Where to look
  for a new component: `docs/frontend/ui-registry.md`.
- Use existing form wrappers and data-grid abstractions before introducing page-local copies.
- Define grids with `createDataGrid<TFilters, TItem>()` at module scope. `Grid.Root` owns URL
  filters, query state, and selection.
- The `useListQuery` prop is intentionally a hook closure and must call the same orval hook
  unconditionally. Preserve the `use*` name for hook linting.
- Boolean URL/query filters use the wire strings `'true'` and `'false'`.
- Dim stale grid data using `isPlaceholderData`, not `isFetching`, so background polling does
  not flash the table.
- Invalidate generated list query keys from the page after mutations; the grid does not own
  business mutations.
- Icons come from `lucide-react` with per-icon imports. Inside components use
  `data-icon="inline-start"|"inline-end"` and no size classes; the component sets the size.
- Do not set control heights at the call site. The project deliberately deviates from the
  registry defaults: 36px default controls and a solid `ring-2` focus ring in the project's
  primary blue. Both are fixed decisions.

## Toolchain pitfalls

- A new shared library or alias may require coordinated changes in root TypeScript paths,
  application TypeScript paths, and webpack alias/allowlist configuration. TypeScript does not
  rewrite runtime aliases.
- Vite/Rollup resolves workspace subpaths through package `exports`, not TypeScript paths.
- App-specific `tsconfig` `paths` replace inherited paths. Check `baseUrl` whenever adding a
  subpath import.
- `pg-boss` v12 and `file-type` are ESM-only. Preserve the existing webpack external/direct
  dependency and Jest mock arrangements.
- Packages externalized by webpack, including pg-boss and AWS SDK packages, must be direct
  dependencies of runtime applications under pnpm's strict dependency model.
- pnpm 10 permits dependency build scripts only through root `pnpm.onlyBuiltDependencies`.
- API logs are relative to `process.cwd()`; use repository scripts so the application starts
  with the expected working directory.
- Do not pass a migration name as `pnpm db:migrate:dev -- --name X`. Use:

  ```bash
  cd libs/database && pnpm exec prisma migrate dev --name X
  ```

  Prisma config and DB scripts load the repository `.env` followed by `.env.local`
  automatically. In a non-zero workspace slot they reject local DB URLs whose port does not
  match the slot, and linked worktrees without `.env.local` reject DB commands before
  connecting. Do not bypass this guard with a slot-0 URL.

## Workspace infrastructure (cloud/agent workspaces)

This repo supports isolated per-workspace dev stacks ("workspace slots",
`docs/workspace-slots.md`): `pnpm ws:init [N]` brings up a dedicated Postgres/Valkey/
SeaweedFS/Mailpit stack on ports shifted by `+100·N` and resets its database; `pnpm ws:down`
tears it down again. It is safe to call `ws:init` repeatedly — it reuses the same slot for
this checkout and always leaves the database in a clean, migrated, seeded state.

Slot 0 and its base ports are permanently reserved for the main checkout, whether its
processes are running or not. Automatic allocation also treats slots recorded in
`.env.local` of other git worktrees as reserved while stopped. Do not select the next free
port manually: Vite uses strict ports, and tenant API/web use slot-specific `API_PORT` to
prevent tool-injected `PORT` from moving a non-zero process onto slot 0.

Only run `pnpm ws:init` when the task actually needs live infrastructure:

- Database work: migrations, seed data, Prisma queries, RLS/tenant-isolation behavior.
- Running the tenant/platform/e2e test suites (`pnpm api:test:e2e`, `pnpm platform:test:e2e`).
- Browser verification of a running app (`web:dev`/`platform:web:dev` and manual/automated
  checks against them).
- Anything touching Redis/Valkey-backed behavior: realtime gateway, presence, rate limiting.

Do not bring up the stack for pure code/filesystem work — reading, editing, refactoring,
`pnpm lint`/`pnpm typecheck`/`pnpm build` do not require a running stack. When you did start
a slot for a task, run `pnpm ws:down` once you are done so the workspace does not leak
running containers.

## Common commands

```bash
pnpm docker:up
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

pnpm api:dev
pnpm platform:dev
pnpm worker:dev
pnpm web:dev
pnpm platform:web:dev

pnpm lint
pnpm typecheck
pnpm build
pnpm api:test:e2e
pnpm platform:test:e2e
```

Local services and seeded identities:

- Tenant API: `http://localhost:3001`, Swagger at `/api/docs`
- Platform API: `http://localhost:3002`, Swagger at `/api/docs`
- Tenant web: `http://localhost:5173`
- Platform web: `http://localhost:5174`
- Mailpit UI: `http://localhost:8025`
- SeaweedFS S3: `http://localhost:8333`
- Default tenant: `default`
- Tenant administrator: `admin@example.com` / `Admin1234567`
- Platform operator: `platform@example.com` / `Platform12345`

## Validation expectations

- Run the smallest relevant checks while iterating, then run `pnpm lint` and
  `pnpm typecheck` for cross-package TypeScript changes.
- Run `pnpm build` when changing package exports, aliases, bundling, generated clients, or app
  integration.
- Run tenant or platform e2e suites when behavior crosses HTTP, authentication, RLS,
  transactions, Prisma, jobs, or error normalization. These suites use a separate test
  database and must not touch development data.
- Add or update tests for behavior changes, especially tenant isolation, cross-plane auth,
  transaction atomicity, cursor pagination, and generated contract changes.
- Do not report a change as verified unless the relevant command actually completed
  successfully; distinguish static inspection from a live integration check.

## Fixed decisions

Do not revisit these without an explicit user request:

- Prisma 7 rather than Drizzle.
- pg-boss v12 on PostgreSQL rather than Redis/BullMQ.
- PostgreSQL RLS as the primary multitenancy enforcement mechanism.
- One user belongs to one tenant; there is no Membership model.
- Separate tenant and control planes, each with its own API, UI, identity, JWT secret, and
  database role.
- Custom authentication rather than an external auth platform.
- pnpm workspaces plus Turborepo.
- React Hook Form with Zod resolver and repository form wrappers.
- S3-compatible direct presigned uploads; SeaweedFS for development.
- Consumer-side localization through i18next, initially with English resources.

Current roadmap priorities are defined in `docs/roadmap.md`. Major remaining areas include
refresh-token hardening, RBAC permissions, MT-4 concerns such as subdomains/invitations/billing,
and domain modules such as customers, tickets, and billing.
