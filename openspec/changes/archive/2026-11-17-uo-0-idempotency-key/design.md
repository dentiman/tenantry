# Design

## Context
See proposal.md for motivation. What shapes the approach:

- Effects of a tenant mutation are **one local transaction**: the top-level service method opens a
  single `withTenantTx`, async work joins it through `publish(tx, …)` (transactional outbox), and
  external calls stay outside transactions (`docs/backend-conventions.md` §3, §5). A failed request
  therefore leaves nothing behind.
- The same pattern already protects queue consumers: `MessageInboxService.runOnce` inserts a marker
  with `INSERT … ON CONFLICT DO NOTHING` in the transaction of the effect; a concurrent duplicate
  blocks on the unique index until the first transaction ends.
- The HTTP response is built **after** commit: controllers map the service result
  (`toDetail`, `numbering.resolve`), so the response body is not known inside the transaction.
- Interceptors run after guards (tenant context and `request.user` are set) and before the
  validation pipe. Nest applies the endpoint's static status code after interceptors finish.
- The web client never retries a `POST` automatically; a "retry" is the user submitting again, or
  the 401-refresh interceptor replaying the original request config.

References: IETF draft `httpapi-idempotency-key-header` (header name, `422` on payload mismatch,
`409` while the first request is unfinished), Stripe's API (response replay, 24 h key lifetime,
keys up to 255 characters, "nothing is saved if the request did not start executing").

## Goals / Non-Goals

**Goals:**
- Exactly-once effect per `(tenant, user, key)`, including a process crash at any point.
- Adopting an endpoint costs one decorator and one line; forgetting half of it fails loudly.
- No per-form code in the frontend.

**Non-Goals:**
- A recovery-point state machine for requests spanning several transactions or external calls
  (Stripe's "atomic phases"). Nothing here needs it; a future billing provider call goes through
  the outbox, with the provider's own idempotency key derived from ours.
- Making the header mandatory. Stays optional until an endpoint needs it (billing).
- The platform plane and unauthenticated endpoints.

## Decisions

### D1. The key is claimed inside the transaction of the effect (settles §9.7)
`IdempotencyInterceptor` (attached by `@Idempotent()`) validates the header, computes the request
fingerprint and puts `{ key, fingerprint, userId }` into the request's CLS context. The service
calls `await this.idempotency.claim(tx)` as the first statement of its `withTenantTx`; `claim`
inserts the key row with `ON CONFLICT DO NOTHING`. Without a key in context `claim` is a no-op, so
the same service method works from a worker, a seed or a request without the header.

Why not claim in the interceptor (variant a of §9.7): a key committed separately from the effect
has a state "claimed, outcome unknown" after a crash. Recovering it means a lock timeout and then
either re-running the handler (a duplicate if the effect had committed) or refusing forever. With
the key and the effect in one commit that state does not exist: the row is visible **iff** the
effect is.

Why not hide `claim` inside `withTenantTx` (a transaction hook): it would remove the one line, but
which transaction claims the key would become invisible, and its position matters — it must come
before `numbering.allocate`, which holds a row lock until commit.

Why not wrap the handler in an ambient transaction opened by the interceptor: controllers and
`onCommit` hooks rely on the service transaction being committed when the service returns; it
would also hold the transaction open across response mapping.

### D2. Only successful requests are stored
A request that throws rolls back its transaction, and the key row with it. A retry runs again and
gets the answer that is true now. This drops "deterministic errors are cached" from
`docs/user-operations.md` §5.1: caching an error is needed when a failed request may have left
partial effects (Stripe); here it would only freeze a stale `409` after the conflict is gone.

### D3. The response is saved right after commit; duplicates wait for it
After the handler returns, the interceptor stores status and body on the key row (one `UPDATE`,
outside the transaction) and then lets the response through. A duplicate is detected in two places:

1. **Before the handler** — a lookup by `(user, key)`: found with a response → replay; found with
   another fingerprint → `422`.
2. **Inside `claim`** — the insert conflicts (the first request committed between the lookup and
   the insert, or the two ran concurrently and this one waited on the index). `claim` throws an
   internal signal error; the transaction rolls back with nothing written; the interceptor catches
   the signal and goes to the lookup.

In both places a row **without** a response means "committed, response not recorded yet". A racing
duplicate lands exactly in that window, so the interceptor polls the row with a short backoff (up
to ≈2 s in total) before answering `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`. The `409`
is thus left for the genuinely rare case: the process died between commit and the `UPDATE`. The
effect is still exactly-once; only the original body is lost, and the client is told so.

Alternative considered — store a resource reference in the transaction and rebuild the response on
replay: needs a per-endpoint "re-read" path and returns current, not original, state.

### D4. Replay returns the stored JSON through the normal pipeline
The interceptor returns the stored body as the handler result. Nest applies the same static status
the endpoint always uses (`201` for these `POST`s), so the status is reproduced without touching
the response object; the stored `response_status` is kept for diagnostics. The replay sets
`Idempotent-Replayed: true`.

### D5. Fingerprint and scope
- Scope: unique `(tenant_id, user_id, key)`. Tenant comes from RLS, user from the access token.
- Fingerprint: `sha256(method + "\n" + original URL (path and query) + "\n" + canonical JSON of the
  parsed body)`, canonical = object keys sorted recursively. The route pattern is stored next to it
  as `operation` (`POST /api/customers`) for diagnostics.
- Key format: 1–255 visible ASCII characters, no spaces (`^[\x21-\x7E]{1,255}$`), otherwise `400`.

### D6. An opted-in endpoint that does not claim is an error
If a handler under `@Idempotent()` completes successfully with a key in context and nobody called
`claim`, the interceptor throws (→ `500`, logged). Half-wired protection would otherwise be
invisible; this way the first e2e of the endpoint with a header fails. Same stance as "a subscriber
without a topology entry crashes the worker at boot".

### D7. Data and lifetime
`idempotency_keys`: `tenant_id` (DB default from `app.tenant_id`), `user_id` (FK → `users`,
cascade), `key`, `operation`, `request_hash`, `response_status` (nullable), `response_body`
(jsonb, nullable), `created_at`, `completed_at`. Primary key `(tenant_id, user_id, key)`; index on
`created_at` for cleanup. Standard RLS template (`ENABLE` + `FORCE` + `tenant_isolation`), default
grants.

Lifetime: the existing nightly `inbox-cleaner` cron (`maintenance.cleanup-processed-jobs`, system
scope) also deletes rows older than 24 h — both tables are idempotency markers, and a second
queue for one `deleteMany` is not worth a topology entry. A row is honoured until it is deleted,
so the effective lifetime is 24–48 h; the spec promises "at least 24 hours".

### D8. Placement
`libs/shared/src/idempotency/` — `IdempotencyModule` (global, like `NumberingModule`),
`IdempotencyService` (`claim`, lookup, save), `IdempotencyInterceptor`. The `@Idempotent()`
decorator itself lives in `apps/api/src/common/idempotent.decorator.ts` (decided while
implementing): it needs `@nestjs/swagger` for the OpenAPI extension, and `libs/shared` is also
bundled into the worker, which has no Swagger dependency. It
depends only on `libs/database` and the error contract, so it joins the `infra` module in
`modules.config.ts`; feature modules need no new edge. Prisma model in
`prisma/schema/idempotency.prisma`. Imported by `apps/api` only.

OpenAPI: `@Idempotent()` adds the extension `x-idempotency-key: true` to the operation instead of
a header parameter — a declared header would add a `headers` argument to every generated orval
call, while the client sets the header centrally (D9).

### D9. The web client derives the key from the request, in one place
`libs/ui/src/api/idempotency.ts` — a small registry used by the axios interceptors of `apps/web`:

- on request: for `POST` with a JSON body and no explicit `Idempotency-Key`, compute
  `method + url + JSON body`; if the registry holds an entry for it, reuse its key, else create a
  UUID and remember it;
- on response: a definite answer forgets the entry — any `2xx`, and any `4xx` except `401`, `408`,
  `429` and `IDEMPOTENCY_IN_PROGRESS`; everything else (no response, timeout, `5xx`, the listed
  `4xx`) keeps it. Entries expire after 15 minutes.

This realises "one key per attempt of an action, the same on repeats" without a hook per form: a
double click and a re-submit after a lost response reuse the key; a second identical record after
a success, or an edited form after a rejection, get a new one. The header is sent on every JSON
`POST`; endpoints that have not opted in ignore it.

Alternative considered — a `useIdempotencyKey()` hook per form: exact intent tracking, but every
form must remember to use and rotate it, and orval's generated hooks have no natural place for a
per-call header.

### D10. Order (settles §9.8)
This change comes first and on its own, with two existing endpoints as adopters, so the layer is
proven before `UserOperation` depends on it. Operation start endpoints adopt it when they are built.

## Risks / Trade-offs
- [Response lost between commit and save] → exactly-once still holds; the client gets `409
  IDEMPOTENCY_IN_PROGRESS` and re-reads state. Window is one `UPDATE`.
- [A duplicate holds a connection while it waits on the unique index] → bounded by the first
  transaction, which contains no external I/O by convention.
- [Stored responses are data at rest for 24–48 h] → same database, same RLS, readable only through
  a replay by the same user. Rule for adopters: never opt in an endpoint whose response carries a
  secret (tokens, presigned URLs).
- [Client fingerprint treats two intentionally identical concurrent requests as one] → only
  matters on opted-in endpoints; such an endpoint passes an explicit key per intent.
- [`claim` forgotten in a service] → D6 turns it into a failing test rather than silent absence.
- [Body key order or number formatting differs between attempts] → canonical JSON on the server;
  the client resends the same serialized body.

## Migration Plan
Additive: one new table, no data backfill; requests without the header are untouched. Deploy order
does not matter (an old API ignores the header). Rollback: drop the decorator usage; the table can
stay.

## Open Questions
- Platform plane (operator requests have no tenant/user row to scope by) — decided together with
  `docs/user-operations.md` §9.4 when the first platform operation needs it.
- A `required: true` option of `@Idempotent()` — added with the first endpoint that must refuse a
  request without a key (billing).
