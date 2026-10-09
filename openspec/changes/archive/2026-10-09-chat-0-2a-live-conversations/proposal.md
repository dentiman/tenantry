# Proposal

## Why

CHAT-0.1 shipped a complete Chat screen served over REST only: a colleague's reply shows up
when the window regains focus or the user presses "Refresh". `docs/chat.md` §7.3 names the next
phase **CHAT-0.2 — live chat**. All the infrastructure it needs already runs in production:
the Socket.IO/Valkey gateway, `RealtimeEmitter.toUsers()`, `TenantTransactions.onCommit()` and
the after-commit pattern that calendar and the AI assistant use. CHAT-0.1 also left its seams
open on purpose (`ChatService.insert()`, the "шви під CHAT-0.2" comment), along with a
server-side `seq` that was designed to detect gaps.

CHAT-0.2 is cut in two (decision of 2026-10-09). This change, **0.2a**, covers the
server → client direction only. That is enough to make the screen fully live, because every
viewer of a conversation is a participant, and participants are already reachable through
their personal room. **0.2b** follows separately. It adds what needs a new client → server
protocol: lazy conversation rooms with server-side authorization, typing, read over the socket,
notifications (suppressed for whoever is viewing) and the presence dot. Doing 0.2a first means
those features land on a live screen. Without it they would have to be tested against reload
semantics.

## What Changes

- **Emission after commit** from every place that writes the chat feed or a participant's
  read state. Each place registers `onCommit` in its own transaction, in the seam CHAT-0.1
  reserved:
  - `ChatService.insert()` → `chat.message-created.v1`;
  - `ChatService.create()` → `chat.conversation-changed.v1` (`created`);
  - `ChatService.markRead()` → `chat.conversation-changed.v1` (`read`, sent to the reader's own
    tabs only);
  - the default-channel join hook (`DefaultChannelService`) → `chat.conversation-changed.v1`
    (`membership`).
- **Recipients are the active participants**, read inside the same transaction that wrote the
  row (after the `last_seq` row lock). Delivery goes through their personal rooms, so the
  socket never reaches anyone the REST access function would refuse.
- **`chat.message-created.v1` carries the full stored message** plus `conversationId`, with
  `seq` as the ordering and gap key. The precedent is `notification.created.v1`: the server
  already holds the row, and Postgres remains the source of truth because any gap or missed
  event falls back to REST.
- **New socket contracts** in `libs/contracts/src/chat/chat.socket-events.ts`, assembled by the
  root `socket-events.ts` (`docs/modules.md` §7.2). No new client → server events.
- **Web: `features/chat/realtime/chat-sync.ts`**, modelled on `notification-sync.ts` and
  `calendar-sync.ts`:
  - the open transcript is patched by the `seq` rule: next → apply, duplicate/older → ignore,
    gap → re-read;
  - the conversation list is re-read, because unread counts are per reader and ordering is
    server-side;
  - the echo of the user's own message settles the matching optimistic entry by
    `clientMessageId`, so nothing duplicates;
  - on reconnect without session recovery, all chat queries are invalidated.
- **The send path uses the same merge function** as the socket. A message is confirmed into
  the cache from the POST response even when the socket is down.
- **Removed:** the header "Refresh" button and the shortened `CHAT_STALE_TIME` in the Chat area.
  Both existed only because 0.1 had no live channel. `refetchOnWindowFocus` stays as a safety
  net, not as the mechanism.
- **`modules.config.ts`:** `chat` gains `realtime` in `dependsOn`, and `ChatModule` imports
  `RealtimeModule`, the same direction calendar and ai already use.
- **Doc corrections:**
  - AGENTS.md rule 15 currently calls the AI delta *the one* payload-carrying socket event,
    which `notification.created.v1` already contradicts. It is reworded as a rule: a payload
    is allowed only with a monotonic counter and a REST resync.
  - `docs/chat.md` §4.8 and §7.5 are updated to the event names used in code (hyphenated, as
    in `calendar.event-changed.v1`) and to the 0.2a/0.2b split.

## Capabilities

### New Capabilities
- `chat/live-updates`: who is told about a change to a conversation, when (only after it is
  stored), what the message carries, and how a client that missed events gets back to a
  correct state.

### Modified Capabilities
- `chat/area`: the requirement "The transcript refreshes on demand, not continuously" is
  replaced. The Chat area now shows other participants' messages, new conversations and
  read-state changes from the user's other tabs without a reload, focus change or refresh
  action. It still never polls on a timer.

## Impact

- **API (`apps/api/src/chat/`):**
  - `chat.service.ts`: emission in `insert`, `create` and `markRead`, and recipients read in
    the transaction;
  - `default-channel.service.ts`: emission after the join hook;
  - `chat.module.ts`: imports `RealtimeModule`.
  - No REST contract changes, so no `openapi:generate` or orval regeneration is needed.
- **Contracts:** new `libs/contracts/src/chat/chat.socket-events.ts`; the root
  `socket-events.ts` gains one spread.
- **Web (`apps/web/src/features/chat/`):** new `realtime/chat-sync.ts` and its Vitest test,
  registration in `main.tsx`, `use-chat.ts` (shared merge, no stale-time override),
  `chat-conversation.tsx` (Refresh button removed).
- **Tests:** a new `apps/api/test/chat-realtime.e2e-spec.ts` on the `ai-realtime.e2e-spec.ts`
  pattern, plus unit tests for the merge and gap rule.
- **Module graph:** `chat → realtime` edge (`pnpm modules:check --strict`).
- **Not touched:**
  - the database schema;
  - messaging/pg-boss: no `chat.message-posted.v1` publish yet, since that event has no
    subscriber and lands with the first consumer;
  - notifications, gateway handlers, worker.
- **Scale note**: one emission per participant per message, so the bound from
  `docs/chat.md` §4.4 applies. A channel with hundreds of members would move to a per-channel
  room. CHAT-0.1 does not reach that bound, and neither does this change.
