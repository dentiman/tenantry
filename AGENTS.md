# SaaS Skeleton — AGENTS.md

Forkable skeleton for multitenant CRM/ERP products (billing, customers, tickets, queues).
Two planes, each a full stack: **tenant plane** (`apps/api` + `apps/web`) and **control
plane** (`apps/platform-api` + `apps/platform-web`, operator-facing, manages tenants).
Auth and core patterns were ported from a prior project (`fibo-admin`) and extended here.

This file covers what's needed on nearly every task: commands, directory map, cross-cutting
conventions, and rules that are easy to violate by accident. Subsystem depth (data model,
protocol, historical rationale, gotchas caught during implementation) lives in `docs/` —
read the relevant doc before working in that area instead of expecting it here.

**This is the one instruction file for every agent.** Codex reads it directly; `CLAUDE.md`
only imports it (`@AGENTS.md`). Edit this file, never a copy. Phase status ("done", "next")
does not belong here — it goes stale first; it lives in `docs/roadmap.md` and the feature doc.

## Documentation map

- `docs/multi-tenancy-architecture.md` — **the** reference for multitenancy: schema, RLS,
  tenant context, both planes' auth, queues, contract for adding a new domain module
- `docs/backend-conventions.md` — rules for evolving the backend (data ownership, module public
  API, transaction ownership, read-modify-write guards, after-commit effects, async guarantees,
  record-level access), each with a reference implementation in code and how it is enforced.
  The procedure is the `backend-change` skill (`.agents/skills/backend-change/`)
- `docs/modules.md` — **the** reference for decoupling by module, across all apps and libs: tiers
  (infra → platform → core → feature), declared `dependsOn` edges, slots/hooks/registries for
  upward links, the rule "wiring and operational settings stay central, feature definitions
  (schemas, texts, defaults, routes) live with the owner", what stays central on purpose, and a
  checklist for a new module. Source of truth for the graph is `modules.config.ts`; checked by
  `pnpm modules:check`
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
- `docs/deploy-swarm.md` — GitLab CI (check → build → deploy) → Docker Swarm
- `docs/deploy-hetzner.md` — GitHub Actions → Hetzner VPS (self-hosted runner on the same host,
  Caddy TLS on `sslip.io`, server-side secrets in `/etc/saas/deploy.env`, `main` deploys)
- `docs/demo.md` — демо-стенд для показу клієнтам: датасет трьох галузевих тенантів (`db:seed:demo`),
  статичні демо-акаунти (їх читають сід і логін-сторінки), публічний путівник `/about` (рішення про видимі гостям статуси модулів — §8), ручні CI-джоби завантаження/скидання
- `docs/workspace-slots.md` — isolated per-worktree dev stacks (`pnpm ws:init`)
- `docs/commands.md` — full `package.json` command reference
- `docs/roadmap.md` — priorities, phase status, and what's intentionally not built yet
- `docs/frontend/ui-stack.md` — primitives, tokens, form and **DataGrid** conventions
  (**start here** for any UI work, including `createDataGrid<TFilters, TItem>()`);
  `docs/frontend/ui-registry.md` — where to find a new component; `docs/frontend/theming.md` —
  color/typography tokens; `docs/frontend/app-shell.md` — two-level navigation shell;
  `docs/frontend/brand-backdrop.md` — brand backdrop + glass shell for showcase routes
  (`staticData.backdrop`, only `/guide` so far; work screens stay solid);
  `docs/frontend/layout-structure.md` — quick visual map + naming of shell columns/
  panels (rail, area sidebar, context panel) for both frontends;
  `docs/frontend/ui-known-issues.md` — open vendored-code issues
- `docs/chat.md` — **the** reference for chat (human conversations). §7 is the phase plan,
  §7.6 the invariants later phases build on — don't break them. The built slice is REST-only
  **by design**: no realtime yet, the screen re-reads on window focus and after sending.
  `docs/bulk-operations.md` — **design only, not implemented** (a disabled demo slot on `/users`).
- `docs/ai-assistant.md` — **the** reference for the sidebar AI assistant: fixed decisions and
  why (OpenAI-compat is lossy, provider strategies, tool-calling, files), budget, privacy,
  phases AI-0…AI-4 (§0 decision sequence). Distinct from `docs/chat.md`.
- `docs/ai-assistant-implementation.md` — what actually shipped: data model, the two access
  boundaries, the streaming protocol, queue options, config, `OpenAiCompatProvider` (§7.1:
  worker-only key, error classification, `Retry-After`, token usage), knowledge corpus (§14),
  persona/instructions (§15), quotas and retention (§16–17), retrieval-grounded answers with
  server-verified citations re-authorized on every open (§18), hybrid FTS + vector search (§19).
- `docs/ai-platform-controls.md` — the current AI course (AI-5: no new assistant features;
  superadmin model/URL/encrypted key and on/off switches, cost ledger §7, answer eval §9) and
  the owner decisions of 2026-10-03.
- `docs/ai-assistant-retrieval-proposal.md` (research, costs, phase table — read before planning
  the next AI phase) and `docs/ai-assistant-implementation-plan.md` (AI-2a step plan with measured
  results — read before touching anything under `ai/`). `docs/ai-sources/README.md` — operator
  guide for an external documentation source (FMS) and the `ai:docs:*` / `ai:answers:eval` CLIs;
  `docs/ai-sources/fms-eval.json` is a **draft** question set pending product-owner review.
  `FakeLlmProvider` stays the default and CI backbone (no key, no network, no cost).

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
pnpm db:seed:demo          # demo dataset: 3 industry tenants (users, ~35 customers each, calendar, chat,
                           # activity, notifications) — idempotent; docs/demo.md. Needs `db:seed` first
pnpm db:seed:demo:reset    # delete the 3 demo tenants (cascade) and recreate; never touches `default`
pnpm db:reset              # destructive, local-only: DROP+CREATE DATABASE → roles → migrate → seed
pnpm api:dev                        # tenant API   http://localhost:3001  (Swagger /api/docs)
pnpm platform:dev                   # platform API http://localhost:3002 (Swagger /api/docs)
pnpm worker:dev                     # pg-boss consumers + cron, no HTTP
pnpm web:dev                        # tenant web   http://localhost:5173
pnpm platform:web:dev               # platform web http://localhost:5174
pnpm openapi:generate && pnpm web:codegen                   # after tenant contract/controller changes
pnpm platform:openapi:generate && pnpm platform:web:codegen # after platform contract/controller changes
pnpm ai:knowledge          # docs/ai-knowledge/*.md → committed JSON artifact in libs/shared (after
                           # any corpus edit; `pnpm lint` and CI run `ai:knowledge:check` first)
pnpm ai:docs:preview       # external Markdown docs → admission + chunks + tokens; offline, no DB/keys
pnpm ai:docs:ingest        # → embeddings into a tenant's pgvector index, atomic revision publication
pnpm ai:docs:search        # question → top-K published chunks (operator check, no LLM)
pnpm ai:knowledge:index    # our own docs/ai-knowledge → pgvector index of every tenant (`--all-tenants`; `--dry-run`
                           # is offline); needs AI_KNOWLEDGE_BACKEND=postgres + AI_KNOWLEDGE_PRODUCT=saas to be read
pnpm ai:docs:eval          # retrieval-only comparison of search modes/thresholds on a question set
                           # (all four: docs/ai-sources/README.md; ingest/search/eval need DB + key)
pnpm ai:answers:eval       # answer quality × price per configuration file (AI-5c; --max-cost unless
                           # --fake; writes only `eval` ledger rows — docs/ai-sources/README.md)
pnpm lint && pnpm typecheck && pnpm build   # lint = ai:knowledge:check + deps:check +
                                            # modules:check --strict + eslint
pnpm deps:check            # madge: no runtime import cycles in backend apps and libs
pnpm modules:check         # imports vs the declared module graph (modules.config.ts); `--strict`
                           # runs inside `pnpm lint`. Blind spots (string links, Prisma) — docs/modules.md §6
bash scripts/ci-verify.sh  # the full CI gate locally (lint → typecheck → unit → both e2e) in
                           # throwaway Docker containers; doesn't touch the dev stack or slots
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

## Branches and CI

- **`dev` is the primary branch.** Work lands in `dev` (or a feature branch merged into it);
  a push to `dev` deploys the `saas-dev` stack.
- **`main` is a mirror of `dev`.** It is fast-forwarded to `dev` from time to time. On GitLab
  it is not deployed: only the `check` stage runs — no images, no prod jobs (`.prod_disabled` in
  `.gitlab-ci.yml`). Do not re-enable prod or retarget prod jobs to another branch without an
  explicit request. GitLab's default branch is still `main`, so `$CI_DEFAULT_BRANCH` ≠ `dev`.
- **Two independent CIs, two remotes.** `origin` = GitLab (`.gitlab-ci.yml`, deploys `dev` →
  `saas-dev`). `github` = `dentiman/saas-skeleton` (private; `.github/workflows/`), where a push
  to **`main`** deploys the Hetzner stack `saas-prod` through a self-hosted runner —
  `docs/deploy-hetzner.md`. Pushing to one remote does not trigger the other's pipeline; push to
  `github` only when you mean to deploy there — the way is `pnpm release:hetzner` (local
  `scripts/ci-verify.sh`, then a fast-forward push to `github/main`).
- **GitLab:** stage `check` (`ai_knowledge_check`, `verify` = `scripts/ci-verify.sh`) gates
  `build`, and `build` gates `deploy_dev` — an unverified SHA is never built or deployed. A red
  `verify` blocks the dev deploy: fix the cause, don't skip the job. Details:
  `docs/deploy-swarm.md` §6. **GitHub** has no `verify` gate for now (the stand is not production): the gate is the local
  `pnpm release:hetzner`; `verify.yml` stays as a manual button.

## Architecture

```
apps/api            Tenant NestJS API. Modules: auth, account (self-service profile/password/
                     sessions — no id in any path, subject is always the JWT), customers,
                     settings (org-level), files, activities, notifications, realtime
                     (Socket.IO gateway), calendar, ai (assistant conversation + citation
                     read; the current conversation has no id in its path — only reply ids
                     and history `/ai/conversations/:id` do), chat (CHAT-0.1: internal conversations, server-assigned
                     `seq`, one access service, no queue/socket seams yet). Pino logging,
                     AllExceptionsFilter via configureApp() (shared between main.ts and e2e).
apps/platform-api   Control-plane NestJS API (MT-3, :3002): platform-auth (separate identity/
                     JWT/DB role), tenants CRUD, jobs monitoring (moved here because
                     `pgboss.*` sits outside RLS), AI settings and the AI cost ledger/prices.
apps/worker         NestJS application context, no HTTP. Message subscribers
                     (`src/subscribers/`) + cron via pg-boss, MailerService → Mailpit,
                     local i18next for email content. AI reply generation lives here
                     (`ai-generate-reply.subscriber.ts`) — the API never calls a model or an
                     embedding API. Knowledge comes from `AI_KNOWLEDGE_BACKEND`: the committed
                     static corpus (default) or hybrid retrieval from the pgvector index.
apps/web             Tenant SPA: React 19, Vite 7, TanStack Router/Query v5, Zustand,
                     Tailwind 4, react-hook-form, shadcn/ui on Base UI, react-i18next.
                     Two-level nav shell (`AppRail` + `AreaSidebar`, docs/frontend/app-shell.md):
                     areas Workspace / Calendar / Chat / Assistant (`features.ai`) /
                     Settings (ADMIN) / Playground / Guide,
                     plus User settings (entry via avatar menu). Code is grouped by module in
                     `src/features/<module>/` (pages, components, stores…); outside it only the
                     shell, shared components/lib, api client, i18n and composition roots
                     (`router.tsx`, `slot-fills.ts`). Context panel (third column,
                     `libs/ui`) is the default surface for record detail — prefer it over
                     `Sheet` unless the interaction is a dismiss-and-forget overlay.
apps/platform-web    Same stack/shell pattern as apps/web (:5174, proxy → :3002). Areas:
                     Tenants, Operations (Jobs/Queues), AI (settings, costs, prices), User
                     settings. No org-level Settings — the platform itself is the subject. Same `src/features/<module>/` grouping, one `<module>.routes.tsx` per module.
libs/contracts       Zod 4 schemas + z.infer types — the only source of truth for API types.
                     Platform contracts live under the `/platform` subpath, not re-exported
                     from the root (needs an explicit `exports` entry in package.json — Vite/
                     Rollup resolves workspace subpaths through `exports`, not tsconfig paths).
libs/database        Prisma 7 (adapter-pg): schema (one file per module in `prisma/schema/`), migrations,
                     seed. `src/tenant/` —
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
                     scheduled-notification service, numbering service, S3 storage service,
                     AI pipeline (`ai/`: providers, prompt, state machine; `ai/knowledge/`:
                     static corpus, embedding provider, Postgres store/retrieval, CLI-only ingest
                     kept out of the runtime barrel because its Markdown parser is ESM-only).
docker/              Compose for local Postgres/Mailpit/Valkey/SeaweedFS and the self-hosted
                     production compose file (docker/docker-compose.prod.yml).
```

## Type pipeline

Zod schema (`libs/contracts`) → `createZodDto` (nestjs-zod v5) → Swagger
(`@ApiOkResponse({ type: Dto.Output })`, `cleanupOpenApiDoc`) → `openapi.json` → orval →
TanStack Query hooks. There are no hand-written API types.

## Auth

Access JWT (`{ sub, email, role, tenantId }`, 15m) in memory on both frontends; the refresh
token is an **httpOnly cookie** scoped to `Path=/api/auth` (`refresh-cookie.ts`, `SameSite=Lax` +
origin guard), rotated on every refresh. Sessions are a first-class entity (`auth_sessions`:
rotating hash with a short grace window, `generation`, sliding idle + fixed absolute expiry,
revoked rows kept for reuse detection; devices under `/account/sessions`). Platform plane
mirrors the same model with its own identity, secret and cookie. Password recovery and
email change go through `verification_tokens`. `POST /auth/logout` is public and always 204.
No public self-registration — tenant admins create users, platform operators create tenants +
their first admin. Login checks `user.isActive` and `tenant.isActive` (same 401 for either).
Global `JwtAuthGuard` (`APP_GUARD`, no Passport) cross-checks `payload.tenantId` against the
resolved tenant context; open routes use `@Public()`. `access-token.service.ts` is the single
place that verifies an access token — shared by the HTTP guard and the realtime socket
middleware; do not fork it. Model, decisions and the remaining step (2FA, AUTH-4):
`docs/auth-hardening-plan.md`.

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
silently. Idempotency is keyed by message and consumer, not by pg-boss job: `MessageInboxService.runOnce
(envelope, consumerId, fn)`, key `messageId:consumerId` (`publish` mints a new `messageId`, so a
deliberate re-publish runs again — guarding that needs a business key on the domain table). The
marker is `INSERT … ON CONFLICT DO NOTHING` in the same tx as `fn`; an error thrown by `fn`
(even a business `P2002`) propagates and rolls the marker back. `NonRetryableMessageError` sends
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

## Backend change rules

Before changing a service, transaction, subscriber, migration or cross-module dependency, load
the `backend-change` skill; reasons and reference code are in `docs/backend-conventions.md`.
The rules most easily broken:

- **A module's public API is its `*.module.ts` `exports`** plus mapper/dto/decorators. Another
  module's controller, access function, subscriber or gateway is never imported (ESLint).
  Another module's table is written through its exported service or a shared `libs/shared`
  recorder that takes `tx`.
- **No import cycles, no `forwardRef`** — `pnpm deps:check` fails on a cycle.
- **A module depends only on what `modules.config.ts` declares**, and only downward
  (feature → core → platform). A lower module that must show a feature (customer page → its
  events) gets a slot the feature fills — it never imports the feature (`docs/modules.md` §4).
  A new file must fall under some module's path pattern.
- **The top-level method owns the transaction**: one `withTenantTx`; helpers that must be atomic
  with it take `tx` first and never open their own.
- **Read-modify-write is guarded**: the read happens inside the same `withTenantTx`, with a
  conditional `updateMany` + `count`, an atomic increment, a unique index → 409, or
  `SELECT … FOR UPDATE`. Never compute a diff from a `findOne` done before the transaction
  (`CalendarService.update`/`setAttendees` still do — known debt, deferred).
- **After commit**: `onCommit` only for lossy accelerators (socket emit); anything that must
  happen goes through `publish(tx, …)`.
- **RLS is the tenant boundary only**; who may see or change a record inside the tenant is the
  module's single access function (`calendar.access.ts`, `conversation-access.service.ts`).
- **An invariant change ships with the e2e that would break without it** (negative, concurrent
  `Promise.all`, or retry).

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
    (`docs/realtime.md`). Three events carry state, and each is safe only because of the
    guards that must be copied together with the pattern — **a payload is allowed only with a
    monotonic counter and a REST resync**: the AI assistant's `ai.message-delta.v1` (a
    monotonic `chunkSeq` within one generation attempt, a gap sends the client back to the
    REST transcript; a higher `attempt` meaning "discard and restart" — AI-0.1 replaced the
    earlier `chunkSeq === 0` rule, which also mistook a stale attempt's first frame for a
    restart; `chunkCount` on the transcript so a client resumes live deltas after one re-read
    instead of re-reading again), `notification.created.v1` (`revision`), and
    `chat.message-created.v1` (the conversation's `seq`: next → apply, not newer → ignore, gap
    → re-read the transcript). Postgres stays the source of truth.
16. `$executeRaw` bypasses the tenant Prisma extension — a raw update outside
    `runWith`/`withTenantTx` silently affects zero rows under RLS instead of erroring.
17. Every Postgres image is `pgvector/pgvector:0.8.6-pg17-bookworm` (pinned digest) — dev, CI,
    prod, Swarm. The extension is installed by an administrator (`db:roles`, docker init) into
    the target DB **and** `template1` (Prisma's shadow DB); the migration only checks for it and
    `saas_migrator` is never elevated. Migrations cannot `UPDATE` tenant rows (FORCE RLS applies
    to the owner too) — backfill through `ADD COLUMN … DEFAULT` or a STORED generated column,
    and mirror a generated expression in the Prisma schema (`prisma/schema/<module>.prisma`) as
    `@default(dbgenerated(...))`, or
    `migrate diff` proposes dropping it.
18. Embedding calls follow the model rule: never inside a DB transaction. The worker's
    `prepare()` is read → knowledge selection → `claim()`, three separate steps (§18 of
    `docs/ai-assistant-implementation.md`).
19. Workspace ports are allocations, not a search hint. Slot 0 and its base ports always
    belong to the main checkout; `ws:init` also reserves non-zero slots found in other git
    worktrees even if their processes are stopped. Never work around a conflict by choosing
    the next port or by setting `PORT` manually. See `docs/workspace-slots.md`.
20. `docs/ai-knowledge/` is **end-user product documentation**, not engineering docs: copy every
    quoted UI label from the English locale files, run `pnpm ai:knowledge`, commit the Markdown
    and the generated JSON together (`pnpm lint` fails on drift).
21. Assistant boundaries stay in code as message 0 (`ASSISTANT_BOUNDARIES`, byte-identical
    text); tenant persona/instructions from `settings.ai` come only after them, fenced.
22. Money (AI cost ledger, prices) is `NUMERIC` / `Prisma.Decimal` in the DB and a decimal
    string on the wire — never a JS `number`. `ai_usage_events` (one row per attempt, written in
    the transaction that already exists) and `ai_model_prices` are append-only
    (`docs/ai-platform-controls.md` §7).
23. The worker and `pnpm ai:answers:eval` share one request assembly (`buildGenerationRequest`);
    keep the worker on it, or the eval measures something production doesn't send.

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
| AI knowledge retrieval | PostgreSQL 17 + pgvector in the same database (no separate vector store), tenant-scoped `ai_knowledge_*` tables under the standard RLS, one fixed embedding profile (`text-embedding-3-small`, 1536, cosine — changing it means a new index version). Hybrid vector + Postgres FTS merged by RRF; mode and distance threshold are chosen by `pnpm ai:docs:eval`, not by taste. Rerank, query rewrite and HNSW stay off until a measured need |
| Settings vs account | Two distinct subjects, not one section: org-level `/settings` (+ API `/settings/*`, ADMIN-only writes) vs personal `/user-settings` (+ API `/account/*`). Test: "if the user left the company, would the setting leave with them?" Neither has an id in its API path — the subject comes from the token |
| Customers | `Customer` (not `Account` — taken by the self-service module; not a party model yet — no second contact type exists to justify the indirection) + `kind` discriminator + nested `CustomerContact`. Human-readable sequence numbers come from a counter table per tenant (never `SEQUENCE` — outside RLS, gapful; never `MAX+1` — reusable after a delete). No soft delete — archival is a `status` transition |
| Calendar | `CalendarEvent` (qualified name — `Event` is taken by messaging/sockets/the activity log) with attendees + RSVP + personal reminders. Half-open interval `[starts_at, ends_at)`, UTC instant + separate IANA zone. Access is by participation, not role — even ADMIN doesn't see other people's private events. Reminders go through the shared `scheduled_notifications` + cron-claim table, not `pg-boss startAfter` (`pgboss.*` sits outside RLS) |
| i18n | Backend emits codes, never localized text — `ApiError.message` is an English diagnostic, not user-facing. react-i18next on both frontends + a plain i18next instance in the worker for email. English only for now |
| App shell navigation | Two-level: an icon rail (`AppRail`, area switcher) + the active area's own sidebar (`AreaSidebar`) — see `docs/frontend/app-shell.md`. Each area owns a URL prefix; the active area is a pure function of pathname. Two kinds of navigation entries: **Area** (rail, declared by its owning module) and **Item** (a link in an area's menu, declared by any module that depends on it) — both in `<module>.nav.ts`, collected by `apps/*/src/nav.ts`; visibility derives from route `staticData.access` |

## Open work

Priorities and **phase status** live in `docs/roadmap.md` (and each feature doc) — this file
deliberately doesn't track what is done or next. What is designed but **not built**, so it is
not assumed to exist:

- **2FA** (AUTH-4, `docs/auth-hardening-plan.md`).
- **RBAC**: only the `@Roles(ADMIN)` opt-in guard exists; permission-string based
  `@RequirePermissions()` is not built.
- **Multitenancy MT-4**: subdomains, invite flow for a tenant's first admin, billing, tiered
  reference data — `docs/multi-tenancy-architecture.md` backlog section.
- **EDA-2**: DLQ/replay UI, correlationId filter, queue depth/lag in `/operations/jobs` — the
  messaging pipeline has no failure-visibility surface yet.
- **Chat** beyond the REST slice (realtime, notifications, participants, mentions,
  attachments) — `docs/chat.md` §7.3. **Bulk operations** — design only.
- **AI assistant** feature expansion is paused (AI-2b/AI-3/AI-4 postponed); work goes into AI-5
  platform controls — `docs/ai-platform-controls.md`.
- **Domain modules**: tickets, then billing (`PaymentProvider` interface → fake provider →
  Stripe), are the next reference modules after customers/calendar.
