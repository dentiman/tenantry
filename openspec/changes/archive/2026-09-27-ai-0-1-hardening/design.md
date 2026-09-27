# Design

## Context

See `proposal.md` — Why. The code this change touches, as it is today:

- `apps/worker/src/subscribers/ai-generate-reply.subscriber.ts` does everything in one class:
  `prepare()` (tx1: accepts `PENDING` **or** `STREAMING`, resets content, sets `STREAMING`),
  the stream loop (coalescing at `AI_STREAM_FLUSH_MS`, `persistPartial()` every
  `AI_PARTIAL_PERSIST_MS`), and `finalize()` (tx2 + after-commit `ai.message-completed.v1`).
  Writes are unconditional `update({ where: { id } })` — any attempt can overwrite any other.
- History query is `seq < reply.seq, status COMPLETE`, which includes the current question at
  `reply.seq - 1`; `buildPrompt()` then appends it again as `question`.
- Provider errors are caught and finalized as `FAILED`; the handler returns normally, so the
  `ai-generator` topology entry's `retryLimit: 1` never fires for them. The only retry path
  that exists is a redelivery after a crash, and `prepare()` lets it run concurrently with a
  still-live attempt.
- `AiService.cancel()` publishes on `AiCancelChannel` (Valkey pub/sub, at-most-once) and
  nothing else. The worker subscribes only after tx1; a Stop sent earlier is lost.
- `AiService.createActive()` catches `P2002` and re-reads through the same `tx`. In Postgres
  the unique violation has already aborted that transaction, so the re-read fails.
- `AiService.ask()` emits nothing; the other tabs of the same user never learn the new reply
  row exists, and `apps/web/src/realtime/ai-sync.ts` drops deltas for a message that is not
  in the cache (while still advancing its module-level `expectedChunk` map).
- The handler signature is `handle(data, envelope)`; pg-boss retry metadata (`retryCount`)
  does not reach it.

## Goals / Non-Goals

**Goals:**
- Every guarantee is enforced by a conditional write in Postgres, not by timing or by a
  message arriving.
- The fix stays inside the seams AI-1 builds on (`LlmProvider`, the delta protocol, the
  transcript), so AI-1 adds a provider without reopening any of this.
- Everything is testable against `FakeLlmProvider`, deterministically.

**Non-Goals:**
- Real providers, token accounting, quotas, retention (AI-1).
- A general "delivery metadata in handlers" feature for `libs/shared/src/messaging` — the
  design below does not need it (see D2).
- DLQ visibility for failed generations (AI-3 / EDA-2).
- Changing the one-delta-carries-payload exception itself; only its guard changes.

## Decisions

### D1. Ownership is an attempt number plus a lease, claimed by a conditional update

New columns on `ai_messages`: `attempt INT NOT NULL DEFAULT 0` and
`lease_expires_at TIMESTAMPTZ NULL`.

Claim (replaces tx1's status check):

```
UPDATE ai_messages
   SET status='STREAMING', attempt=attempt+1, lease_expires_at=now()+lease,
       content='', chunk_count=0, error_code=NULL, started_at=now()
 WHERE id=$1 AND conversation_id=$2
   AND (status='PENDING' OR (status='STREAMING' AND (lease_expires_at IS NULL OR lease_expires_at < now())))
```

expressed as Prisma `updateMany` (goes through the tenant extension — no `$executeRaw`, see
CLAUDE.md rule 16), then a read of the row for the new `attempt`. Zero rows updated = someone
else owns it or it is terminal → exit quietly. Under read committed the row lock makes two
concurrent claims serialize and the loser re-evaluates the `WHERE` against the winner's row,
so exactly one wins.

Every later write — partial persist, restart, finalize — is `updateMany` with
`WHERE id AND attempt = $mine AND status = 'STREAMING'`. Zero rows = ownership lost → stop
generating, emit nothing more, do not finalize. `attempt` is the fencing token.

**Lease length** = `AI_REQUEST_TIMEOUT_MS` + a fixed grace (30 s). No heartbeat: the overall
timeout already bounds the whole generation including in-process retries (D2), so a live
owner can never outlive its lease by design. Checked at worker boot: the `ai-generator`
consumer's `expireInSeconds` must exceed the lease plus `AI_RETRY_DELAY_MS × AI_PROVIDER_RETRIES`,
otherwise pg-boss would redeliver a job whose owner is still alive — safe (the claim fails)
but it would burn the queue retry meant for crashes. The worker refuses to start on
violation, the same way the topology manifest already fails fast.

*Alternatives:* `SELECT … FOR UPDATE SKIP LOCKED` held for the whole generation — rejected,
it keeps a transaction open across the model call, which AI-0's design explicitly forbids.
Advisory locks — rejected, they die with the connection, not with the process's intent, and
the pool reuses connections. Lease + heartbeat — unnecessary while the timeout bounds the
attempt; revisit only if AI-1 needs generations longer than one timeout.

### D2. Transient failures retry inside the delivery; the queue retry is for crashes only

A transient provider failure (`LlmProviderError` with `retryable: true`) causes a **restart**:
wait `AI_RETRY_DELAY_MS` (abortable by Stop/timeout), then a fenced update
`attempt = attempt + 1, content = '', chunk_count = 0` and a new stream. Budget
`AI_PROVIDER_RETRIES` (default 1). Exhausted, non-retryable, timeout, or cancelled → finalize
as today. The handler returns normally in all these cases.

The queue's `retryLimit: 1` now means only "the process died": the job expires, pg-boss
redelivers, and the lease (D1) has already lapsed so the new delivery claims and regenerates
from scratch.

*Why not throw to pg-boss for transient errors?* It needs the handler to know whether a queue
retry remains; otherwise the row is released to `PENDING` with no job left to pick it up. The
handler does not get `retryCount` (Context), and adding delivery metadata to the shared
messaging contract for one consumer is out of proportion. The DB-side budget would also
drift from the topology's `retryLimit`. Retrying in-process keeps the retry decision and its
budget in one place.

Classification: `LlmProviderError` gains `retryable` (default `true` — network errors, 5xx,
429 are the common case; AI-1 providers set `false` for auth/validation 4xx). `FakeLlmProvider`
directives: `__fail__` fails retryably every attempt (exercises exhaustion), new
`__fail_once__` fails retryably on the first attempt for a given request and succeeds after
(state is an in-memory set on the fake instance keyed by the request's final user message —
test directives use unique question text), new `__reject__` fails non-retryably.

### D3. Abandoned replies are closed on read, not by a sweeper

`PENDING` rows also get a lease at creation: `lease_expires_at = now() + AI_PENDING_TIMEOUT_MS`
(default 5 min — generous for fair queueing under `groupConcurrency`). A `PENDING` or
`STREAMING` row whose lease is `NULL` or past is *abandoned*.

`AiService.currentConversation()` and `ask()` run a fenced close first:
`updateMany WHERE conversation_id AND status IN (PENDING, STREAMING) AND lease expired →
FAILED, error_code INTERNAL, completed_at now()`, content kept. This happens in `ask()`
*before* the busy check, so a dead reply never blocks a new question.

A late delivery can still claim an expired `PENDING` row if nobody closed it yet — the user
gets the answer. If it was closed, the claim finds `FAILED` and exits.

*Alternative:* a cron sweeper — rejected: another topology entry and a system-scope query
across tenants to fix something that only matters when the owner looks at it.

### D4. Stop is a database fact first, a pub/sub signal second

New column `cancel_requested_at TIMESTAMPTZ NULL`. `AiService.cancel()`:

1. `updateMany WHERE id AND status='PENDING' → CANCELLED, completed_at` — Stop before start is
   final immediately; the claim (D1) will find `CANCELLED` and never call the backend.
2. If that touched 0 rows: `updateMany WHERE id AND status='STREAMING' → cancel_requested_at
   = now()`, and only if it touched 1 row, publish on `AiCancelChannel` as today.
3. Terminal → no-op, as the spec already requires.

Step 1 and the worker's claim contend on the same row lock; whichever commits first wins and
the other's `WHERE` fails, so both orders end consistently.

The worker aborts on whichever comes first: the pub/sub signal (fast path, unchanged), a check
of `cancel_requested_at` right after subscribing (closes the subscribe race), or a periodic
check every `AI_CANCEL_CHECK_MS` (default 2 s) on its own timer — independent of chunks, so a
stalled provider still stops. The periodic check is one PK read per active generation every
two seconds; the AI-0 argument against polling was about every 120 ms frame, not this.

### D5. Conversation creation without catching inside an aborted transaction

`createActive()` becomes `createMany({ data: [...], skipDuplicates: true })` — Postgres
`INSERT … ON CONFLICT DO NOTHING`, which covers the partial unique index
`ai_conversations_active_per_user_key` without naming a conflict target — followed by
`findActive()`. Nothing throws, so the transaction stays usable. Under read committed the
losing insert waits for the winner's commit and the following `SELECT` sees its row.

`ask()` takes the conversation's row lock first (the `lastMessageAt` update moves to the top
of the transaction). Two concurrent asks then serialize: the second sees the first's `PENDING`
reply and gets the regular busy `409`, instead of racing to the `seq` unique index.

### D6. The transcript carries the stream position; the client keeps it in the cache

New column `chunk_count INT NOT NULL DEFAULT 0`. The worker only ever appends whole flushed
frames to its in-memory `text`, so `text` is always exactly frames `0…n-1`; partial persist and
finalize write `content` and `chunk_count = n` together. `AiMessageResponseSchema` gains
`attempt` and `chunkCount`; `AiMessageDeltaSchema` gains `attempt`.

Client rule in `ai-sync.ts`, reading position from the cached message (the module-level
`expectedChunk` map goes away):

| Delta vs cached message | Action |
| --- | --- |
| message not in cache | buffer, request a re-read |
| `attempt` lower | drop (stale attempt) |
| `attempt` higher, `chunkSeq === 0` | replace content, adopt attempt, `chunkCount = 1` |
| `attempt` higher, `chunkSeq > 0` | buffer, request a re-read |
| same attempt, `chunkSeq < chunkCount` | drop (already in content) |
| same attempt, `chunkSeq === chunkCount` | append, then drain contiguous buffered frames |
| same attempt, `chunkSeq > chunkCount` | buffer, request a re-read |

When a re-read lands, buffered frames of the same attempt from `chunkCount` onwards are
applied if contiguous. Because partial persist lags live frames by up to
`AI_PARTIAL_PERSIST_MS`, the buffer is what lets a re-read client resume without re-reading
again. Re-reads are deduplicated with `invalidateQueries(…, { cancelRefetch: false })`.
The buffer is per message, cleared on `ai.message-completed.v1`, on a non-recovered reconnect,
and when a higher attempt starts.

`attempt` replaces the `chunkSeq === 0 ⇒ restart` inference as the restart guard. It is
strictly stronger: it also rejects a stale attempt's frame 0, which the old rule would have
treated as a restart.

*Alternative:* persist on every flush so the snapshot never lags — rejected, ~8 writes/s per
generation to save a small client buffer.

### D7. One signal-only event for "the conversation changed"

`ai.conversation-changed.v1 { conversationId, reason: 'turn-created' | 'reply-closed' | 'reset',
occurredAt }`, emitted by `apps/api` through `RealtimeEmitter` into the user's personal room,
after commit (`onCommit`, the calendar/notifications pattern). Emitted by `ask()`
(`turn-created`), `reset()` (`reset`), and by `cancel()` step 1 or the abandoned-reply close
(`reply-closed`). The client's only reaction is a deduplicated re-read; `reason` is for logs.

It carries no payload, per the realtime rule — the delta stays the single exception. The
asking tab also receives it and re-reads once; that is cheaper than threading a socket id
through the HTTP request to exclude it.

*Alternative:* invalidate whenever a delta names an unknown message, with no new event —
rejected as the only mechanism: it cannot show the question before the first frame arrives
(the queue poll alone is up to 0.5 s) and cannot reflect `reset`. It remains as the fallback
row in D6.

### D8. Refactor boundaries

- `libs/shared/src/ai/ai-message-state.service.ts` — every status transition of an
  assistant reply, for both processes: worker-side `claim`, `restart`, `persistPartial`,
  `isCancelRequested`, `finalize` (fenced by `attempt`, each returns whether it still owns the
  row) and API-side `cancelPending`, `requestCancel`, `closeAbandoned`. One file owns the
  state machine, so the `WHERE` clauses that make the transitions mutually exclusive are read
  side by side. It lives in `libs/shared` rather than `apps/worker` for that reason and so the
  tenant e2e suite can race the transitions against real Postgres. It takes a transaction
  client and never emits; emission stays with the callers' `onCommit` (worker `completed`,
  API `conversation-changed`).
- `apps/worker/src/ai/chunk-coalescer.ts` — pure: `push(text, now)` returns a frame or null,
  `flush()` returns the tail; owns `chunkSeq` and the accumulated `text`. No Nest, no I/O.
- `libs/shared/src/ai/prompt/history.ts` — pure `selectHistoryPairs(rows, turns)` next to
  `buildPrompt`: walks rows ascending, keeps `(USER k, ASSISTANT k+1)` pairs where the answer is
  `COMPLETE`, returns the last `turns` pairs. The query reads `seq < reply.seq - 1` with any
  status, `take: turns * 2 + slack`, so failed turns do not shrink the window unnoticed.
- The subscriber keeps only coordination: claim → subscribe → stream with retry loop →
  finalize. No separate error-mapper class until AI-1 brings real error categories.

## Risks / Trade-offs

- [Lease compares use the app clock (`new Date()` in Prisma filters) of two different
  processes] → single-node deploy today; the 30 s grace absorbs normal skew. If multi-node,
  move comparisons to `now()` in SQL.
- [`AI_PENDING_TIMEOUT_MS` shorter than a real queue backlog closes a reply that would
  eventually have run] → default 5 min is far above `groupConcurrency` wait at current scale;
  the reply fails visibly and the user can ask again, which beats a conversation stuck busy.
- [Closing abandoned replies on read makes `GET /ai/conversation` write] → it already creates
  the conversation on demand; the write is a single fenced `updateMany` that touches rows only
  when something is actually dead.
- [The fake's fail-once state is per process and keyed on text] → only for tests; documented
  on the directive. Workers in e2e run one instance.
- [Client buffer grows if a re-read never arrives] → capped per message (drop buffer and fall
  back to re-read on `completed`); `completed` always converges the view.
- [`attempt` added to deltas changes the restart guard every client relies on] → only one
  client exists (`apps/web`); contract and client ship in the same change; CLAUDE.md rule 15
  and `docs/realtime.md` are updated together.

## Migration Plan

1. One Prisma migration adding the four columns with defaults; `NOT NULL DEFAULT 0` for the two
   integers, nullable timestamps. Existing `PENDING`/`STREAMING` rows get `NULL` leases and are
   treated as abandoned — acceptable, dev data only.
   Create with `cd libs/database && pnpm exec prisma migrate dev --name ai_message_ownership`.
2. Contracts + `pnpm openapi:generate && pnpm web:codegen`; commit generated artifacts.
3. Deploy API, worker and web together (one stack). Rollback = previous images; the extra
   columns are ignored by old code.

## Open Questions

- Should `AI_CANCEL_CHECK_MS` and `AI_PARTIAL_PERSIST_MS` share one timer? They are both ~2 s
  and could be one tick. Decide during implementation; no spec or task impact.
