# Proposal

## Why

AI-0 shipped the whole assistant pipeline on `FakeLlmProvider`. A static review
(`docs/notes/ai-assistant-review-gaps.md`, 2026-09-21) and the cross-check of the two research docs
(`docs/ai-assistant.md` §6.3) found defects that the fake provider hides but a real provider
would turn into money and stuck conversations: overlapping generations, a retry the topology
promises but never runs, a Stop that is silently lost, the current question sent to the model
twice, a transaction that cannot recover from a lost race, and a second tab that receives
deltas it cannot render. They are cheap to fix and test now, against a free and deterministic
backend, and expensive to diagnose after AI-1 connects a paid one. This is phase **AI-0.1**,
the gate before AI-1.

## What Changes

- **Prompt context is sent once.** The question being answered is no longer also included in
  the history, and history is built from completed question/answer pairs only, so failed or
  stopped turns cannot leave an unpaired question in the context.
- **One owner per reply.** Starting generation atomically claims the reply with an attempt
  number and a lease. A second delivery of the same job cannot generate while the lease is
  live; every intermediate and final write is accepted only from the owning attempt.
- **Retry actually happens.** A transient backend failure restarts generation from scratch
  inside the same delivery, up to a configured budget, with clients told to discard the failed
  attempt's text. A permanent failure, a timeout, or a user Stop never retries. The queue's own
  retry is left to cover process crashes, recovered through lease expiry.
- **An abandoned reply cannot keep a conversation busy forever.** A pending or streaming reply
  whose lease has expired with nobody owning it is closed as failed the next time the
  conversation is read or asked.
- **Stop is durable.** Stopping a reply that has not started closes it immediately; stopping a
  reply in progress records the request in the database, so it takes effect even when the
  fast pub/sub signal is lost or arrives before the worker is listening.
- **Concurrent first use is safe.** Creating the active conversation no longer depends on
  catching a unique violation inside a transaction the violation has already aborted; two
  concurrent questions in one conversation resolve to one accepted and one "busy".
- **Every open tab follows the conversation.** Asking or starting a new conversation notifies
  the user's other tabs to re-read, and the transcript tells a client exactly which attempt
  and how many updates its content already includes, so a client that re-read can keep
  applying live updates instead of re-reading on every one.
- **Worker refactor (no behaviour of its own):** reply state transitions move out of the
  subscriber into a dedicated state service; chunk coalescing becomes a standalone helper.
- Realtime delta payload gains `attempt`; the transcript's message shape gains `attempt` and
  `chunkCount`; a new signal-only realtime event `ai.conversation-changed.v1`. Additive — no
  existing field changes meaning, except that a restart is now announced by a higher
  `attempt` rather than inferred from `chunkSeq === 0`.

Out of scope: any real provider, knowledge corpus, quotas, retention (all AI-1).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-assistant/generation-pipeline`: adds exclusive generation ownership, abandoned-reply
  recovery, and context-exactly-once; makes the retry and Stop requirements concrete
  (transient-only retry, Stop before start, Stop surviving a lost signal); strengthens
  multi-tab delivery and recovery so a re-read client resumes live updates.
- `ai-assistant/conversation`: concurrent first use yields exactly one active conversation
  without a server error; concurrent questions yield one accepted and one busy; other open
  clients are told when the conversation changes.

## Impact

- **Database:** migration on `ai_messages` — `attempt`, `lease_expires_at`, `chunk_count`,
  `cancel_requested_at`.
- **Contracts:** `AiMessageResponseSchema` (+`attempt`, `chunkCount`), `AiMessageDeltaSchema`
  (+`attempt`), new `AiConversationChangedSchema` + `REALTIME_EVENTS` entry. OpenAPI and orval
  artifacts regenerated for the tenant plane.
- **API (`apps/api/src/ai`):** `AiService.ask`/`reset`/`cancel`/`currentConversation`;
  realtime emission after commit through the existing `RealtimeEmitter`.
- **Worker:** `ai-generate-reply.subscriber.ts` split into coordinator + `AiMessageStateService`
  + `ChunkCoalescer`; in-process retry; periodic cancel check.
- **Shared:** `LlmProviderError` gains a `retryable` flag; `FakeLlmProvider` gains a
  fail-once directive; `ai.config.ts` gains retry settings and a boot-time check that lease,
  timeout and the queue's `expireInSeconds` agree; topology comment for `ai-generator`
  corrected.
- **Web (`apps/web/src/realtime/ai-sync.ts`):** stream position read from the cache instead of
  a module-level map; handles `attempt` and the new event.
- **Docs:** `docs/ai-assistant-implementation.md`, `docs/ai-assistant.md` §6.3 and §10,
  `docs/notes/ai-assistant-review-gaps.md` (closed), `CLAUDE.md` rule 15 (restart guard is now
  `attempt`).
