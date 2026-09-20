# Tasks

Phase **AI-0** of `docs/ai-assistant-plan.md` §9. Every task below is executable now: no task
waits on a user decision, a provider account, an API key, or a later phase.

Root gate for the whole change (run at the end of each group, not only at the end):
`pnpm lint && pnpm typecheck && pnpm build`.

## 1. Shared messaging: worker options and job groups

- [x] 1.1 Extend `ConsumerSpec` in `libs/shared/src/messaging/topology.ts` with optional
      `localConcurrency`, `groupConcurrency`, `pollingIntervalSeconds`, `expireInSeconds`,
      documenting each with the reasoning from `design.md`. Verify `pnpm typecheck` passes and
      that no existing entry in `MESSAGE_TOPOLOGY` needs editing.
- [x] 1.2 Pass those options through `MessageWorkerRegistrar.onApplicationBootstrap()` into
      `boss.work()`, building the options object **conditionally** (never pass `undefined`
      keys — pg-boss's validator rejects them; `CLAUDE.md` pitfall 9). Verify by starting
      `pnpm worker:dev` against a running `pnpm docker:up` and confirming all existing
      consumers register exactly as before (same startup log line, same count).
- [x] 1.3 Carry `expireInSeconds` from the manifest into `PgBossService.syncQueues()`'s
      desired-queue reconciliation alongside `retryLimit`/`retryDelay`, including the drift
      check so an existing queue is updated rather than left stale. Verify by changing the
      value for a scratch consumer, restarting the worker, and seeing the
      "Queue policy synced from manifest" log.
- [x] 1.4 Add an optional `group?: { id: string; tier?: string }` to `MessagePublisher`'s
      publish options and forward it into `SendOptions`, again conditionally. Verify with a
      unit-level assertion (or a temporary log) that `boss.send` receives `group` when supplied
      and no `group` key at all when not.
- [x] 1.5 Run `pnpm api:test:e2e` (`messaging.e2e-spec.ts` in particular) and confirm the
      existing messaging suite is green — this group must be behaviour-neutral for every
      consumer that does not opt in.

## 2. Database: conversations and messages

- [x] 2.1 Add `AiConversation` and `AiMessage` to `libs/database/prisma/schema.prisma` with the
      fields listed in `design.md` (including the nullable, currently unwritten token/model
      columns), the `tenantId` `dbgenerated` default used by every tenant model, the
      `@@unique([tenantId, conversationId, seq])` arbiter, a composite FK from message to
      conversation on `[tenantId, conversationId]`, and the `Tenant` back-relations. Verify
      `pnpm db:generate` succeeds.
- [x] 2.2 Create the migration with
      `cd libs/database && MIGRATE_DATABASE_URL=<slot url> pnpm exec prisma migrate dev --name ai_assistant_conversations`
      (never `pnpm db:migrate:dev -- --name X` — it hangs, `CLAUDE.md` Commands). **Pass
      `MIGRATE_DATABASE_URL` explicitly**: `prisma.config.ts` reads it from `process.env`, and
      the Prisma CLI invoked from `libs/database` does **not** load the repo-root `.env.local`,
      so it silently falls back to `localhost:5432` — slot 0, i.e. another checkout's database.
      Verify the generated SQL contains both tables and nothing else unexpected, **and** that
      the migration landed on this worktree's slot, not on 5432.
- [x] 2.3 Hand-edit the migration to add, per the MT-2 pattern used by every existing tenant
      table: `ENABLE ROW LEVEL SECURITY`, the tenant policies for `saas_app`, and the
      grants. Verify by extending `apps/api/test/rls.e2e-spec.ts` with a case proving a
      conversation written under tenant A is invisible under tenant B.
- [x] 2.4 Add the partial unique index in the same migration:
      `CREATE UNIQUE INDEX ... ON ai_conversations (tenant_id, user_id) WHERE status = 'ACTIVE'`
      (Prisma cannot express it; the notification-collapse index is the precedent). Verify with
      a direct SQL insert of a second `ACTIVE` row for the same user failing on the constraint.
- [x] 2.5 Run `pnpm db:reset` on a workspace slot (`pnpm ws:init`) and confirm migrate + seed
      complete cleanly from scratch.

## 3. Contracts

- [x] 3.1 Create `libs/contracts/src/ai/` with the conversation and message response schemas
      (message carries `seq`, `role`, `status`, `content`, `errorCode`, timestamps), the ask
      request (`z.string().trim().min(1).max(AI_MAX_INPUT_CHARS)`), and the ask response
      (created question + placeholder reply). Never `z.coerce.date()` in responses — ISO
      strings, per `CLAUDE.md` pitfall 2. Verify `pnpm typecheck`.
- [x] 3.2 Add `ai.message-delta.v1` and `ai.message-completed.v1` to
      `libs/contracts/src/realtime/realtime.schema.ts` + `.types.ts` + `REALTIME_EVENTS`, with
      a comment on the delta schema stating why a payload-carrying socket event is safe here
      (`chunkSeq` + authoritative transcript read — `design.md`). Verify both frontends still
      typecheck against `ServerToClientEvents`.
- [x] 3.3 Add the `AiMessageErrorCode` domain enum (`PROVIDER_UNAVAILABLE`, `TIMEOUT`,
      `INTERNAL`) to the AI contract for a failed reply, and its i18n keys for `apps/web`. Do
      **not** extend `ApiErrorCodeSchema` — it is a closed HTTP-shaped set by design
      (`docs/error-handling.md` §1); HTTP conditions map onto 403/409/404/429 per `design.md`.
      Verify each stored code renders as text rather than a raw key.
- [x] 3.4 Export everything from the package index and confirm `apps/web` resolves the new
      imports (subpath/`exports` rules, `CLAUDE.md` pitfalls 13–14). Verify `pnpm build`.

## 4. Provider seam and prompt builder (`libs/shared/src/ai/`)

- [x] 4.1 Define `LlmProvider` as `generate(request, signal): AsyncIterable<LlmChunk>` plus the
      `LlmRequest` / `LlmChunk` / `LlmUsage` types, with `usage` reserved on the terminal chunk
      for AI-1. Verify `pnpm typecheck`.
- [x] 4.2 Implement `FakeLlmProvider`: streams canned Markdown that exercises headings, a list,
      an inline code span and a fenced block; paces output from config; honours `signal`; and
      recognises the `__fail__`, `__stall__` and `__long__` directives in the question. Verify
      with a unit test that each directive produces the intended outcome and that aborting
      mid-stream stops iteration promptly.
- [x] 4.3 Add the provider factory keyed on `AI_PROVIDER`, where `fake` is the only legal value
      in AI-0 and an unknown value throws at startup (no silent fallback). Verify the worker
      refuses to boot with `AI_PROVIDER=openai` and the error names the offending variable.
- [x] 4.4 Write the prompt builder with signature `(history, question, knowledge, userContext)`,
      where AI-0 passes an empty `knowledge` and a `userContext` narrowed by type to
      `{ role, locale }` — the allowlist is enforced by the signature, not by discipline
      (`design.md`, plan §5.1). Verify with a unit test asserting the built message array's
      order and that no field outside the allowlist can be passed.
- [x] 4.5 Add the AI config module reading `AI_ENABLED`, `AI_PROVIDER`,
      `AI_MAX_OUTPUT_TOKENS` (1024), `AI_HISTORY_TURNS` (10), `AI_REQUEST_TIMEOUT_MS`
      (60000), `AI_STREAM_FLUSH_MS` (120) through a Zod schema with those defaults
      (`AI_MAX_INPUT_CHARS` is a contract constant, not env — `design.md`). Verify with
      a unit test that an invalid value fails fast with a message naming the variable.

## 5. Message definition and topology row

- [x] 5.1 Add `libs/shared/src/messaging/definitions/ai.messages.ts` with
      `generateAiReplyCommand = defineCommand('ai.generate-reply', z.object({ conversationId, messageId }))`
      (tenant scope; `tenantId` stays out of the payload — it rides the envelope). Verify
      `pnpm typecheck`.
- [x] 5.2 Add its `MESSAGE_TOPOLOGY` row with consumer `ai-generator` and the options from
      `design.md` (`localConcurrency: 4`, `groupConcurrency: 2`, `pollingIntervalSeconds: 0.5`,
      `expireInSeconds: 120`, `retryLimit: 1`). Verify the worker still boots — the boot-assert
      will fail until task 6.1 exists, which is the intended ordering signal.

## 6. Worker: the generation subscriber

- [x] 6.1 Create `apps/worker/src/subscribers/ai-generate-reply.subscriber.ts` and register it
      in `worker.module.ts`. Verify `pnpm worker:dev` boots and logs the consumer count
      incremented by one (topology boot-assert now satisfied).
- [x] 6.2 Implement phase 1: inside `withTenantTx`, load the conversation and the last
      `AI_HISTORY_TURNS` exchanges, return early when the reply is already `COMPLETE`
      (idempotency by row status, **not** `runOnce`), otherwise set the reply to `STREAMING`.
      Verify with a test that a second invocation for a completed reply is a no-op.
- [x] 6.3 Implement phase 2: consume the provider's iterable **outside any transaction**,
      coalesce into chunks on `AI_STREAM_FLUSH_MS` or a paragraph boundary, and emit
      `ai.message-delta.v1` with a monotonic `chunkSeq` starting at 0 through the existing
      `WorkerRealtimeEmitter`. Verify by watching a browser client receive ordered deltas whose
      concatenation equals the final answer.
- [x] 6.4 Add the partial-content write: a short standalone `UPDATE` of the reply's `content`
      roughly every 2 s. Verify by killing the worker mid-generation and confirming
      `GET /ai/conversation` still returns the text produced so far, with the reply not marked
      complete.
- [x] 6.5 Implement phase 3: a second `withTenantTx` writing final `content`, `status`,
      `completedAt`, with `onCommit(...)` emitting `ai.message-completed.v1`. Verify the
      completed event never arrives before the row is committed (read the transcript
      immediately on receiving the event and confirm it is already final).
- [x] 6.6 Wire cancellation: subscribe to `ai:cancel:{messageId}` on the worker's existing
      ioredis connection for the duration of a generation, abort the provider on receipt, and
      persist the partial content with status `CANCELLED`. Verify a `__long__` answer stops
      within a second of the cancel call and keeps its partial text.
- [x] 6.7 Wire failure and timeout: wrap the call in an `AbortController` bounded by
      `AI_REQUEST_TIMEOUT_MS`; on a provider error or timeout mark the reply `FAILED` with
      `AI_PROVIDER_UNAVAILABLE`. Verify `__fail__` and `__stall__` each land in `FAILED` and
      leave the conversation accepting a new question.
- [x] 6.8 Handle the retry path: on the single automatic retry, reset accumulated content and
      emit `chunkSeq: 0` so the client discards the previous attempt. Verify with a test that
      forces one failure then success and asserts the stored answer contains no duplication.

## 7. API: the `ai` module

- [x] 7.1 Create `apps/api/src/ai/` (module, controller, service, mapper, DTOs via
      `createZodDto`) with `Dto.Output` on every response type and Swagger decorators, following
      the DTO → Service → Mapper → Controller layering. Verify the routes appear in
      `/api/docs`.
- [x] 7.2 Implement `GET /ai/conversation`: returns the caller's active conversation (creating
      it on demand) with its messages, including partial content of a reply in progress. No id
      in the path. Verify with an e2e case for a first-time user and one mid-generation.
- [x] 7.3 Implement `POST /ai/conversation/messages`: validate, reject when the conversation is
      busy with `AI_CONVERSATION_BUSY`, then in one `withTenantTx` write the user message and
      the `PENDING` reply and `publish(tx, generateAiReplyCommand, …, { group: { id: tenantId } })`,
      answering `202` with both rows. Verify an e2e case asserts the published envelope (pg-boss
      is mocked in e2e) carries the right `tenantId`, `actor` and `group`.
- [x] 7.4 Implement `POST /ai/conversation/reset`: retire the active conversation and return a
      fresh empty one, in one transaction. Verify an e2e case confirms the old conversation and
      its messages still exist and that the new one is empty.
- [x] 7.5 Implement `POST /ai/conversation/messages/:id/cancel`: authorise ownership, publish on
      `ai:cancel:{id}`, and answer success even when the reply already finished. Verify e2e
      cases for in-progress, already-complete, and another user's message (denied).
- [x] 7.6 Enforce ownership in the service for every route — a conversation belonging to another
      user is not readable even by ADMIN. Verify e2e cases for a same-tenant ADMIN and for a
      cross-tenant identifier, asserting neither reveals content or existence.
- [x] 7.7 Gate every route on `AI_ENABLED` with `AI_DISABLED`, and surface the flag as
      `features.ai` in `GET /settings/bootstrap` (the `features` map already exists and is
      empty). Verify e2e that all `/ai/*` routes refuse while disabled and that bootstrap
      reports the flag in both states.
- [x] 7.8 Add the `ai-ask` named rate limit to `RATE_LIMITS` with `AI_ASK_LIMIT_PER_MINUTE`
      (default 10) in `throttle.config.ts`, and apply it to the ask route only. Verify by
      extending `apps/api/test/rate-limit.e2e-spec.ts` with a case asserting `429` plus
      `Retry-After` past the limit.
- [x] 7.9 Run `pnpm openapi:generate && pnpm web:codegen` and commit both artifacts together.
      Verify the generated hooks for the four routes exist and `pnpm build` passes.

## 8. Web: the AI panel

- [x] 8.1 Add `react-markdown` + `remark-gfm` to `apps/web`, and a `Markdown` component that
      renders without `rehype-raw` and without `dangerouslySetInnerHTML`, constraining link
      protocols to http/https with `rel="noopener noreferrer"`. Verify with a Vitest case that
      a raw `<script>` and an `onerror` attribute in the source render as literal text.
- [x] 8.2 Add `apps/web/src/stores/ai-panel.store.ts` (Zustand): open state and width persisted
      to `localStorage`, mirroring `notification-ui.store.ts`. Verify the panel's open state
      survives a reload.
- [x] 8.3 Build `AiPanel` in `apps/web/src/components/ai/`: full-height column with an `h-14`
      header matching the shell's other four, the AI disclosure line, transcript, composer, a
      Stop control while generating, and a "new conversation" action. Scrolling goes through
      `libs/ui`'s `ScrollArea`, never bare `overflow-y-auto` (`CLAUDE.md` pitfall 12). Verify
      visually in `pnpm web:dev` against the shell's four-column line.
- [x] 8.4 Mount `AiPanel` in `app-shell.tsx` as the outermost sibling of `ContextPanelSlot`, add
      its header toggle beside `ContextPanelTrigger`, and mount a `ResizeHandle` on its leading
      edge bound to a new `--ai-panel-width` variable. Verify content reflows (never dims), both
      panels can be open together, and the panel survives navigation between areas.
- [x] 8.5 Wire the transcript through TanStack Query and patch the cache from
      `ai.message-delta.v1`; invalidate the query on a `chunkSeq` gap, on `chunkSeq: 0` for a
      reply already holding text, and on socket reconnect. Verify by dropping deltas in the
      handler and confirming the rendered answer still converges to the stored one.
- [x] 8.6 Handle `ai.message-completed.v1` for the terminal states, rendering `FAILED` with a
      Retry affordance and `CANCELLED` as stopped-by-user rather than an error. Verify against
      the `__fail__` and `__long__` directives from the running dev stack.
- [x] 8.7 Gate the header button and the panel on `features.ai` from the bootstrap slice. Verify
      that with `AI_ENABLED` unset no control appears anywhere in the header.
- [x] 8.8 Add the i18n keys for the panel, the disclosure, the empty state, the new error codes
      and the composer hint. Verify no raw key renders anywhere in the panel.

## 9. Tests and verification

- [x] 9.1 Add `apps/api/test/ai.e2e-spec.ts` covering the scenarios in
      `specs/ai-assistant/conversation/spec.md`: first-time conversation, busy rejection,
      input-length and empty-input validation, reset semantics, ownership denial (ADMIN and
      cross-tenant), disabled-installation refusal, and the rate limit. Verify the suite passes
      under `pnpm api:test:e2e` (needs Postgres **and** Valkey, and must not run alongside a
      live dev stack).
- [x] 9.2 Add the worker-side lifecycle test driving the subscriber directly against
      `FakeLlmProvider`: happy path, `__fail__`, `__stall__` timeout, cancel, retry-resets-content,
      and completed-reply-is-not-regenerated. Verify every scenario in
      `specs/ai-assistant/generation-pipeline/spec.md` maps to a case here or in 9.1.
- [x] 9.3 Manually verify the concurrency and fairness requirements on a workspace slot: two
      users in different tenants generating at the same time both progress, and one tenant with
      more than two queued questions does not delay another tenant's question.
- [x] 9.4 Manually verify the panel scenarios in `specs/ai-assistant/panel/spec.md`: open with
      the Context Panel, navigate between areas, reload, toggle, disclosure always visible,
      untrusted markup rendered inert.
- [x] 9.5 Run `pnpm lint && pnpm typecheck && pnpm build` plus `pnpm api:test:e2e` and
      `pnpm web:test` at the repo root and confirm all are green.

## 10. Documentation and configuration

- [x] 10.1 Add every `AI_*` variable to `.env.example` and `.env.production.example` with
      `AI_ENABLED=false` and `AI_PROVIDER=fake`, each with a one-line comment. Verify a clean
      clone plus `pnpm docker:up` starts with no AI configuration and no error.
- [x] 10.2 Add the AI env block to `docker/docker-compose.stack.yml` for `api` and `worker`
      (via the existing env anchors) and to `docker/deploy.env`. Verify a stack deploy starts
      both services with the flag off.
- [x] 10.3 Write `docs/ai-assistant.md`'s AI-0 section (or its successor doc) describing what
      shipped: data model, protocol, lifecycle, the provider seam, and the `FakeLlmProvider`
      directives. Cross-link `docs/ai-assistant-plan.md` for the phase plan.
- [x] 10.4 Update `CLAUDE.md` (architecture map gains the `ai` module in `apps/api` and the
      subscriber in `apps/worker`; the documentation map gains the AI docs), `docs/roadmap.md`
      (AI-0 done, AI-1…AI-4 next), and `docs/realtime.md` (the two new events, alongside the
      existing "what we added on top" sections). Verify each edit names the real files.
      Also record in `docs/workspace-slots.md` the trap hit during task 2.2: the Prisma CLI run
      from `libs/database` ignores the repo-root `.env.local` and defaults to slot 0, so a
      migration created in a worktree lands on another checkout's database unless
      `MIGRATE_DATABASE_URL` is passed explicitly.
- [x] 10.5 Reconcile `docs/ai-assistant-plan.md` §9.1 (which already records that AI-1…AI-4
      stay open to revision, and the seams that make that safe) with what AI-0 actually built:
      correct any row whose attachment point moved during implementation. Verify each seam in
      that table names a real file or symbol in the merged code.
