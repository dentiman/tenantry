# Design

## Context

What exists and constrains this change. Everything below is observed in the code, not proposed.

- **Socket transport.** `apps/api/src/realtime/` puts every authenticated socket in
  `tenant:{t}`, `tenant:{t}:user:{u}` and a session room on connect. The gateway accepts one
  client → server event (`authUpdate`). Features emit through the generic
  `RealtimeEmitter.toUsers(tenantId, userIds, event, payload)`: calendar and ai do so from their
  own services, and the emitter has no feature methods (`docs/modules.md` §7.2).
- **Event contracts.** Server → client events are declared with `defineSocketEvent` in the
  owning module's contracts (`calendar.socket-events.ts`, `ai.socket-events.ts`) and assembled
  in `libs/contracts/src/socket-events.ts`. The naming is `<module>.<thing>-<verb>.v1`.
- **After-commit.** `TenantTransactions.onCommit(tx, hook)` throws if the transaction did not
  come from `withTenantTx`. Calendar's `emitChanged()` is the reference: recipients are
  computed in the transaction, emission happens after commit.
- **Chat writes.** `ChatService` has four write paths:
  - `insert()`: increment `last_seq` → insert → unread `+1` → the reserved seam;
  - `create()`: conversation, participants and system entries `1..n` in one transaction;
  - `markRead()`: a conditional `updateMany` (`lastReadSeq < seq`) that returns a count;
  - the default-channel join (`joinDefaultChannel` in `libs/shared/src/chat/`), run from the
    users lifecycle hook inside the user-creating transaction. It increments `last_seq` and
    writes a `member.added` entry. Today it returns `void`.
- **Web.** The transcript is a TanStack `useInfiniteQuery`:
  - key `getChatTranscriptQueryKey(id, { limit: 30 })`;
  - pages newest-first, items `seq DESC`, keyset cursor = the last item's `seq`;
  - optimistic entries live outside the cache in `useChatOutboxStore`, rendered after the
    newest server item and removed by `resolve()`;
  - `ChatTranscript` calls `markRead(newestSeq)` whenever the newest `seq` grows.

  The list is an infinite query too, with per-reader `unreadCount`. Each existing `*-sync.ts`
  registers in `main.tsx` and resyncs on `connect` when `!socket.recovered`.
- **Module graph.** `modules.config.ts` declares `chat.dependsOn` without `realtime`, so the
  import would fail `modules:check --strict` today.

## Goals / Non-Goals

**Goals:**
- Each committed change to a conversation reaches every active participant's open tabs within
  the latency of one socket hop. A rollback reaches no one.
- One merge rule for a stored message. The socket echo, the POST response and a re-read
  converge on one entry per `seq`, and the outbox entry disappears in the same render.
- No new client → server protocol, no schema change, no REST contract change.

**Non-Goals (0.2b and later):**
- conversation rooms and `chat.subscribe`;
- typing;
- read over the socket;
- `chat.message_received` notifications and the "currently viewing" suppression;
- the presence dot;
- `publish(tx, chat.message-posted.v1)`, deferred until it has a subscriber. A topology entry
  with no consumer is dead configuration;
- a REST "messages after seq" endpoint.

## Decisions

### D1. Recipients are read inside the writing transaction, after the `last_seq` lock

`insert()` and the join hook already take the conversation row lock through the `last_seq`
increment. Membership changes go through the same row in this phase (join increments
`last_seq`), so a participants read after the lock sees exactly the membership that the stored
message belongs to. This is the same set `ConversationAccessService` admits: active,
`left_at IS NULL`.

- **Alternative: read recipients before the transaction.** Rejected. It recreates the
  read-before-tx debt AGENTS.md names for `CalendarService`. A member added concurrently would
  miss the first message, and a member removed concurrently would receive it.
- **Alternative: broadcast to the tenant room and filter on the client.** Rejected. It leaks
  the existence and content of private conversations, as calendar already notes.

The recipient query lives in `libs/shared/src/chat/` (`activeParticipantIds(tx,
conversationId)`). It sits next to the provisioner so the worker can reuse it in CHAT-2 for
delivery-status updates; the emitter itself stays per process.

### D2. Two server → client events, declared in `libs/contracts/src/chat/chat.socket-events.ts`

**`chat.message-created.v1`** — `{ conversationId, message: ChatMessageResponse, occurredAt }`.
- **Recipients:** all active participants, the author included (other tabs).
- **Payload:** the same mapper output REST returns (`toChatMessageResponse`), so the two can
  never diverge.
- **Sent for** replies from `insert()` and for the `member.added` entry written by the join hook.

**`chat.conversation-changed.v1`** — `{ conversationId, change: 'created' | 'membership' | 'read', occurredAt }`.
- **Payload:** a re-read signal. It carries no unread counts or previews, which are per reader
  and server-ordered.
- **Recipients by change:**
  - `created`: all members, from `create()`;
  - `membership`: all active participants, from the join hook;
  - `read`: the reader only, from `markRead()`, and only when `updateMany` actually moved the
    cursor (`count > 0`). This keeps a stale or duplicate read silent, and two tabs reading the
    same message cannot ping-pong.

`create()` does not emit `message-created` for its system entries `1..n`: nobody holds the
transcript yet, so `created` is enough.

**Naming:** hyphenated, following the code (`calendar.event-changed.v1`), not the dotted names
in `docs/chat.md` §4.8. The doc is corrected in this change.

**Why a full row:** the server holds the row, and `seq` gives the client a complete
apply/ignore/resync rule, the same one `revision` gives the notifications inbox. AGENTS.md rule
15 is reworded to state the actual principle: a socket event may carry state only with a
monotonic counter and a REST fallback. Today's examples are the AI delta, `notification.created`
and `chat.message-created`.

### D3. One emitter helper inside the chat module: `ChatRealtime`

A small `@Injectable()` in `apps/api/src/chat/chat-realtime.ts` with two methods:
`messageCreated(tx, conversationId, message)` and `conversationChanged(tx, conversationId,
change, recipientIds?)`. Each one:
- reads the tenant from `TenantContextService`, as calendar does;
- resolves recipients through D1 unless they are given;
- registers `onCommit(tx, …)` → `RealtimeEmitter.toUsers(…)`.

`ChatService` and `DefaultChannelService` both call it. That keeps "what chat tells whom" in one
file without adding feature methods to `RealtimeEmitter`.

The comment at the 0.1 seam is replaced by the call. The `publish(...)` half of the comment
stays as a pointer to the deferred event (Non-Goals).

`joinDefaultChannel` changes from `void` to returning `{ conversationId, message } | null`
(`null` when the user was already a member). The hook needs the stored entry to emit
`message-created`. Its other callers (platform-api tenant hook, seed) ignore the result.

### D4. Client merge: one pure function, applied by both the socket and the POST response

`mergeIncomingMessage(queryClient, conversationId, message)` in
`features/chat/realtime/chat-cache.ts` (pure helpers, unit-tested). For the transcript cache of
that conversation:

| State | Action |
| --- | --- |
| no cached transcript | nothing; the next open reads REST |
| `message.seq <= newest` cached `seq` | ignore (duplicate / already re-read) |
| `message.seq === newest + 1` | prepend to `pages[0].items` |
| `message.seq > newest + 1` | `invalidateQueries` on the transcript |

Prepending to page 0 keeps every page's `nextCursor` valid, because the cursor is the oldest
`seq` of that page and does not move.

In the same call, if `message.clientMessageId` is in the outbox for that conversation, the
helper calls `resolve()`. React batches both updates into one render, so the optimistic entry
and the confirmed one never coexist. The exception is the gap/no-cache branch: the message is
not in the cache yet, so the outbox entry is resolved only after the re-read has settled, or the
reply would vanish from the screen in between.

As a backstop, `buildRows()` also drops outbox entries whose `clientMessageId` is already
among cached messages. That covers a re-read landing before `resolve`.

`useSendMessage.onSuccess` calls the same helper with the POST response, instead of
invalidating the transcript. That makes a send confirm correctly with the socket down: if
others posted meanwhile and the socket missed it, the gap rule triggers a re-read.

- **Alternative: invalidate the transcript on every event.** Rejected. It refetches 30 rows per
  message per viewer, and it flickers the scroller anchor that `message-scroller` keeps at the
  bottom.

### D5. The conversation list is re-read, not patched

On `message-created` and on any `conversation-changed`, `chat-sync.ts` invalidates
`getChatFindAllQueryKey()`. On `membership`/`created` it also invalidates the conversation's
`findOne` (participants). Its transcript is not re-read: the `member.added` entry arrives as its
own `message-created`, which the `seq` rule already handles.

The list carries per-reader `unreadCount` and server-side ordering across pages. Patching it
would mean guessing, which is the same argument `notification-sync.ts` makes for its list.

**Cost:** roughly two list GETs per incoming message per online participant, one for the
message and one for the reader's own `read` echo. TanStack deduplicates concurrent ones. This
fits the scale bound in `docs/chat.md` §4.4 and is revisited together with that bound.

### D6. Freshness controls from 0.1 are removed, the safety net stays

- The header Refresh button and `useRefreshChat` are removed.
- `CHAT_STALE_TIME` is removed, so the queries fall back to the global stale time.
- `refetchOnWindowFocus` (global default) stays.
- On `connect` with `!socket.recovered`, the client invalidates every chat query
  (`getChatFindAllQueryKey()`, and transcript/findOne by prefix).
- There is still no `refetchInterval`.

### D7. Module edge

`modules.config.ts`: `chat.dependsOn` gains `'realtime'`, and `ChatModule` imports
`RealtimeModule`. This is the same downward edge calendar, ai and notifications already have.
The platform-api `chat` provisioning path does not emit: no tenant socket exists before the
tenant does.

## Risks / Trade-offs

- **Event lost between commit and emit** (process dies in `onCommit`). Accepted, because the
  socket is a lossy accelerator by doctrine. The next message's gap rule, a reconnect or a focus
  change converges the client.
- **List refetch amplification in a large default channel.** Every message in General makes
  every online member refetch their list. This is acceptable at skeleton scale. The bound and
  the remedy (a per-channel room, computed unread) are already named in `docs/chat.md` §4.4.
  Revisit if General exceeds a few dozen online members.
- **Prepended page 0 grows beyond `limit`.** This is harmless for keyset paging, and a refetch
  normalizes it.
- **`clientMessageId` visible to all participants.** It already is through REST
  (`toChatMessageResponse`). It is a random uuid and identifies nothing.
- **Changing `joinDefaultChannel`'s return type** touches a function shared with platform-api
  and seed. The change is additive for callers that ignore the value, and typecheck covers them.

## Documentation to promote

Per the archive rule, durable content moves to `docs/` in this change's final tasks, not after
archiving:
- `docs/chat.md`:
  - §4.8: event names and payloads as built, and the 0.2a/0.2b split;
  - §7.3 and §7.5: the phase split;
  - D1 (recipients inside the transaction);
  - D4 (merge table);
  - D5 (list re-read and its cost).
- `docs/realtime.md`: a pointer that chat is the third state-carrying event, with the rule.
- AGENTS.md rule 15: the reworded principle.
- `docs/roadmap.md`: CHAT-0.2a row.
