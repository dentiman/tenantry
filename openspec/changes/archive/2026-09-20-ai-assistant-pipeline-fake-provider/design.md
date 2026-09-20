# Design

## Context

Motivation and scope: see `proposal.md`. Requirements: see the three deltas under `specs/`.
Full research behind every choice here: `docs/ai-assistant-plan.md` (this document repeats
only what is needed to implement AI-0, and cites the plan's section instead of restating it).

What already exists and is reused as-is:

- **Messaging** (`libs/shared/src/messaging/`): `defineCommand` + a row in `MESSAGE_TOPOLOGY`
  + `publish(tx, …)` inside the domain transaction. The envelope already carries `tenantId`,
  `actor` and `correlationId`, and `MessageWorkerRegistrar` already restores tenant CLS in the
  worker, so RLS works there exactly as in an HTTP request.
- **Realtime** (`apps/api` gateway + `apps/worker`'s `WorkerRealtimeEmitter`): the worker
  already emits into `userRoom(tenantId, userId)` through the Valkey Streams adapter with no
  HTTP server of its own. AI-0 adds two event names, not a transport.
- **Transactions**: `TenantTransactions.withTenantTx` + `onCommit` for after-commit emission,
  the same shape `NotificationRecorder` uses.
- **Feature flag carrier**: `SettingsBootstrapSchema.features` is a `Record<string, boolean>`
  that exists today and is deliberately empty — "the key is reserved so feature gating does
  not need a new endpoint". AI-0 is its first consumer.
- **Throttler**, **`ApiError`**, the `libs/ui` `ResizeHandle` / `useResizablePanelWidth`.

Three constraints shape most decisions below:

1. `boss.work()` is registered today with **no options**, and pg-boss v12 defaults to
   `localConcurrency: 1` and `pollingIntervalSeconds: 2`.
2. `withTenantTx` opens an interactive Postgres transaction; a generation call lasts seconds.
3. `docs/realtime.md` fixes "a socket event is not delivery — it says *re-read*". Streaming
   text over the socket is the first case in this repository where the event carries payload.

## Goals / Non-Goals

**Goals:**

- Every moving part of the feature exercised end to end in CI with no credential, no network
  call and no cost — the provider seam is the only thing AI-1 replaces.
- The three shared-infrastructure gaps above closed once, with their first consumer, in a way
  that leaves existing consumers byte-for-byte unchanged in behaviour.
- Extension seams for AI-1…AI-4 that are *additive*: later phases add a provider
  implementation, extra prompt inputs, and counters around an existing transaction — none of
  them reopens the data model, the protocol, or the panel.

**Non-Goals:**

- Answer quality. With `FakeLlmProvider` there is nothing to tune; the prompt builder in AI-0
  is a minimal, deliberately boring function whose knowledge inputs are empty.
- Token accounting and quotas. The columns are reserved on `ai_messages` (§Decisions), but no
  counting, no enforcement, no usage screen — AI-1.
- Retention. Rows accumulate in AI-0; the purge cron lands in AI-1.
- Any platform-plane surface. `apps/platform-web` and `apps/platform-api` are untouched.

## Decisions

### Worker options belong in the topology manifest, not at the `work()` call site

`ConsumerSpec` gains four optional fields — `localConcurrency`, `groupConcurrency`,
`pollingIntervalSeconds`, `expireInSeconds` — passed through `MessageWorkerRegistrar` to
`boss.work()`, plus a `group` send option on `MessagePublisher` (pg-boss keys
`groupConcurrency` off `send({ group: { id } })`). The AI consumer declares:

```
localConcurrency: 4       // parallel generations per worker node
groupConcurrency: 2       // per tenant, enforced across nodes by pg-boss in the database
pollingIntervalSeconds: 0.5
expireInSeconds: 120      // instead of the 15-minute default
retryLimit: 1
batchSize stays 1
```

*Why the manifest:* `MESSAGE_TOPOLOGY` is already the single place where the async topology is
visible, and `PgBossService.syncQueues()` already reconciles queue policy from it. Putting
concurrency anywhere else would split that view in two.

*Why every existing consumer is unaffected:* the fields are optional and the registrar omits
them when absent, so `boss.work(queue, handler)` is still called with no options for today's
eight consumers.

*Alternative rejected — `useListenNotify: true`* (millisecond dispatch instead of ≤500 ms).
It is an instance-level constructor option that turns LISTEN on for the whole system, and
`realtime.md` already rejected `LISTEN/NOTIFY` once as a global cluster resource. Half a
second costs one extra query per 500 ms on one queue and touches nothing else. Documented as
the upgrade if first-token latency ever becomes the complaint.

*Alternative rejected — `batchSize > 1`.* The registrar's handler loops jobs sequentially, so
a batch would serialise rather than parallelise. `localConcurrency` spawns independent
workers, which is the behaviour actually wanted.

### The generation lifecycle is three phases, and the transaction spans none of the call

```
tx1  withTenantTx: load conversation + history, set reply status = STREAMING
 —   no transaction: consume the provider stream, coalesce, emit deltas,
                     and every ~2s issue a short standalone UPDATE of partial content
tx2  withTenantTx: final content + status COMPLETE + reserved usage columns,
                   onCommit(...) → emit ai.message-completed.v1
```

Holding `withTenantTx` across the provider call would pin a pool connection and an open
snapshot for the whole generation, blocking vacuum database-wide. The periodic partial write
is not belt-and-braces: it is what makes "partial output survives interruption" and
"client reconnects mid-generation" true, and it costs one `UPDATE` per two seconds.

### Idempotency is the reply row's status, not `MessageInboxService.runOnce`

`runOnce` is keyed `messageId:consumerId` and would permanently swallow a legitimate retry
after a transient backend failure. The business fact here is "this reply has been produced",
and it is already recorded: the worker generates only when the reply's status is `PENDING` or
`STREAMING`, and returns immediately when it is `COMPLETE`. This is the repo's own doctrine
("idempotency keyed by business fact, not by job") applied correctly rather than its default
helper applied blindly.

Because a retry re-streams from the beginning, the retry emits `chunkSeq: 0`, which the client
treats as "discard what you have for this reply and start over" — the spec scenario
"generation is retried after a transient failure". `retryLimit: 1`: one automatic retry covers
a transient 503; beyond that the user's Retry button is a better mechanism than a queue.

### Chunks are coalesced at ~120 ms, and carry `chunkSeq`

`ai.message-delta.v1 { conversationId, messageId, chunkSeq, text }` and
`ai.message-completed.v1 { conversationId, messageId, status }` (schemas in
`libs/contracts/src/realtime/`, versioned names like every other realtime event), emitted to
`userRoom`.

*Why not token-per-token:* the Valkey Streams adapter is configured `maxLen: 10_000`. A
500-token answer emitted per token is 500 stream entries; twenty concurrent generations evict
the entire buffer in one answer cycle, and a node catching up after a brief disconnect loses
presence and notification events with it. Coalescing at 120 ms yields ~80–100 entries for the
same answer and is below the threshold at which a human perceives anything other than
"typing". Plan §4.3.

*Why this does not break "a socket event is not delivery":* `chunkSeq` plus the transcript
read are the escape hatch. A gap or a reconnect sends the client to `GET /ai/conversation`,
which returns the partial content from Postgres. Postgres remains the source of truth; the
socket only accelerates the render. This is worth stating in the code comment on the event
schema, because the next domain will copy the pattern and must copy the safety net with it.

*Why a flush also fires on paragraph boundaries:* a reply that ends 30 ms after the last flush
should not wait out the timer before its tail appears.

### `LlmProvider` is a streaming-first interface; `FakeLlmProvider` is the only implementation

```ts
interface LlmProvider {
  generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}
```

An async iterable rather than a callback: cancellation is then just `AbortSignal`, and the
one-shot mode AI-1 may want is an iterable that yields once. `LlmRequest` carries the built
messages and the caps (`maxOutputTokens`, `model`); `LlmChunk` carries `text` and an optional
terminal `usage` — reserved now so AI-1 can fill it from the provider's usage frame without
touching the interface or the worker.

`FakeLlmProvider` streams canned Markdown (headings, a list, an inline code span, a fenced
block — so the renderer is exercised) at a configurable rate, and recognises directives in the
question so the hard paths are reachable from a test and from a manual click-through:
`__fail__` → throws a provider error, `__stall__` → never yields until aborted, `__long__` →
a long answer for cancel and coalescing checks. Selected by `AI_PROVIDER=fake` (the only legal
value in AI-0; an unknown value is a startup failure, not a silent fallback).

*Alternative rejected — no provider abstraction in AI-0, call the fake directly.* The
abstraction is the entire point of the phase: it is what makes AI-1 a single new file.

### Cancellation travels over Valkey pub/sub, not the database

`POST …/:id/cancel` marks intent and publishes on `ai:cancel:{messageId}`; the worker holding
that generation is subscribed and aborts. A worker inside a streaming read does not poll
Postgres, and ioredis is already a worker dependency (`WorkerRealtimeEmitter`). If no worker
is listening — it already finished, or the message never started — the endpoint still answers
success: cancelling a completed reply is a no-op by spec.

Partial content is kept with status `CANCELLED`. It is *not* presented as a failure, because
it isn't one.

### Data model

`AiConversation(id, tenantId, userId, status, createdAt, updatedAt, lastMessageAt)` and
`AiMessage(id, tenantId, conversationId, seq, role, status, content, errorCode?, model?,
promptTokens?, completionTokens?, startedAt?, completedAt?, createdAt)`.

- **`seq` per conversation**, not `createdAt` ordering — the same reasoning `docs/chat.md`
  gives: ordering, cursors and gap detection are one decision, and a timestamp gives none of
  them. `@@unique([tenantId, conversationId, seq])` is the arbiter.
- **One active conversation** is a **partial unique index**
  (`... ON ai_conversations (tenant_id, user_id) WHERE status = 'ACTIVE'`), which Prisma cannot
  declare — raw SQL in the migration, exactly as the notification collapse index does. It also
  settles the race where two tabs create the first conversation simultaneously: one of them
  gets a unique violation and retries the read.
- **Token columns are reserved but unwritten in AI-0.** Adding nullable columns now costs
  nothing and saves AI-1 a migration on a table that by then has rows.
- **RLS** per the MT-2 pattern: tenant isolation in the database, **ownership in the service**
  — the same split `docs/chat.md` fixes for private channels ("RLS is the tenant boundary, not
  the participant boundary") and the calendar for private events.
- **No soft delete.** Retiring a conversation is a `status` transition, which is also the
  repo's rule for customers.

### HTTP errors reuse the closed `ApiErrorCode` enum; only the stored failure reason is new

Corrected during implementation. `ApiErrorCodeSchema` is deliberately a **closed** set of
HTTP-shaped codes (`docs/error-handling.md` §1 states it as closed and contrasts it with the
open set `FieldError.code` uses). Adding `AI_DISABLED` / `AI_CONVERSATION_BUSY` /
`AI_PROVIDER_UNAVAILABLE` there would break that doctrine and invite every future domain to
dump its vocabulary into the same enum. So:

| Condition | Answer | Why it stays distinguishable |
| --- | --- | --- |
| Assistant disabled | `403 FORBIDDEN` | the only 403 reachable under `/ai/*` — ownership denial answers 404 |
| Conversation busy | `409 CONFLICT` | the ask route has exactly one conflict condition |
| Not the caller's conversation | `404 NOT_FOUND` | also satisfies "existence is not revealed" for the cross-tenant case |
| Over the rate limit | `429 TOO_MANY_REQUESTS` | already produced by the shared throttler |

Why a *generation* failure is different: it is persisted on the reply row and rendered inside
the panel, not returned as an HTTP envelope. That gets its own domain enum,
`AiMessageErrorCode` (`PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INTERNAL`), in the AI contract —
which is where a domain vocabulary belongs.

### The input ceiling is a contract constant, not configuration

Also corrected during implementation. The ask schema's `.max()` is baked into the Zod schema,
its `createZodDto`, and the published OpenAPI document, so it cannot be read from the
environment without those three disagreeing. `AI_MAX_INPUT_CHARS` is therefore a constant
exported from `libs/contracts/src/ai/` (4000) and is dropped from the AI config module.

### The feature flag rides `settings.bootstrap.features`

`AI_ENABLED` (env, default `false`) is read by `apps/api` and surfaced as
`features.ai = true|false` in the already-existing, already-loaded bootstrap slice. The web
app gates the header button and the panel on it; the API gates every `/ai/*` route on it with
`AI_DISABLED`. No new endpoint, no new contract, no second source of truth, and the reserved
`features` map finally has its first entry.

*Why default off:* a skeleton cloned without a provider must not present a working-looking
assistant that answers with canned filler.

### Panel placement and state

`AiPanel` mounts in `apps/web/src/app-shell/app-shell.tsx` as a sibling of `ContextPanelSlot`
— outermost, so it reaches from the top of the window to the bottom and clips the header on
the right, the same structural choice `context-panel-slot.tsx` documents for itself. Open
state and width live in a Zustand store persisted to `localStorage`, mirroring
`notification-ui.store.ts` and the existing panel-width hook; because the store is outside the
router, route-independence and surviving navigation are properties of where the state lives,
not of an effect that has to remember to preserve them.

The transcript is TanStack Query state keyed on the conversation; socket deltas patch the
cached transcript, and a `chunkSeq` gap invalidates the query. Same snapshot-plus-delta shape
as presence and notifications.

### Markdown rendering is the XSS boundary

`react-markdown` + `remark-gfm`, **without** `rehype-raw` and without any
`dangerouslySetInnerHTML`. A model answer is untrusted input, and in AI-2 part of that input
is authored by a different tenant's admin. Link targets are constrained to http/https and open
with `rel="noopener noreferrer"`.

*Alternative rejected — render as plain text in AI-0 and add Markdown later.* The renderer is
the boundary; introducing it after the panel already displays model output means the first
version ships the unsafe shape.

### How AI-1 and later plug in without reopening AI-0

Recorded here because the proposal commits to it and later phases stay open to revision:

| Later phase adds | Where it attaches | What it does **not** touch |
| --- | --- | --- |
| `OpenAiCompatProvider` (AI-1) | a second `LlmProvider` implementation + `AI_PROVIDER` value | interface, worker lifecycle, protocol, data model |
| Knowledge corpus (AI-1) | extra inputs to the prompt builder, which already takes a (currently empty) knowledge argument | anything outside the builder |
| Quotas + usage (AI-1) | reads before publish in the API; writes inside the existing `tx2` | transaction boundaries, protocol |
| Retention (AI-1) | a new cron command + subscriber | existing tables' shape |
| Level-2 knowledge (AI-2) | a new table and new admin screens; another prompt-builder input | conversation, pipeline, panel |
| Retrieval (AI-4) | replaces what the prompt builder passes as knowledge | everything else |

The seam that carries all of this is a single one: the prompt builder takes `(history,
question, knowledge, userContext)` and AI-0 supplies an empty `knowledge` and a `userContext`
restricted by construction to `{ role, locale }` — the allowlist from plan §5.1, in place from
the first commit so the privacy property is never retrofitted.

## Risks / Trade-offs

- **A stream of payload events normalises "socket as delivery."** → The safety net is
  mandatory, not optional: `chunkSeq` on every delta and a transcript read that is always
  authoritative. The reasoning goes in a comment on the event schema so the next domain copies
  the whole pattern, not half of it.
- **`localConcurrency: 4` multiplies the worker's database connections.** Four generations
  each open short transactions plus a partial-write `UPDATE` every two seconds. → Small and
  bounded, but the worker's pool size should be checked against `4 + existing consumers`
  during implementation rather than assumed.
- **`groupConcurrency` is enforced optimistically** (pg-boss documents brief overshoot under
  racing fetches). **Measured on slot 1 during task 9.3:** three questions from one tenant
  created within 30 ms were all picked up at once by three of the four local workers — the
  documented race window. The same three spaced 1.5 s apart behaved exactly as specified: the
  third waited ~9 s for a slot until the first finished. → Acceptable: it is a fairness bound,
  not a correctness one, and the burst case still cannot starve another tenant (the other
  tenant's question started 32 ms later, not after the 11.5 s backlog). The correctness bound
  for a single user is the "conversation is busy" rejection, which is a unique row state.
- **Retry re-streams a reply the user may already be reading.** → `chunkSeq: 0` is defined as
  "discard and restart" and the client must implement it; with `retryLimit: 1` this can happen
  at most once per reply.
- **e2e mocks pg-boss** (`moduleNameMapper`, because it is ESM-only). → API-side e2e can assert
  that the command was published with the right envelope and group, but cannot prove the worker
  consumes it. The worker lifecycle therefore needs its own test that drives the subscriber
  directly against `FakeLlmProvider`; the topology boot-assert covers the wiring between them.
- **Partial writes every two seconds add write load per active generation.** → One `UPDATE` of
  one row per two seconds per generation, bounded by `localConcurrency`. Cheap next to what it
  buys; the interval is a constant that can be raised if it ever shows up.
- **`AI_ENABLED=false` by default means the feature is invisible after merge.** → Intended.
  The `.env.example` entry and the docs update must make turning it on obvious, or AI-0 gets
  reviewed as if it did nothing.

## Migration Plan

1. Migration adds two tables, their RLS policies and grants, and the partial unique index.
   Additive only — no existing table is altered, so deploy order is unconstrained and rollback
   is dropping the two tables.
2. Shared-messaging changes are backward compatible by construction (optional fields, omitted
   for existing consumers); `PgBossService.syncQueues()` creates the one new queue at worker
   boot as it does for any new topology row.
3. Ship with `AI_ENABLED` unset. Turning it on is a config change that needs no redeploy of the
   database and no migration.
4. Rollback: set `AI_ENABLED=false`. The panel and the routes disappear; queued jobs drain or
   expire on their own (`expireInSeconds: 120`).

## Open Questions

- **Exact coalescing interval (120 ms) and partial-write interval (2 s).** Both are constants
  chosen from reasoning, not measurement. Tunable once `FakeLlmProvider` can pace a realistic
  answer; neither changes a spec, the approach, or a task.
- **Whether the panel's default width matches the Context Panel's 18rem or is wider.** A visual
  call best made against the running shell during task 6.
