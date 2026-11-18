# Design

## Context
See proposal.md for motivation; decisions of 2026-11-17 are in `docs/user-operations.md` §9
(owner-only access, cascade with the user, command per type, no platform plane, 30-day
retention, a `platform`-tier module). What shapes the approach:

- Async work = `publish(tx, command, …)` in the transaction that produced the fact; one consumer per
  command; `runOnce` gives at-most-once per delivery; `NonRetryableMessageError` → `dlq`
  (`docs/event-driven-architecture.md`). pg-boss retries with backoff; `pgboss.*` is outside RLS.
- The worker can emit to a user's room (`WorkerRealtimeEmitter.toUser`); feature socket events live
  in the owner's contracts and are collected in `libs/contracts/src/socket-events.ts`.
- Notifications: `NotificationRecorder.record(tx, …)` with types declared by the owner and collected
  in `notification-types.ts`; the worker already records notifications inside its transactions.
- Files: `StorageService.putObject/getDownloadUrl/deleteObject`; `GET /files/:id/download-url` is
  readable by any user of the tenant (RLS only) — unsuitable for a private export.
- `Idempotency-Key` is ready (`docs/idempotency.md`): a start endpoint opts in with
  `@Idempotent()` + `claim(tx)`.
- Tray: `apps/web/src/lib/activity.ts` takes items `{ status, progress?, steps?, onCancel?,
  onRetry?, onDismiss }`; `StepStatus` lives in `libs/ui` for now.

## Goals / Non-Goals

**Goals:**
- A reusable operation runtime: a module adds a new operation type by declaring it in contracts,
  defining one command, and writing one worker handler.
- No operation ever stays `RUNNING` forever; no final state is ever overwritten.
- The customer export exercises the full path end to end.

**Non-Goals:**
- Resumable batches with a persisted cursor and real steps — `uo-3` (import). The runtime exposes
  steps already, the export does not use them.
- Streaming upload of large results (S3 multipart). The 50,000-row cap keeps a CSV in memory.

## Decisions

### D1. Data model — one table, steps in jsonb
`user_operations` (tenant-scoped, standard RLS): `id`, `tenant_id`, `user_id` (composite FK to
`users`, `ON DELETE CASCADE`), `type` (string; closed set in contracts), `status` enum,
`progress_current`/`progress_total` (nullable int), `steps` jsonb (nullable), `revision` int,
`params` jsonb, `result` jsonb (nullable), `result_key` (nullable; S3 key of the result object),
`error_code` (nullable), `cancel_requested_at`, `created_at`, `started_at`, `heartbeat_at`,
`finished_at`. Indexes: `(tenant_id, user_id, created_at desc)` for the list; `(status,
heartbeat_at)` and `(finished_at)` for the two system crons. No idempotency column — the shared
`Idempotency-Key` covers starts (`docs/user-operations.md` §5.1). `subject_type/subject_id` from
§3 of the doc are left out until a consumer has a subject (`uo-3` attaches imports to nothing
either) — adding nullable columns later is cheap.

### D2. Every write is a guarded transition
All status changes are conditional `updateMany` + `count`, each incrementing `revision`:
`QUEUED→RUNNING` (claim), `RUNNING→RUNNING` (progress, `heartbeat_at = now()`),
`RUNNING→SUCCEEDED|FAILED|CANCELED`, `QUEUED→CANCELED`. The `where` always includes the expected
current status, so a late writer (a retried job after the sweeper failed it, a progress update
after cancel) changes nothing. This is the "final state never changes" invariant and the
concurrency guard of `docs/backend-conventions.md` §4.

### D3. Module layout (`user-operations`, tier `platform`)
- `libs/contracts/src/user-operation/` — schemas (operation response, list query, status, step
  with `StepStatus`, error codes), the `defineUserOperationType` helper, socket event
  `user-operation.changed.v1 { id, revision }`, notification types
  `user_operation.succeeded|failed`. Closed set of types collected in
  `libs/contracts/src/user-operation-types.ts` (composition root, like notifications).
- `libs/shared/src/user-operations/` — `UserOperationsService`: `start(tx, { type, params })`
  (insert only; the caller publishes its command in the same `tx`), and the worker runtime
  `runOperation(envelope, id, handler)` → handler gets an `OperationContext` (`progress(n, total)`,
  `steps(keys)`, `step(key, fn)`, `checkpoint()` that throws when cancel was requested,
  `succeed(result, resultObject?)`). Owner-only access function `assertOwnOperation`.
- `apps/api/src/user-operations/` — controller: `GET /user-operations`
  (`?active=true`), `GET /:id`, `POST /:id/cancel`, `GET /:id/result-url`.
- `apps/worker/src/subscribers/` — stall sweeper and retention crons.
- `apps/web/src/features/user-operations/` — query hooks, socket sync, tray source.
`customers` (core) depends on `user-operations` (platform) downward; `user-operations` depends on
`messaging`, `notifications`, `realtime`, `files`(storage) — all `platform`.

### D4. Starting: domain endpoint, command per type
`POST /customers/export` (`@Idempotent()`, `202`): validate the filter (same schema as the list
query minus pagination), count matches (> 50,000 → `400` with a field error), then one
`withTenantTx`: `idempotency.claim(tx)` → `userOperations.start(tx, { type: 'customers.export',
params })` → `publish(tx, exportCustomersCommand, { userOperationId })`. Response — the operation.
The count happens before the transaction (a read, no guard needed: the cap is advisory, the worker
writes whatever matches at run time).

### D5. Running: claim, heartbeat, cooperative cancel
`runOperation` wraps the handler:
1. **Claim** `QUEUED→RUNNING` (sets `started_at`, `heartbeat_at`). Count 0 → the operation is
   canceled, finished or already running elsewhere: a canceled/finished one is a no-op; a `RUNNING`
   one whose `heartbeat_at` is older than the stall threshold is re-claimed (a retry after a crash),
   a fresh one is left alone (duplicate delivery).
2. **Work** — handler calls `progress()`; writes are throttled (≥ 1 s or ≥ 500 units apart) and
   each also checks `cancel_requested_at` (`RETURNING`), so cancellation is seen within a second.
   External I/O (S3) happens outside transactions.
3. **Finish** — `succeed` / failure / cancel as guarded transitions, each in a short transaction
   together with the notification (`record(tx, …)`), then `toUser(..., changed)` after commit.
Not `runOnce`: an export runs for seconds to minutes; holding one transaction for it is exactly
what §5 of the conventions forbids. Idempotency comes from the guarded claim instead.

Errors: a thrown `NonRetryableMessageError` (bad params) → `FAILED` with its code, no retry; any
other error → the job retries (pg-boss backoff, `retryLimit: 3`); the operation stays `RUNNING`,
the retry re-claims it by the heartbeat rule above. If every retry fails, the job lands in `dlq`
and the sweeper fails the operation with `STALLED` — the user always sees a final state.

### D6. Live updates: id + revision, REST is the truth
After each committed change the writer emits `user-operation.changed.v1 { id, revision }` to the
owner's user room (rule 15 of `AGENTS.md`: no payload, a monotonic counter, a REST resync).
Progress events are throttled with the writes (D5), so a large export emits ~1 event/s. The web
client keeps the last revision per id; a newer one invalidates `GET /user-operations/:id`. On
socket reconnect it refetches `GET /user-operations?active=true`.

### D7. Result: private object, link through the operation
The export writes `{tenantId}/user-operations/{operationId}/customers.csv` with `putObject` and
stores the key in `result_key` (and `{ rowCount, filename }` in `result`). No `files` row: the
general files API would expose it to every user of the tenant. `GET /:id/result-url` checks owner
+ `SUCCEEDED` + not expired and returns a presigned GET with `Content-Disposition` filename
(`customers-2026-11-17.csv`). Retention deletes the object, then the row.

### D8. System crons
- `user-operations.sweep-stalled` every 5 min, system scope: `RUNNING` with `heartbeat_at` older
  than 15 min → `FAILED` / `STALLED` (+ notification, + socket event via the worker emitter).
- `user-operations.purge-finished` daily (next free night slot): finished > 30 days → delete
  objects, then rows.
Both iterate tenants under `SystemPrismaService` (BYPASSRLS), like the existing cleanups; writes
that need tenant context (notification) run in `tenantContext.runWith`.

### D9. Notifications
`user_operation.succeeded` / `user_operation.failed`, category `system`, payload `{ operationId,
type, errorCode? }`; text per operation type on the frontend (`userOperations.<type>.title`);
click opens the result download (succeeded) or the tray (failed). Recorded in the same transaction
as the final transition, so a notification exists iff the state is final.

### D10. Frontend
- `StepStatus` and the step item shape move to `libs/contracts`; `libs/ui/step-progress.tsx`
  imports them (re-export kept for callers).
- `features/user-operations/`: `useMyActiveOperations()` (REST + socket sync), a store mapping each
  operation to an activity item: progress from `progress_current/total`, steps as given, cancel →
  `POST cancel`, dismiss → local hide (the row stays on the server until retention), and on
  `SUCCEEDED` with a result a **download action**. `ActivityItem` gets one optional field
  `action?: { label, run }`, rendered as a button in the row; succeeded items with an action do not
  auto-disappear (the user must be able to download), others keep the 4 s rule.
- Customers grid: an "Export" button in the toolbar sends the current filters to
  `POST /customers/export`; on `202` the tray shows the operation; a `400` over the cap shows the
  limit message.

### D11. Format
CSV only. UTF-8 with BOM, RFC 4180 quoting, formula-injection guard (prefix `'` for cells starting
with `= + - @ \t \r`). Columns per spec, owner by email, tags joined with `; `. XLSX is a
follow-up once a dependency is accepted.

## Risks / Trade-offs
- [Stall threshold too short for a slow step] → heartbeat is updated on every throttled progress
  write; a handler with a long silent phase must call `progress()`/`checkpoint()`; 15 min is far
  above the export's needs.
- [Re-claim of a stalled-but-alive worker] → two runners for one operation: the second claim bumps
  `revision`; every write of the first includes `started_at` it claimed with, so its writes miss
  (D2) and it stops at the next checkpoint.
- [Notification spam on mass failures] → one per operation; operations are started by humans.
- [CSV in memory] → 50,000 rows ≈ a few MB; the cap is in contracts and checked before queueing.
- [Owner-only access hides a stuck export from admins] → accepted by decision §9.1; operators see
  the job in `/operations/jobs`.

## Migration Plan
Additive: new table, new commands and crons, new endpoints; no backfill. Deploy order: migration →
worker → api → web (an api without the worker just leaves operations `QUEUED` until the worker
starts; the sweeper only touches `RUNNING`). Rollback: remove the export button; the table can stay.

## Open Questions
- Whether a `QUEUED` operation that never starts (worker down for a day) should also expire — the
  sweeper ignores `QUEUED` in this phase; revisit if it happens in practice.
