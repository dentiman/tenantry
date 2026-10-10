# Design

## Context

Observed in the code after CHAT-0.2a:

- **Gateway.** `RealtimeGateway` (`apps/api/src/realtime/realtime.gateway.ts`) joins every socket to
  `tenant:{t}`, `tenant:{t}:user:{u}` and a session room in `handleConnection`; the only inbound
  event is `auth.update.v1`, a static `@SubscribeMessage` with a hand-written Zod check and ack.
  Nest binds `@SubscribeMessage` handlers when the gateway initialises, so a handler registered
  later by another module's `onModuleInit` would never be seen. The gateway also installs the
  namespace auth middleware in `afterInit`; a second `@WebSocketGateway` on the same namespace
  would install it twice.
- **Module direction.** `realtime` is a platform-tier module and must not import `chat`.
  `chat → realtime` already exists (`modules.config.ts`, 0.2a).
- **Contracts.** Server → client events are `defineSocketEvent` objects assembled in
  `libs/contracts/src/socket-events.ts`, which also exports `ServerToClientEvents`. Client →
  server is a hand-written interface `ClientToServerEvents` in `realtime/realtime.types.ts`
  holding `auth.update.v1` only. Room names (`tenantRoom`, `userRoom`, `sessionRoom`) live in
  contracts because two processes form them.
- **Identity inside a handler.** `socket.data` holds `{ userId, tenantId, role, sid, expiresAtMs }`
  from the verified token. There is no HTTP request, so no CLS tenant context: services built on
  the tenant Prisma client need `TenantContextService.runWith(tenantId, fn)` (what the worker
  does).
- **Chat services.** `ConversationAccessService.assertParticipant(conversationId, userId)` throws
  `NotFoundException` for every non-access case. `ChatService.markRead(actor, …)` uses only
  `actor.sub`; its only caller is the controller.
- **Web.** `getSocket()` is typed `Socket<ServerToClientEvents, ClientToServerEvents>`.
  `ChatTranscript` calls `markRead(newestSeq)` in an effect whenever the newest cached `seq`
  grows, with no regard to visibility. The vendored `message-scroller` exports
  `useMessageScroller`, `useMessageScrollerScrollable` and `useMessageScrollerVisibility`.
  `ChatComposer` holds its value in local state and has no typing hook.

## Goals / Non-Goals

**Goals:**
- Chat can accept client → server events through the realtime layer without `realtime` knowing
  chat, and without each feature re-implementing validation, ack shape, rate limiting and tenant
  context.
- "This connection is viewing conversation X" is a fact the server holds, established only after
  the same access check REST uses.
- Typing is visible to viewers, costs no database access and leaves no trace.
- "Read" follows looking, not delivery.

**Non-Goals:**
- `chat.message_received` notifications, viewer suppression and the presence dot — CHAT-0.2c.
- Leaving rooms when a participant is removed — CHAT-0.3 (see D2).
- Moving `auth.update.v1` onto the registry. It mutates `socket.data` and owns timers; it is a
  protocol core, not a feature event.
- Changing how messages are delivered (still personal rooms, D3).
- A `publish(tx, chat.message-posted.v1)` — still no subscriber.

## Decisions

### D1. A registry for inbound events in `realtime`, attached per connection

**Contract mechanism** (`libs/contracts/src/realtime/client-socket-event.ts`):
`defineClientSocketEvent(name, payloadSchema, ackDataSchema)` and `ClientEventsOf<T>`, the inbound
twin of `defineSocketEvent`/`ServerEventsOf`. The root `socket-events.ts` gains
`CLIENT_SOCKET_EVENTS` (spreading each module's definitions) and exports
`ClientToServerEvents = PlatformClientToServerEvents & ClientEventsOf<typeof CLIENT_SOCKET_EVENTS>`,
mirroring how it already exports `ServerToClientEvents`. The existing interface is renamed
`PlatformClientToServerEvents` and keeps only `auth.update.v1`.

**Ack envelope** (one shape for every registered event):
`{ ok: true, data } | { ok: false, code }`, with a closed `code` set:
`INVALID_PAYLOAD | NOT_FOUND | FORBIDDEN | RATE_LIMITED | LIMIT_EXCEEDED | INTERNAL`. The same
principle as `ApiError`: a machine code outward, an English diagnostic only in the log.

**Server** (`apps/api/src/realtime/client-event.registry.ts`, exported by `RealtimeModule`):
`register(definition, handler, options?)` is called from a feature's `onModuleInit`; registering
the same name twice throws at boot. `RealtimeGateway.handleConnection` calls
`registry.attach(socket)`, which does `socket.on(name, …)` for every registered definition **per
connection**. That is why it is not `@SubscribeMessage`: registration order across modules is not
known when the gateway initialises, and per-connection attachment needs no ordering.

The pipeline for each event, in this order: rate limit → parse the payload with the definition's Zod
schema → `TenantContextService.runWith(socket.data.tenantId, handler)` → ack. The limit comes first
because it is the cheap check: a flood of garbage payloads must not be free. The handler gets
`{ socket, userId, tenantId, role, payload }`: a verified identity and a parsed payload, never
the raw event. A handler throws `SocketEventError(code)` for a domain refusal. The registry also
maps Nest `NotFoundException → NOT_FOUND`, `ForbiddenException → FORBIDDEN`,
`BadRequestException → INVALID_PAYLOAD`, because the chat services are HTTP-shaped; anything else
is logged and acknowledged as `INTERNAL`. If the client passed no ack callback the result is
discarded silently (typing is fire-and-forget).

**Rate limit:** a fixed window per (socket, event), default 20 per 10 s, overridable per
registration. State lives in a `WeakMap` keyed by the socket. A websocket stays on one replica for
its life, so per-socket accounting in process memory is exact and needs no Valkey.

- **Alternative: a `ChatGateway` on the same namespace.** Rejected. It would duplicate validation,
  ack and rate limiting per feature, and a second gateway on the namespace installs the auth
  middleware again.
- **Alternative: let the gateway import the chat access function.** Rejected; it breaks the tier
  rule (`docs/modules.md` §1, §4) and is exactly what the registry exists to avoid.

### D2. Conversation rooms: server-authorized, small, lazy

`conversationRoom(tenantId, conversationId)` lives in `libs/contracts/src/chat/chat.rooms.ts`
(the worker needs the same name in 0.2c to ask who is viewing).

`chat.subscribe.v1 { conversationId }` → `ConversationAccessService.assertParticipant(id, userId)`
(under the tenant context from D1, so RLS applies and another tenant's id is a plain 404) →
`socket.join(room)` → ack `{ conversationId }`. Refusals are `NOT_FOUND` for every non-access
case, never `FORBIDDEN`, matching the REST answer. A socket may hold at most
`CHAT_MAX_VIEWED_CONVERSATIONS = 5` conversation rooms, counted from `socket.rooms` by prefix;
re-joining a room it already holds does not count. The sixth is `LIMIT_EXCEEDED`. A normal client
holds one; the cap is an abuse bound, not a feature.

`chat.unsubscribe.v1 { conversationId }` → `socket.leave(room)`, always `ok`. No access check:
leaving needs no authority and discloses nothing.

A new socket (not a recovered one) starts with no conversation rooms, so the client re-subscribes
on every `connect` (D7); joining is idempotent.

**Known gap, owned by CHAT-0.3:** a participant removed from a conversation while subscribed would
keep their room until they disconnect. Nothing removes participants today. When 0.3 introduces
removal it must make the member leave the room; the generic primitive is
`namespace.in(userRoom).socketsLeave(conversationRoom)` (adapter-aware), which belongs on
`RealtimeEmitter` as `removeUserFromRoom(tenantId, userId, room)`. Recorded here so the phase
cannot add removal without it.

### D3. Message delivery does not change

`chat.message-created.v1` and `chat.conversation-changed.v1` keep going to personal rooms. The
conversation room carries typing and answers "who is viewing" (0.2c) and nothing else. A missed
or refused subscription therefore costs a typing indicator, never a message — the property that
let 0.2a be correct with no subscription at all.

### D4. Typing: relative expiry, no storage, relay only

Client → server `chat.typing.v1 { conversationId }`; server → client
`chat.typing-changed.v1 { conversationId, userId, expiresInMs }`. The handler:
1. requires `socket.rooms.has(conversationRoom(…))`, else `FORBIDDEN` — authorization was done
   once, at subscribe, so typing needs no database access;
2. `socket.to(room).emit(typingChanged, { …, expiresInMs: CHAT_TYPING_TTL_MS })`.

**`expiresInMs`, not an absolute `until`** (a correction of `docs/chat.md` §4.8.2): the client
turns it into a local deadline on receipt, so a client clock that is minutes off cannot make the
indicator vanish instantly or hang for ever. `CHAT_TYPING_TTL_MS = 6_000`, the client pulses every
`CHAT_TYPING_PULSE_MS = 3_000`, so continuous typing never flickers. Server limit for the event:
5 per 10 s.

`socket.to(room)` excludes only the sending socket, so the same user's *other* tabs in the room do
receive it; the client drops events whose `userId` is its own. Doing that on the server would
need per-user room bookkeeping for no gain.

Nothing is written: no row, no `last_seq`, no unread, no Valkey key. A restart of the API loses
indications by design.

### D5. Read over the socket reuses `ChatService.markRead`

`chat.read.v1 { conversationId, seq }` (payload shape reuses `MarkConversationReadSchema`) →
`ChatService.markRead(userId, conversationId, seq)` → ack `{}`. The 0.2a `read` echo to the
reader's tabs is unchanged: it is emitted inside `markRead`, so REST and socket paths behave
identically by construction.

`markRead`'s first parameter changes from `JwtPayload` to `userId: string`; the controller passes
`actor.sub`. A socket handler has an identity, not a token, and building a fake `JwtPayload` would
invent an `email`.

The web client prefers the socket when `socket.connected` and falls back to `POST …/read` when it
is not connected or the ack is not `ok` or times out (5 s). Both are forward-only and idempotent,
so "timed out, then REST" cannot double-apply anything visible.

### D6. Read means "looked at": one pure rule, three inputs

`shouldReportRead({ windowActive, atEnd, newestSeq, reportedSeq })` returns true when
`windowActive && atEnd && newestSeq > reportedSeq`. A `useReadOnView` hook feeds it:
- `windowActive` = `document.visibilityState === 'visible' && document.hasFocus()`, tracked with
  `visibilitychange`, `focus` and `blur`;
- `atEnd` from `useMessageScrollerScrollable()` of the vendored scroller: its `end` flag is true when
  there is content below the viewport (`contentBottom - scrollTop - clientHeight > threshold`), so
  at-end is `!end`. A thread shorter than the viewport is trivially at its end. The hook works only
  under the provider, so the rule is applied by a small component rendered inside it
  (`ReadOnViewTracker`);
- the effect re-runs when any input changes, so returning to the window or scrolling down reports
  read at that moment.

This replaces the unconditional `newestSeq > lastReportedSeq` effect in `ChatTranscript`; the
`lastReportedSeq` ref stays so that the same position is not reported twice.

**Scrolling is "follow the bottom", not an anchor (found during live verification and reported
afterwards).** The vendored scroller scrolls to any row marked `scrollAnchor` and aligns it to the
**top** of the viewport, adding a blank spacer under it (the behaviour AI chats want, where an
answer grows downwards). The transcript marked its newest row as the anchor unconditionally, so in
a messenger it looked like a jump: a message the user had just sent appeared at the top with about
600 px of empty space below it (measured: 64 px from the top, a 615 px spacer), and with live
messages every incoming message pulled a reader who had scrolled up to the bottom
(`scrollTop` 0 → 2016), which also made "scrolled up stays unread" unreachable. An earlier fix in
this change only gated the anchor on the reader being at the end; that kept the top alignment, and
my "distance from the end" probe could not see it because the spacer fills the space below.

The transcript now uses no anchors at all. `MessageScrollerProvider autoScroll` puts the primitive
in its "following-bottom" mode: a reader who is at the bottom stays at the bottom with the new row
directly under the previous ones, and a reader who scrolls up switches to free scrolling and is
never moved. The primitive cannot know that a row is the user's own, so `TranscriptRows` calls
`scrollToEnd()` when the newest row changes and `isOwnRow` says it is the reader's (an outbox entry
or their confirmed text message). The first render does not scroll; `defaultScrollPosition` places
the thread at its end. The verification now measures where the newest row sits relative to the
viewport and the spacer height, not the distance from the end.

Caveat: `document.hasFocus()` is false while focus is in an iframe or devtools, and some embedded
webviews report it strictly. The failure mode is "stays unread slightly longer", which is the safe
side. Manual verification must keep the page focused.

### D7. Web subscription manager

`features/chat/realtime/chat-subscriptions.ts` exposes `watchConversation(id): () => void`,
ref-counted per id: the first reference emits `chat.subscribe.v1`, the last one emits
`chat.unsubscribe.v1`, deferred by one tick so React StrictMode's mount → unmount → mount does not
produce an unsubscribe/subscribe pair. A `connect` handler re-emits subscribe for every id still
held, regardless of `socket.recovered` (idempotent, and cheaper than reasoning about recovery).
Acks use `socket.timeout(5_000).emitWithAck`; a refusal or timeout is swallowed (debug log) — the
spec requires the screen to keep working. `ChatConversationPage` holds the reference with
`useEffect(() => watchConversation(conversationId), [conversationId])`.

### D8. Typing UI

`useChatTypingStore` (zustand): `{ [conversationId]: { [userId]: expiresAtLocal } }`. `chat-sync`
sets an entry from `chat.typing-changed.v1` (ignoring the user's own id) and clears the sender's
entry when `chat.message-created.v1` arrives from them. `TypingIndicator` reads the entries for
the open conversation, resolves names from the conversation's participants (`name ?? email`), and
prunes lapsed entries on a 1 s tick that runs only while an entry exists. Copy via i18n plurals:
one name, two names, "N people". It occupies a fixed-height row above the composer so the thread
does not jump when it appears. The composer takes an `onTyping` callback, fired from `onChange`
when the value is non-empty, at most once per `CHAT_TYPING_PULSE_MS`, reset after send; the rule is
a pure `shouldPulseTyping(lastPulseAt, now, value)`.

### D9. Docs

`docs/chat.md` §4.8.2 and §7 move to the 0.2b (protocol) / 0.2c (notifications, presence dot)
split and record `expiresInMs`. `docs/modules.md` §7.2 gets the inbound registry beside the
outbound one. `docs/realtime.md` documents the client → server contract (ack envelope, codes, rate
limit, tenant context).

## Risks / Trade-offs

- **A typing pulse can race the subscribe ack.** The first keystroke may arrive before the join
  completed and be refused `FORBIDDEN`. The next pulse, three seconds later, succeeds. Accepted: the
  cost is one missing indicator, and awaiting the ack before the first pulse would couple the
  composer to connection state.
- **Typing and "viewing" are per socket, in process memory of the replica holding the socket.**
  Cross-replica delivery goes through the adapter, as for every room. Cross-replica *queries* ("who
  is in this room") are 0.2c's concern and use `fetchSockets()`.
- **In-memory rate limiting resets on reconnect.** A client that reconnects in a loop gets a fresh
  budget each time. The handshake is already authenticated and the events are cheap (typing touches
  no database; subscribe and read are one indexed lookup each); a handshake-level limit is a
  separate concern.
- **Read-on-view hides messages from "read" longer than before** when the window is in the
  background. That is the intended behaviour; it is the reason the change exists.
- **`document.hasFocus()` in embedded webviews** (see D6) can keep a conversation unread while the
  user is in fact looking at it. The same thing happens in any messenger when the window loses
  focus, so the user model is familiar.
- **Renaming `ClientToServerEvents`.** Its three importers (`socket.ts`, `realtime.types.ts`,
  worker emitter) keep importing the name from the contracts root; only the realtime-local
  declaration is renamed, and `typecheck` covers every use.

## Documentation to promote

Per the archive rule, before this change is archived its durable content moves into `docs/` in the
last task group: D1 and the ack envelope into `docs/realtime.md`; D2, D4, D5, D6 and the 0.2c
hand-off into `docs/chat.md` §4.8; the registry into `docs/modules.md` §7.2.
