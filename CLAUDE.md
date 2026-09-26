# SaaS Skeleton — CLAUDE.md

Forkable skeleton for multitenant CRM/ERP products (billing, customers, tickets, queues).
Two planes, each a full stack: **tenant plane** (`apps/api` + `apps/web`) and **control
plane** (`apps/platform-api` + `apps/platform-web`, operator-facing, manages tenants).
Auth and core patterns were ported from a prior project (`fibo-admin`) and extended here.

This file covers what's needed on nearly every task: commands, directory map, cross-cutting
conventions, and rules that are easy to violate by accident. Subsystem depth (data model,
protocol, historical rationale, gotchas caught during implementation) lives in `docs/` —
read the relevant doc before working in that area instead of expecting it here.

## Documentation map

- `docs/multi-tenancy-architecture.md` — **the** reference for multitenancy: schema, RLS,
  tenant context, both planes' auth, queues, contract for adding a new domain module
- `docs/auth-hardening-plan.md` — current auth/session state and the AUTH-0…4 roadmap
  (rate limiting, session-as-entity, cookie migration, password recovery, 2FA)
- `docs/event-driven-architecture.md` — messaging (events/commands), topology, DLQ
- `docs/realtime.md` + `docs/realtime-internals.md` — Socket.IO/Valkey gateway, presence,
  last-seen
- `docs/notifications.md` — in-app notification inbox
- `docs/activity-log.md` — activity feed (`activities`/`activity_links`)
- `docs/file-storage.md` — S3 presigned upload/download flow
- `docs/error-handling.md` — `ApiError` envelope and normalization rules
- `docs/i18n-plan.md` — localization approach and phases
- `docs/customers.md`, `docs/calendar.md`, `docs/settings.md`, `docs/account-settings.md` —
  reference domain modules; read before extending or copying their pattern
- `docs/deploy-swarm.md` — GitLab CI → Docker Swarm deploy
- `docs/workspace-slots.md` — isolated per-worktree dev stacks (`pnpm ws:init`)
- `docs/commands.md` — full `package.json` command reference
- `docs/roadmap.md` — priorities and what's intentionally not built yet
- `docs/frontend/ui-stack.md` — primitives, tokens, form and **DataGrid** conventions
  (**start here** for any UI work, including `createDataGrid<TFilters, TItem>()`);
  `docs/frontend/ui-registry.md` — where to find a new component; `docs/frontend/theming.md` —
  color/typography tokens; `docs/frontend/app-shell.md` — two-level navigation shell;
  `docs/frontend/brand-backdrop.md` — brand backdrop + glass shell for showcase routes
  (`staticData.backdrop`, only `/guide` so far; work screens stay solid);
  `docs/frontend/layout-structure.md` — quick visual map + naming of shell columns/
  panels (rail, area sidebar, context panel) for both frontends;
  `docs/frontend/ui-known-issues.md` — open vendored-code issues
- `docs/chat.md` — **the** reference for chat. §7 holds the phase plan; **CHAT-0.1 is built**
  (internal conversations over REST: `seq`, cursor feed, `clientMessageId`, read state, the
  default channel, the Chat area screen) and **there is no realtime in it yet** — the screen
  refreshes on window focus and after sending, by design. §7.6 lists the invariants `0.2`/`0.3`
  build on; don't break them. `docs/bulk-operations.md` — **design fixed, not implemented**
  (a disabled demo slot on `/users`); not a working feature.
- `docs/ai-assistant.md` — **the** reference for the sidebar AI assistant: fixed decisions and
  why, the research behind them (OpenAI-compat is lossy, provider strategies, tool-calling
  mechanics, files), budget, privacy, and phases AI-0…AI-4. §0 keeps the decision sequence.
  Distinct from `docs/chat.md` (that's human/customer conversations);
  `docs/ai-assistant-implementation.md` — what AI-0 actually shipped, on `FakeLlmProvider` only
  (no key, no network, no cost): data model, the two access boundaries, the streaming protocol
  and why a socket event may carry payload here, queue options, config. Read the second before
  touching anything under `ai/`, the first before planning the next phase.

## Planning layers

Spec-driven planning runs through OpenSpec (`openspec/`, schema `spec-driven`). The CLI has no
epic primitive, so the split below is a convention — it is also written into
`openspec/config.yaml` under `context`, which the CLI feeds into every artifact-generation
request, so an agent working a change inherits it without being told.

| Layer | Answers | Stays true |
| --- | --- | --- |
| `docs/<feature>.md` | why a decision was made, what is still open | longer than any phase |
| `openspec/specs/<capability-path>/spec.md` | behaviour the system must have | until behaviour changes |
| `openspec/changes/<name>/` | the work in flight | until archived |

Two rules that are easy to lose:

1. **Promote before archiving.** Anything in a change's `design.md` that will still be true
   afterwards moves into `docs/` first. An archive is not a reference — nobody reads it, and
   live reasoning left there is lost. (`docs/ai-assistant-implementation.md` exists because of
   this rule, not by accident.)
2. **An epic is a capability-path prefix** (`ai-assistant/*`), not a change. A phase is one
   change named with its number (`ai-1-…`), so `openspec list --sort name` reproduces an order
   the CLI does not store; cross-phase dependencies live in the feature doc, since there is no
   `depends-on` field. Split a phase by the capability it touches — work that changes no
   externally observable behaviour declares `skip_specs: true` rather than inventing a
   requirement to pass validation.

## Commands

```bash
pnpm docker:up             # Postgres 17 + Mailpit + Valkey + SeaweedFS
pnpm ws:init [N]           # isolated dev stack for a worktree/agent workspace — see
                           # docs/workspace-slots.md; reserves the slot across git worktrees
                           # even while stopped; slot 0 is always reserved for the main checkout
                           # only needed for DB/e2e/browser/Valkey work
pnpm ws:down               # tear down that slot's containers and volumes
pnpm db:generate           # Prisma client → libs/database/src/generated (gitignored)
pnpm db:migrate:dev        # dev migration (don't pass `--name` through `pnpm ... -- --name X`,
                           # it hangs on a pnpm/prisma flag-duplication bug — instead:
                           # `cd libs/database && pnpm exec prisma migrate dev --name X`)
pnpm db:seed               # idempotent upsert of default tenant/admin/platform-operator
pnpm db:reset              # destructive, local-only: DROP+CREATE DATABASE → roles → migrate → seed
pnpm api:dev                        # tenant API   http://localhost:3001  (Swagger /api/docs)
pnpm platform:dev                   # platform API http://localhost:3002 (Swagger /api/docs)
pnpm worker:dev                     # pg-boss consumers + cron, no HTTP
pnpm web:dev                        # tenant web   http://localhost:5173
pnpm platform:web:dev               # platform web http://localhost:5174
pnpm openapi:generate && pnpm web:codegen                   # after tenant contract/controller changes
pnpm platform:openapi:generate && pnpm platform:web:codegen # after platform contract/controller changes
pnpm lint && pnpm typecheck && pnpm build
pnpm api:test:e2e          # tenant e2e — needs Postgres AND Valkey; do NOT run alongside a
                           # live dev stack (connection-pool exhaustion causes flaky neighbors)
pnpm platform:test:e2e     # platform e2e
pnpm web:test              # Vitest unit tests (currently calendar date/interaction logic)
```

The HTTP ports shown above are slot-0 defaults. Non-zero slots use `+100·N` from their
generated `.env.local`. Start dev processes through the repository `pnpm *:dev` scripts;
Vite uses strict ports, and tenant API/web prefer slot-specific `API_PORT` so a tool-injected
generic `PORT` cannot move them onto slot 0.

Prisma config and all DB scripts load root `.env` followed by `.env.local` automatically.
Never add an ad-hoc fallback or manually substitute slot-0 URLs. In a non-zero slot they
validate every local DB URL against that slot's Postgres port; DB commands in a linked
worktree without `.env.local` fail before connecting. Run `pnpm ws:init` first whenever live
database work is required. Offline `prisma generate`, `validate`, and `format` are exempt.

Generated OpenAPI/orval artifacts are committed. Regenerate and commit both together whenever
a contract or controller changes — see `docs/commands.md` for the full list including
`db:roles`, `db:studio`, `docker:prod:up`.

## Architecture

```
apps/api            Tenant NestJS API. Modules: auth, account (self-service profile/password/
                     sessions — no id in any path, subject is always the JWT), customers,
                     settings (org-level), files, activities, notifications, realtime
                     (Socket.IO gateway), calendar, ai (assistant conversation; no id in any
                     path either), chat (CHAT-0.1: internal conversations, server-assigned
                     `seq`, one access service, no queue/socket seams yet). Pino logging,
                     AllExceptionsFilter via configureApp() (shared between main.ts and e2e).
apps/platform-api   Control-plane NestJS API (MT-3, :3002): platform-auth (separate identity/
                     JWT/DB role), tenants CRUD, jobs monitoring (moved here because
                     `pgboss.*` sits outside RLS).
apps/worker         NestJS application context, no HTTP. Message subscribers
                     (`src/subscribers/`) + cron via pg-boss, MailerService → Mailpit,
                     local i18next for email content. AI reply generation lives here
                     (`ai-generate-reply.subscriber.ts`) — the API never calls a model.
apps/web             Tenant SPA: React 19, Vite 7, TanStack Router/Query v5, Zustand,
                     Tailwind 4, react-hook-form, shadcn/ui on Base UI, react-i18next.
                     Two-level nav shell (`AppRail` + `AreaSidebar`, docs/frontend/app-shell.md):
                     areas Workspace / Chat (placeholder) / Settings (ADMIN) / Playground,
                     plus User settings (entry via avatar menu). Context panel (third column,
                     `libs/ui`) is the default surface for record detail — prefer it over
                     `Sheet` unless the interaction is a dismiss-and-forget overlay.
apps/platform-web    Same stack/shell pattern as apps/web (:5174, proxy → :3002). Areas:
                     Tenants, Operations (Jobs/Queues), User settings. No org-level Settings —
                     the platform itself is the subject.
libs/contracts       Zod 4 schemas + z.infer types — the only source of truth for API types.
                     Platform contracts live under the `/platform` subpath, not re-exported
                     from the root (needs an explicit `exports` entry in package.json — Vite/
                     Rollup resolves workspace subpaths through `exports`, not tsconfig paths).
libs/database        Prisma 7 (adapter-pg): schema, migrations, seed. `src/tenant/` —
                     TenancyModule, TenantContextService (CLS), TenantTransactions.withTenantTx,
                     the tenant Prisma extension (set_config). SystemPrismaService = BYPASSRLS,
                     for control-plane and system-scope cron only.
libs/i18n            Shared i18next resources for both web frontends (worker keeps its own).
libs/ui              Shared UI layer for both frontends: theme (`styles.css`), vendored shadcn
                     primitives (`components/ui/**`), data-grid, form wrappers, page-header
                     portal, context-panel, api-error normalization. Neither app has its own
                     `components/ui/`. See docs/frontend/ui-stack.md.
libs/shared          Messaging (`messaging/`: defineEvent/defineCommand, MESSAGE_TOPOLOGY,
                     MessagePublisher, inbox idempotency, DLQ), notifications recorder,
                     scheduled-notification service, numbering service, S3 storage service.
docker/              Compose for local Postgres/Mailpit/Valkey/SeaweedFS and the self-hosted
                     production compose file (docker/docker-compose.prod.yml).
```

## Type pipeline

Zod schema (`libs/contracts`) → `createZodDto` (nestjs-zod v5) → Swagger
(`@ApiOkResponse({ type: Dto.Output })`, `cleanupOpenApiDoc`) → `openapi.json` → orval →
TanStack Query hooks. There are no hand-written API types.

## Auth

Access JWT (`{ sub, email, role, tenantId }`, 15m). Sessions are a first-class entity —
`AuthSession` / `auth_sessions` (rotating `tokenHash`, a short `prevTokenHash` grace window
for concurrent refreshes, `generation`, sliding `idleExpiresAt`, fixed `absoluteExpiresAt`,
`revokedAt`/`revokedReason` so a revoked row still exists for reuse-detection,
`userAgent`/`ip`/`deviceLabel`). `GET /account/sessions` lists devices,
`DELETE /account/sessions/:id` revokes one, `POST /account/sessions/revoke-all` revokes all
and returns a fresh pair for the caller. `POST /auth/logout` is public and silently
idempotent (always 204). Public self-registration does not exist — tenant admins create
users, platform operators create tenants + their first admin. Login checks both
`user.isActive` and `tenant.isActive` (same 401 for either). Global `JwtAuthGuard`
(`APP_GUARD`, no Passport) cross-checks `payload.tenantId` against the resolved tenant
context; open routes use `@Public()`. `access-token.service.ts` is the single place that
verifies an access token — shared by the HTTP guard and the realtime socket middleware; do
not fork it. Tenant web keeps the access token in memory and the refresh token in
localStorage; platform web keeps its (refresh-less, 60m) access token in localStorage too.
Rate limiting, CORS allowlist, env validation, and the session model above are done
(AUTH-0/AUTH-1). httpOnly-cookie refresh, password recovery, and 2FA are not — see
`docs/auth-hardening-plan.md` for current state and the rest of the plan.

## Errors

Single envelope `ApiError` (`libs/contracts/src/error/`):
`{ statusCode, code, message, fieldErrors?: [{field, message}], requestId }`.
`AllExceptionsFilter` normalizes everything server-side: Zod validation errors, known Prisma
errors (P2002 → 409 with field, P2025 → 404, connection failures → 503), any other 5xx is
masked to a generic message (details only in the log, keyed by `requestId`). Backend messages
are diagnostic English, never user-facing copy — the frontend renders `code` through i18next.
`parseApiError()` / `isGlobalApiError()` (`libs/ui/src/api/api-error.ts`) are shared by both
frontends; network/5xx/403 go to the global toast path, 401 to the refresh interceptor, 4xx in
forms go through `applyServerError()` (fieldErrors → `setError`, rest → `errors.root.server`;
forms need complete `defaultValues` for this to match fields correctly). Details:
`docs/error-handling.md`.

## Messaging (async work)

One runtime, two primitives, in `libs/shared/src/messaging/`: `defineEvent('x.y.v1', schema)`
(0..N subscribers, version is part of the type-level name) and `defineCommand('x.y', schema)`
(exactly one consumer). `tenantId` is never part of the payload schema — it rides the envelope.
Fan-out is done by `publish`, not by handlers: `MESSAGE_TOPOLOGY` is the single manifest of
message → subscribers, and one `publish(tx, def, data, …)` inserts one job per subscriber in
the same transaction, sequentially, fail-fast. `tx` is always the first argument — publishing
outside the transaction that produced the fact is not possible by construction. A subscriber
class without a matching topology entry (or vice versa) crashes the worker at boot, not
silently. Idempotency is keyed by business fact, not by job: `MessageInboxService.runOnce
(envelope, consumerId, fn)`, key `messageId:consumerId`. `NonRetryableMessageError` sends
straight to the shared `dlq` without burning retries; everything else retries with backoff.
Details, including the full subscriber list and error taxonomy: `docs/event-driven-architecture.md`.

## Files

S3 API is the storage abstraction (dev: SeaweedFS; prod: any S3-compatible endpoint via
`S3_*` env). Two-phase upload: `POST /files` validates MIME/size and returns a `PENDING` row +
presigned PUT (browser uploads directly, bytes never touch the API) → `POST /files/:id/complete`
verifies via `HeadObject` and magic bytes (client `Content-Type` is untrusted) → `READY`.
Only `READY` files get short-lived presigned download URLs; object keys are never exposed
directly. Details: `docs/file-storage.md`.

## Backend module layering

DTO (`createZodDto` from a contracts schema) → Service (logic + Prisma) → Mapper (explicit
Prisma → response mapping; never leak `passwordHash` etc.) → Controller (HTTP + Swagger).
List responses: `{ items, total, page, limit, totalPages }`. A related live entity with an FK
(`customer.owner`, `attendees[].user`) is nested as `{id, email, name}` in the response; the
flat `actorType`/`actorId`/`actorLabel` triple is reserved for snapshots without an FK
(activities, notifications — the user may since have been deleted). Input takes flat ids
(`attendees: [{ userId, role }]`) — requests address, responses describe.

## Critical rules and pitfalls

1. A new shared library needs three coordinated edits: `tsconfig.base.json` paths,
   the consuming app's `tsconfig.json` paths, and its `webpack.config.js` alias/allowlist —
   tsc does not rewrite runtime aliases, so webpack needs its own entry.
2. Zod 4: normalize before format validation —
   `z.string().trim().toLowerCase().pipe(z.email())`. Never `z.coerce.date()` in response
   schemas — dates on the wire are `z.iso.datetime()` strings; mappers call
   `date.toISOString()`.
3. Response DTOs need `Dto.Output` (Zod 4 only) and OpenAPI generation must run through
   `cleanupOpenApiDoc()` — the v4 `patchNestJsSwagger` API doesn't work here.
4. `operationIdFactory` (`apps/api/src/openapi.config.ts`) drives orval hook names — changing
   it requires regenerating both frontends.
5. API logs write to `join(process.cwd(), 'logs')` — always start `api`/`platform-api` with
   their own package as cwd (`pnpm --filter` guarantees this; a bare `node dist/main` from repo
   root will not).
6. ESLint is strict-type-checked everywhere; `apps/web` disables explicit-return-type;
   `throw redirect()` (TanStack Router) is an allowed inline-disabled exception to
   only-throw-error.
7. pnpm 10 blocks dependency build scripts by default — allowlist lives in root
   `package.json` → `pnpm.onlyBuiltDependencies`.
8. `pg-boss` v12 is ESM-only: it must be a direct dependency of every app that uses it
   (webpack externals + pnpm's strict resolution), and Jest can't load it — it's mocked via
   `moduleNameMapper` in e2e tests.
9. Never pass `undefined`-valued keys to pg-boss send options — its validator rejects them;
   build the options object conditionally.
10. `@aws-sdk/client-s3` presigned PUT needs `requestChecksumCalculation: 'WHEN_REQUIRED'`
    (and its response equivalent) in the S3Client config, or the SDK bakes an empty-body CRC32
    into the URL and every real upload gets rejected by the store.
11. `file-type` is ESM-only like pg-boss (same webpack-externals + Jest-mock treatment); its
    types need a manual `.d.ts` and `ts-node: { files: true }` for `openapi:generate` to see it.
12. UI stack is shadcn/ui on Base UI (style `base-nova`), shared in `libs/ui` — full reference
    in `docs/frontend/ui-stack.md` (primitives/theme/forms/grid), `docs/frontend/theming.md`
    (color tokens, dark-mode source), `docs/frontend/app-shell.md` (two-level nav shell),
    `docs/frontend/ui-registry.md` (where to find a new component before writing one). The
    handful of rules worth holding in working memory: compose parts
    (`DialogContent`/`TableHead`/`DropdownMenuItem`), never compound namespaces; swap the
    rendered element with `render={<Button/>}`, not `asChild`; controls are a fixed 36px with
    a solid `ring-2` focus ring — this is a deliberate deviation from the registry default and
    is set on the primitive, never at the call site; vendored primitive edits are tagged with
    the comment "ЛОКАЛЬНА ПРАВКА реєстру" (grep that before running `shadcn diff` on a
    primitive, or you'll silently drop a local fix); scrolling anywhere a human sees it goes
    through `libs/ui`'s `ScrollArea`, never bare `overflow-y-auto`. Icons are `lucide-react`,
    colored via the icon token scale (`--icon`/`--icon-strong`/`--icon-muted`), not the text
    color scale.
13. Vite/Rollup resolves workspace subpath imports (`@saas-skeleton/contracts/platform`)
    through the package's `exports` map, not tsconfig `paths` or webpack aliases — a subpath
    package needs an explicit `exports` entry or the frontend build fails while `tsc`/webpack
    stay green.
14. App-level `tsconfig.json` `paths` **replace** inherited `paths` rather than merging with
    them — check the effective `baseUrl` whenever a subpath import behaves differently in an
    app than at the repo root.
15. A socket event normally says "re-read" and never carries the payload itself
    (`docs/realtime.md`). The AI assistant's `ai.message-delta.v1` is the **one** exception,
    and it is safe only because of two guards that must be copied together with the pattern:
    a monotonic `chunkSeq` (a gap sends the client back to the REST transcript) and
    `chunkSeq === 0` meaning "discard and restart". Postgres stays the source of truth.
16. `$executeRaw` bypasses the tenant Prisma extension — a raw update outside
    `runWith`/`withTenantTx` silently affects zero rows under RLS instead of erroring.
16. Workspace ports are allocations, not a search hint. Slot 0 and its base ports always
    belong to the main checkout; `ws:init` also reserves non-zero slots found in other git
    worktrees even if their processes are stopped. Never work around a conflict by choosing
    the next port or by setting `PORT` manually. See `docs/workspace-slots.md`.

## Fixed decisions

Do not revisit without an explicit user request.

| Area | Decision |
| --- | --- |
| ORM | Prisma 7 (Drizzle considered, rejected) |
| Queues | pg-boss v12 on Postgres (BullMQ rejected; Kafka/NATS/RabbitMQ out of scope). One async runtime — `libs/shared/src/messaging/` (events/commands over a shared transactional-outbox `publish`, not pg-boss's own `boss.publish`, which swallows partial fan-out failure) |
| Multitenancy | Shared schema + `tenant_id`, **Postgres RLS as the primary enforcement**. Tenant scoping is invisible to domain code — the Prisma extension only does `set_config`; a `tenantId` argument on an ordinary domain service is a smell. One user belongs to exactly one tenant (no Membership model). Two planes, each with its own UI, identity, JWT secret, DB role |
| Auth | Custom implementation (better-auth/Keycloak/Clerk considered, rejected) |
| Validation | Zod v4 |
| Monorepo | pnpm workspaces + Turborepo (Nx rejected) |
| UI | shadcn/ui on Base UI (style `base-nova`) for both frontends, shared via `libs/ui`. `lucide-react` icons |
| Forms (web) | React Hook Form + zodResolver + repo wrappers in `apps/web/src/components/form/` |
| Create user (API) | Password is required and set by the admin (argon2 hash); changing your own password is a separate security flow, not the users PATCH endpoint |
| Files | S3 API as the storage abstraction (SeaweedFS for dev; MinIO ruled out — archived; Garage ruled out — AGPL). Presigned two-phase upload, never a proxy-through-API upload. Access only via short-lived presigned GET after authz |
| Deploy | Docker Swarm single-node + GitLab CI via docker-context over SSH (no files copied to the server). Kubernetes/Helm out of scope |
| Realtime | Socket.IO 4 + Valkey (Redis Streams adapter), websocket-only transport (Docker VIP balances by TCP connection, sticky sessions not needed). Presence is ephemeral leases in Valkey, not a table; `users.last_seen_at` is the durable counterpart in Postgres. Realtime is deliberately **not** a messaging subscriber — notification emission happens after-commit in the process that wrote the row |
| Settings vs account | Two distinct subjects, not one section: org-level `/settings` (+ API `/settings/*`, ADMIN-only writes) vs personal `/user-settings` (+ API `/account/*`). Test: "if the user left the company, would the setting leave with them?" Neither has an id in its API path — the subject comes from the token |
| Customers | `Customer` (not `Account` — taken by the self-service module; not a party model yet — no second contact type exists to justify the indirection) + `kind` discriminator + nested `CustomerContact`. Human-readable sequence numbers come from a counter table per tenant (never `SEQUENCE` — outside RLS, gapful; never `MAX+1` — reusable after a delete). No soft delete — archival is a `status` transition |
| Calendar | `CalendarEvent` (qualified name — `Event` is taken by messaging/sockets/the activity log) with attendees + RSVP + personal reminders. Half-open interval `[starts_at, ends_at)`, UTC instant + separate IANA zone. Access is by participation, not role — even ADMIN doesn't see other people's private events. Reminders go through the shared `scheduled_notifications` + cron-claim table, not `pg-boss startAfter` (`pgboss.*` sits outside RLS) |
| i18n | Backend emits codes, never localized text — `ApiError.message` is an English diagnostic, not user-facing. react-i18next on both frontends + a plain i18next instance in the worker for email. English only for now |
| App shell navigation | Two-level: an icon rail (`AppRail`, area switcher) + the active area's own sidebar (`AreaSidebar`) — see `docs/frontend/app-shell.md`. Each area owns a URL prefix; the active area is a pure function of pathname |

## Open work

Priorities and detail: `docs/roadmap.md`. Notable gaps, tracked in their own plan docs rather
than repeated here:

- **Auth hardening** (`docs/auth-hardening-plan.md`): httpOnly-cookie refresh (AUTH-2),
  password recovery (AUTH-3), 2FA (AUTH-4) are designed but not built.
- **RBAC**: only the `@Roles(ADMIN)` opt-in guard exists; permission-string based
  `@RequirePermissions()` is not built.
- **Multitenancy MT-4**: subdomains, invite flow for a tenant's first admin, billing, tiered
  reference data — see `docs/multi-tenancy-architecture.md` backlog section.
- **EDA-2**: DLQ/replay UI, correlationId filter, queue depth/lag in `/operations/jobs` — the
  messaging pipeline currently has no failure-visibility surface.
- **Chat**: `CHAT-0.1` shipped (REST-only internal chat). `0.2` (realtime, notifications),
  `0.3` (participant management, mentions, attachments) and `CHAT-1…4` are designed and not
  built — `docs/chat.md` §7.3. **Bulk operations**: fully designed, not implemented.
- **Domain modules**: tickets, then billing (`PaymentProvider` interface → fake provider →
  Stripe), are the next reference modules after customers/calendar.
