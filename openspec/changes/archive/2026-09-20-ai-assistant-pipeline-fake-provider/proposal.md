# Proposal

## Why

`docs/ai-assistant-plan.md` fixes the design of the AI assistant (a persistent sidebar LLM
chat in the tenant portal) and splits delivery into phases AI-0…AI-4. This change is
**AI-0**: build the whole pipeline — shell surface → REST → queue → worker → streaming over
the existing Socket.IO/Valkey bridge → persisted transcript — against a **`FakeLlmProvider`
only**. No real provider, no API key, no outbound network call.

The order is deliberate and mirrors the repo's own `PaymentProvider` → fake → Stripe pattern
(roadmap §2.4) and `CHAT-2`'s fake channel adapter: the risky, hard-to-test parts of this
feature are not the model — they are queue concurrency, transaction boundaries around a long
call, chunk ordering, cancellation, and RLS. All of them become end-to-end testable in CI,
deterministically and at zero cost, before the first invoice from any vendor exists.

It also de-risks three findings from the plan that touch shared infrastructure and are much
cheaper to land with their first consumer than retrofitted later: `boss.work()` is registered
with no options today (`localConcurrency: 1` would serialise every generation in the whole
installation), `withTenantTx` must not be held open across a long call, and a socket event
now carries payload rather than a "re-read" signal.

## What Changes

- **New shell surface.** A persistent, non-modal `AiPanel` as the fifth column of the tenant
  app shell, to the right of the Context Panel: route-independent (survives area navigation),
  squeezes content rather than overlaying it, can be open at the same time as the Context
  Panel, toggled from its own header button, resizable via the existing `ResizeHandle`. It
  carries a visible "this is an AI assistant, it can be wrong" disclosure in its header
  (EU AI Act Art. 50, in force since 2026-08-02). Unrelated to the existing `Chat` area.
- **New conversation model.** `AiConversation` + `AiMessage` under RLS, tenant-scoped and
  **owner-scoped**: exactly one `ACTIVE` conversation per user, no history screen. "New
  conversation" retires the current one (it stays in the database) and starts an empty one.
  Even an ADMIN cannot read another user's conversation.
- **New REST surface** in `apps/api/src/ai/`, with no subject id in any path (the `/account`
  doctrine — the subject is always the JWT): `GET /ai/conversation`,
  `POST /ai/conversation/messages`, `POST /ai/conversation/reset`,
  `POST /ai/conversation/messages/:id/cancel`.
- **New async command** `ai.generate-reply` (`defineCommand`, tenant scope) plus its row in
  `MESSAGE_TOPOLOGY` and a subscriber in `apps/worker`. The HTTP request publishes inside the
  same transaction that writes the user's message and returns `202`; it never calls a model.
- **`LlmProvider` interface + `FakeLlmProvider`.** The interface is the seam the later
  `OpenAiCompatProvider` (AI-1) plugs into unchanged; AI-0 ships only the fake, which streams
  canned Markdown with configurable pacing and can be told to fail or stall on demand so the
  error and timeout paths are testable.
- **Streaming protocol over the existing realtime bridge.** Two new events,
  `ai.message-delta.v1` (carrying `chunkSeq`) and `ai.message-completed.v1`, emitted to
  `userRoom(tenantId, userId)` from the worker's existing headless emitter. Chunks are
  coalesced (~120 ms), never token-per-token. A gap in `chunkSeq` or a reconnect sends the
  client back to `GET /ai/conversation`, so a lost delta slows the render but loses nothing.
- **Cancellation** via a Valkey pub/sub channel → `AbortController` in the worker. Partial
  output is kept with status `CANCELLED`.
- **MODIFIED shared messaging:** `ConsumerSpec` in `MESSAGE_TOPOLOGY` gains worker options
  (`localConcurrency`, `groupConcurrency`, `pollingIntervalSeconds`, `expireInSeconds`) and
  `MessagePublisher` gains a `group` send option. Existing consumers keep today's behaviour
  by omitting the new fields — **not breaking**.
- **Installation switch.** `AI_ENABLED` (default `false`): off, the panel and its button are
  not rendered and the endpoints answer `403`. A skeleton without a provider must
  not ship a half-working assistant.
- **Rate limit.** A named `ai-ask` limit on the ask endpoint via the existing throttler, so a
  loop cannot flood the queue even with a free fake provider.

Out of scope for AI-0, fixed in `docs/ai-assistant-plan.md` §9 as later phases and **subject
to revision when they are picked up**: the real provider and `docs/ai-knowledge/` (AI-1),
token quotas and usage counters (AI-1), retention cron (AI-1), level-2 knowledge and the
`/settings/ai` screens (AI-2), usage dashboards and answer feedback (AI-3), retrieval (AI-4).
None of them changes anything AI-0 builds: they add a provider behind an existing interface,
rows to the prompt builder, and counters around an existing transaction.

## Capabilities

### New Capabilities
- `ai-assistant/panel`: the persistent, non-modal AI sidebar surface in the tenant app
  shell — how it opens, what it survives, how it coexists with the Context Panel, and the
  AI disclosure it must carry.
- `ai-assistant/conversation`: the single-active-conversation model and its REST surface —
  ownership, reset, transcript read, input limits, and the feature switch.
- `ai-assistant/generation-pipeline`: asynchronous reply generation — queued command, the
  provider seam, streamed chunks with ordering and recovery, cancellation, failure, and
  per-tenant fairness.

### Modified Capabilities
<!-- `openspec list --specs` reports only `app-shell/resizable-panels`, whose requirements
     are unchanged by this work (the AI panel consumes the existing ResizeHandle rather than
     altering its behaviour). Nothing to list. -->

## Impact

- **Database** (`libs/database`): new `AiConversation` / `AiMessage` models + migration;
  raw-SQL RLS policies per the MT-2 pattern; a **partial unique index** for "one ACTIVE
  conversation per user", which Prisma cannot express declaratively.
- **Contracts** (`libs/contracts/src/ai/`): request/response schemas, the two realtime event
  schemas in `libs/contracts/src/realtime/`, and an `AiMessageErrorCode` domain enum for a
  failed reply. **No new `ApiError` codes** — see `design.md`. Regenerate and commit
  `openapi.json` and the orval artifacts together.
- **Shared** (`libs/shared`): `messaging/definitions/ai.messages.ts`;
  `ConsumerSpec`/`MESSAGE_TOPOLOGY`/`PgBossService`/`MessageWorkerRegistrar`/`MessagePublisher`
  for worker options and `group`; new `ai/llm/` (interface + fake) and `ai/prompt/` (a minimal
  builder that AI-1 extends with knowledge).
- **API** (`apps/api/src/ai/`): module, controller, service, mapper, DTOs; a new named rate
  limit in `libs/shared/src/auth/throttler/`.
- **Worker** (`apps/worker/src/subscribers/ai-generate-reply.subscriber.ts`): the generation
  lifecycle, chunk coalescing, partial persistence, cancel subscription; emission reuses the
  existing `WorkerRealtimeEmitter`.
- **Web** (`apps/web`): `AiPanel` mounted in `app-shell.tsx` beside `ContextPanelSlot`, header
  toggle, Zustand UI store, socket handlers, i18n keys. **New dependency**: `react-markdown`
  + `remark-gfm`, rendered without `rehype-raw` and without `dangerouslySetInnerHTML` — an
  LLM answer is untrusted input.
- **Docs**: `docs/ai-assistant.md` (or a successor) records what AI-0 shipped; `docs/roadmap.md`
  gains the AI line; `CLAUDE.md`'s architecture map gains the `ai` module.
- **Tests**: `pnpm api:test:e2e` covers the REST surface and the publish; a worker-level test
  drives `FakeLlmProvider` through the full lifecycle including cancel and failure.
