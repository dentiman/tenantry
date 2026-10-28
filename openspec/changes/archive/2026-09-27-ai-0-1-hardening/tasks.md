# Tasks

Phase **AI-0.1** of `docs/ai-assistant.md` §10: close the AI-0 debt from
`docs/notes/ai-assistant-review-gaps.md` (items 1–6) and §6.3, on `FakeLlmProvider` only. No task
waits on a provider account or a user decision.

Root gate at the end of each group: `pnpm lint && pnpm typecheck && pnpm build`.
Worker unit tests: `pnpm --filter @saas-skeleton/worker test`. Tenant e2e: `pnpm api:test:e2e`
(needs Postgres + Valkey of this workspace slot; not alongside a live dev stack).

## 1. Prompt context exactly once (review item 2)

- [x] 1.1 Add pure `selectHistoryPairs(rows, turns)` in `libs/shared/src/ai/prompt/history.ts`
      (design D8): keeps only `(USER k, ASSISTANT k+1 COMPLETE)` pairs, oldest first, last
      `turns` pairs. Export from the prompt index. Verify with a new `history.test.ts`: empty
      input, failed/cancelled answer drops its question, unpaired trailing question dropped,
      limit keeps the most recent pairs.
- [x] 1.2 Change the history query in the subscriber to `seq < reply.seq - 1`, any status,
      `take: historyTurns * 2 + slack`, and pass the rows through `selectHistoryPairs`.
      Verify with a subscriber test that captures the `LlmRequest`: first question appears
      exactly once with no history; with a failed earlier turn the history holds only complete
      pairs and the current question is last and once.

## 2. Data model and contracts

- [x] 2.1 Add `attempt Int @default(0)`, `chunkCount Int @default(0) @map("chunk_count")`,
      `leaseExpiresAt DateTime? @map("lease_expires_at")`,
      `cancelRequestedAt DateTime? @map("cancel_requested_at")` to `AiMessage` in
      `schema.prisma`, with comments pointing to design D1/D4/D6. Create the migration with
      `cd libs/database && pnpm exec prisma migrate dev --name ai_message_ownership` (not via
      `pnpm … -- --name`). Verify `pnpm db:generate` succeeds and the migration SQL adds exactly
      four columns and nothing else.
      **Note:** the generated SQL also re-emits `ALTER COLUMN tenant_id SET DEFAULT` for every
      RLS table — pre-existing Prisma `dbgenerated()` formatting drift present in every prior
      migration in this repo (verified: 16–18 such lines already in the AI-0 and chat
      migrations), not introduced by this change. The four `ai_messages` columns are the only
      actual schema change.
- [x] 2.2 Add `attempt` and `chunkCount` (non-negative ints) to `AiMessageResponseSchema`, and
      `attempt` to `AiMessageDeltaSchema` in `libs/contracts`; update the mapper in
      `apps/api/src/ai`. Verify `pnpm typecheck`.
- [x] 2.3 Add `AiConversationChangedSchema` (`conversationId`, `reason: 'turn-created' |
      'reply-closed' | 'reset'`, `occurredAt`) and `REALTIME_EVENTS.aiConversationChanged =
      'ai.conversation-changed.v1'`, plus its `ServerToClientEvents` entry. Verify
      `pnpm typecheck`.
- [x] 2.4 Run `pnpm openapi:generate && pnpm web:codegen`; verify the generated diff only adds
      `attempt`/`chunkCount` to the AI message type, and commit the artifacts with the change.

## 3. Shared: config, provider error, fake directives

- [x] 3.1 Add `AI_PROVIDER_RETRIES` (default 1), `AI_RETRY_DELAY_MS` (2000),
      `AI_PENDING_TIMEOUT_MS` (300000), `AI_CANCEL_CHECK_MS` (2000) to `ai.config.ts`, and a
      derived `leaseMs = requestTimeoutMs + 30_000`. Verify with `ai.config.test.ts` defaults
      and overrides.
- [x] 3.2 Add a boot-time check (worker only) that the `ai-generator` topology consumer's
      `expireInSeconds × 1000` exceeds `leaseMs + retryDelayMs × providerRetries` (design D1);
      correct the `ai-generator` comment in `topology.ts` (queue retry = crash recovery only).
      Verify with a unit test that a violating config throws and the defaults pass.
- [x] 3.3 Add `retryable` (default `true`) to `LlmProviderError`. In `FakeLlmProvider`: keep
      `__fail__` (retryable, every attempt), add `__fail_once__` (retryable once per request,
      then succeeds; per-instance set keyed by the final user message) and `__reject__`
      (non-retryable); export them via `FAKE_LLM_DIRECTIVES`. Verify in
      `fake-llm.provider.test.ts`.

## 4. Reply state machine (review items 1, 5, 6; design D1, D3, D4)

- [x] 4.1 Create `libs/shared/src/ai/ai-message-state.service.ts` with worker-side `claim`,
      `restart`, `persistPartial(text, chunkCount)`, `isCancelRequested`, `finalize`, all as
      conditional `updateMany` fenced by `attempt` and `status = STREAMING` (claim uses the
      `PENDING` / expired-lease condition), each reporting whether ownership still holds.
      No `$executeRaw`. Register it in `AiModule`. Verify `pnpm typecheck`.
- [x] 4.2 Add API-side `cancelPending`, `requestCancel`, `closeAbandoned(conversationId)` to the
      same service (design D3/D4). Verify `pnpm typecheck`.
- [x] 4.3 Add tenant e2e `apps/api/test/ai-state.e2e-spec.ts` against real Postgres: two
      concurrent `claim`s → exactly one owner; a write with a stale `attempt` touches 0 rows;
      a `STREAMING` row with an expired lease is claimable and gets `attempt + 1`;
      `cancelPending` racing `claim` → exactly one wins and the row is consistent; terminal rows
      are never claimed. Verify `pnpm api:test:e2e` passes.

## 5. Worker: coordinator, coalescer, retry, durable Stop (items 1, 3, 5, 6)

- [x] 5.1 Extract `apps/worker/src/ai/chunk-coalescer.ts` (pure; owns `chunkSeq` and the
      accumulated text, flushes by time or paragraph). Verify with a unit test: frames are
      fewer than inputs, concatenation equals input, `chunkCount` equals frames emitted,
      `flush()` returns the tail.
- [x] 5.2 Rewrite `AiGenerateReplySubscriber` as a coordinator: claim → subscribe to
      `AiCancelChannel` → immediate `isCancelRequested` check → stream through the coalescer
      with `persistPartial(text, chunkCount)` → finalize. Deltas carry `attempt`. On lost
      ownership stop silently (no deltas, no finalize). Set the new reply lease on claim.
      Verify the existing subscriber tests still pass after adapting the fake world to
      conditional updates.
      **Found while implementing:** `claim()`'s original draft reset `cancelRequestedAt` on
      every claim, matching design.md's literal SQL gap check but silently dropping a Stop
      requested against an abandoned (crashed) attempt when a new attempt reclaimed the row —
      fixed to leave `cancelRequestedAt` untouched on claim (matches design.md D1's SQL, which
      never mentions it); regression covered in both the worker suite and
      `ai-state.e2e-spec.ts`.
- [x] 5.3 In-process retry (design D2): on a retryable `LlmProviderError` with budget left,
      wait `retryDelayMs` (abortable), `restart`, re-stream from `chunkSeq 0` with the new
      `attempt`; non-retryable, exhausted, timeout and cancel go straight to finalize. One
      overall timeout covers all attempts. Verify with tests: `__fail_once__` → `COMPLETE`,
      two attempts, deltas of attempt 2 start at 0 and the stored text equals attempt 2 only;
      `__fail__` → `FAILED/PROVIDER_UNAVAILABLE` after `1 + retries` calls; `__reject__` →
      one call; `__stall__` → `TIMEOUT`, no retry; Stop during the retry delay → `CANCELLED`.
- [x] 5.4 Periodic cancel check on its own `cancelCheckMs` timer, cleared in `finally`
      (design D4). Verify with tests: Stop via DB marker only (pub/sub never fires) on a
      `__stall__` reply ends `CANCELLED` within `cancelCheckMs`; marker set before subscribe is
      honoured at the post-subscribe check.
- [x] 5.5 Verify ownership tests in the subscriber suite: a second concurrent `handle()` for the
      same reply consults the provider once; a delivery for a live-leased `STREAMING` row
      exits without writes; a delivery after lease expiry regenerates with `attempt + 1`.

## 6. API: conversation creation, busy, Stop, abandoned, events (items 4, 5, §6.3)

- [x] 6.1 `createActive()` → `createMany({ skipDuplicates: true })` + `findActive()`, no
      try/catch on `P2002`; `ask()` updates the conversation row first to take its lock, then
      runs `closeAbandoned`, then the busy check (design D3/D5). New replies get
      `leaseExpiresAt = now + pendingTimeoutMs`. `currentConversation()` also runs
      `closeAbandoned`. Verify with e2e: concurrent first GET/ask/reset → no 5xx, exactly one
      `ACTIVE` conversation; two concurrent asks → one 202, one 409, one new pair in the
      transcript; a reply with an expired lease is returned `FAILED` and a new ask is accepted.
- [x] 6.2 `cancel()` → `cancelPending`, else `requestCancel` + pub/sub only when a row was
      marked (design D4). Verify with e2e: Stop on `PENDING` → `CANCELLED` immediately and the
      published job, when processed, does not call the provider; Stop on a finished reply stays
      a no-op; Stop on another user's reply stays 404.
      (The "does not call the provider" guarantee is `AiMessageStateService.claim()`'s own
      fencing on terminal statuses, already covered by `ai-state.e2e-spec.ts` and the worker
      suite — not re-run here since pg-boss is mocked in this file.)
- [x] 6.3 Emit `ai.conversation-changed.v1` after commit via `RealtimeEmitter` from `ask`
      (`turn-created`), `reset` (`reset`), `cancelPending` and a non-empty `closeAbandoned`
      (`reply-closed`), only into the owner's personal room. Verify with e2e using a socket
      client for the owner and one for another user of the same tenant: the owner receives
      each event after the row is readable, the other user receives none.
      New `apps/api/test/ai-realtime.e2e-spec.ts` (real listening app + `socket.io-client`,
      the same pattern as `realtime.e2e-spec.ts`) — covers all four emission sites.

## 7. Web: stream position and multi-tab (§6.3, design D6/D7)

- [x] 7.1 Rewrite `apps/web/src/realtime/ai-sync.ts` per the D6 table: position read from the
      cached message (`attempt`, `chunkCount`), per-message frame buffer drained after a
      re-read, deduplicated re-reads (`cancelRefetch: false`), buffer cleared on completed,
      on non-recovered reconnect and on a higher attempt; module-level `expectedChunk` removed.
      Listen to `ai.conversation-changed.v1` → deduplicated re-read. Verify with a new Vitest
      `ai-sync.test.ts` covering every row of the D6 table, including "re-read lags live frames,
      buffered frames fill the gap without a second re-read".
      **Adjusted from design:** dedup uses `invalidateQueries(...).then(drain)` rather than
      `cancelRefetch: false` — `initAiSync` now takes an injectable `socket` param (defaulting
      to `getSocket()`) so the fake-socket unit tests don't open a real connection; TanStack
      Query's own request dedup makes concurrent `invalidateQueries` calls for the same key
      share one refetch regardless, so no double network round-trip either way.
- [x] 7.2 Manual two-tab check through the browser (Orca embedded browser, since this session
      runs in Orca). Ran `pnpm api:dev` + `pnpm worker:dev` against slot 0's existing Postgres/
      Valkey, admin@example.com, two tabs on `/workspace`. Results, all against the built
      `FakeLlmProvider`:
      - Ask in tab A → tab B showed the new question and the completed reply without tab B
        ever asking (§6.3 fix, confirmed via `ai.conversation-changed.v1`).
      - `__fail_once__ __long__ ...` → server-side `attempt` went 0→1 (claim) →2 (in-process
        retry, `docs/notes/ai-assistant-review-gaps.md` п.1/3); both tabs converged on the SAME
        final content with no duplication or leftover from the failed first attempt.
      - `__stall__` question asked in tab A → tab B rendered a live "Stop" button for a
        generation it did not start, and clicking Stop **in tab B** ended the reply as
        "Stopped." in **both** tabs (cross-tab Stop delivery + durable Stop of a stalled
        generation, review п.5). Timing made the stricter "Stop while still `PENDING`, before
        any worker delivery" sub-case impractical to hit reliably through CLI-driven browser
        round-trips; that exact case is already covered deterministically by
        `ai.e2e-spec.ts`'s "Stop before generation started" test.
      - "New conversation" in tab A → tab B emptied to the same welcome state in the same
        beat, no manual reload.
      One incidental finding, unrelated to this change: port 3001 was held by a stray
      `node apps/api/dist/main` process (started outside `pnpm api:dev`, i.e. exactly the
      anti-pattern CLAUDE.md rule 5 warns about) — killed with the user's confirmation before
      starting a proper `pnpm api:dev`. All ad hoc dev processes and browser tabs were closed
      after the check; nothing from this task was left running.

## 8. Docs and closing

- [x] 8.1 Update `docs/ai-assistant-implementation.md` (data model columns, ownership/lease,
      retry model, durable Stop, the new event, the attempt-based restart guard) and
      `docs/realtime.md` (delta guard is `attempt` + `chunkSeq`). Promote every design decision
      from this change that stays true (D1–D7) — the archive is not a reference.
- [x] 8.2 Update `docs/ai-assistant.md`: §6.3 marked fixed, §0 gets an "AI-0.1" row, §10 phase
      table gets the AI-0.1 row; mark all items in `docs/notes/ai-assistant-review-gaps.md` closed with
      a pointer to this change; update CLAUDE.md rule 15 (restart guard is a higher `attempt`,
      not `chunkSeq === 0`). Verify by grepping `chunkSeq === 0` across `docs/` and `CLAUDE.md`
      — no remaining claim that it is the restart guard.
- [x] 8.3 Final gate: `pnpm lint && pnpm typecheck && pnpm build`, worker tests, `pnpm web:test`,
      `pnpm api:test:e2e`, then `openspec validate ai-0-1-hardening --strict`. All green.
      **Note:** `pnpm api:test:e2e` is flaky across files **unrelated to this change** — two
      full runs each failed a different pair of pre-existing specs (`chat`+`activities`, then
      `notifications`+`files`; none AI-related), and each failing file passed in isolation. A
      third full run passed 322/322. Confirmed pre-existing on a clean `git stash` checkout
      before starting this change (a `notifications.e2e-spec.ts` test failed there too, with
      fewer total tests since this change's new specs weren't present) — not introduced here.
