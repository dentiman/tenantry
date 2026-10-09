# Proposal

## Why

CHAT-0.2a made the Chat screen live in one direction: the server tells every participant about
every change. Everything that needs the *client* to tell the server something is still missing,
and `docs/chat.md` §4.8.2 lists it as the rest of CHAT-0.2:

- **Nobody can say "I am looking at this conversation".** The server cannot tell a user who has
  a thread open from a user who is merely connected. That fact is the prerequisite for the
  "do not notify someone who is already reading" rule in `docs/chat.md` §4.11, and it is also
  what typing indicators are addressed to.
- **There is no typing indicator.** It is the most visible difference between a messenger and a
  page that refreshes itself.
- **"Read" is decided by delivery, not by looking.** `ChatTranscript` moves the read cursor as
  soon as a newer `seq` appears in the cache, whether or not the window is focused or the end of
  the thread is on screen. With live messages this became wrong in practice: a message that
  arrives while the tab is in the background is silently marked read, and the unread badge never
  appears for the one person it is meant for.
- **The realtime layer cannot take a feature's inbound event.** The gateway has exactly one
  `@SubscribeMessage` (`auth.update.v1`). The gateway belongs to `realtime`, a lower tier that
  must not import `chat`'s access function, so chat cannot simply add handlers next to it.

This change is the *protocol* half of the old "0.2b". The other half — the
`chat.message_received` notification with viewer suppression, and the presence dot — is split
into **CHAT-0.2c** and depends on the room introduced here. Splitting follows the project rule
that a phase is cut by the capability it touches: this change touches the live connection, the
other touches the notification inbox and has its own architectural decision (where the
notification is written) that deserves its own design.

## What Changes

- **A registry for client → server socket events in `realtime`**, the inbound twin of
  `defineSocketEvent` (`docs/modules.md` §7.2). A feature declares an event with a payload
  schema and an ack schema in its own contracts and registers a handler from `onModuleInit`.
  `realtime` does the parts that must not be forgotten: Zod validation of the payload, a
  per-socket rate limit, the tenant context for the handler, and normalising every failure into
  a closed machine `code` in the ack. Handlers never see the raw socket event, only a verified
  identity and a parsed payload.
- **Conversation rooms with server-side authorization.** `chat.subscribe.v1` joins the socket to
  `tenant:{t}:conversation:{c}` only if the user is an active participant (the existing
  `ConversationAccessService`, answering exactly as REST does for a conversation that is not
  theirs). `chat.unsubscribe.v1` leaves it. A socket may hold at most a handful of such rooms.
  Delivery of messages is **unchanged**: `chat.message-created.v1` keeps going to personal rooms,
  so a missed subscription costs a typing indicator, never a message.
- **Typing.** `chat.typing.v1` (client → server) is accepted only from a socket that is in the
  room; the server relays `chat.typing-changed.v1 { conversationId, userId, until }` to the other
  sockets in the room. It is ephemeral: nothing is stored, nothing touches the database, and the
  indication expires on its own.
- **Read over the socket.** `chat.read.v1 { conversationId, seq }` calls the same
  `ChatService.markRead` as `POST /conversations/:id/read`, with the same forward-only rule. The
  REST endpoint stays as the fallback. `markRead` takes a user id instead of the whole token
  payload, because a socket handler has an identity, not a JWT.
- **Read means "looked at".** The transcript reports read only while the window is visible and
  focused and the newest message is on screen; returning to the window or scrolling to the end
  reports it then.
- **Web:** `features/chat/realtime/` gains a typed ack helper, a ref-counted subscription manager
  that re-subscribes on every `connect`, a typing store and a `TypingIndicator` above the
  composer, and the read-on-view hook. The composer pulses typing at most once per 3 s while the
  user types.
- **Docs:** `docs/chat.md` §4.8.2 and §7 describe the 0.2b/0.2c split; `docs/modules.md` §7.2 gets
  the inbound registry; `docs/realtime.md` documents the client → server contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat/live-updates`: gains requirements for announcing that a conversation is being viewed (with
  the same authorization as reading it), for ephemeral typing indications that reach only viewers,
  for reporting the read position over the live connection, and for refusing invalid or excessive
  live requests without side effects.
- `chat/area`: gains requirements for showing who is typing, for marking a conversation read only
  while the user is looking at it, and for the open conversation announcing itself again after
  navigation and reconnects.

## Impact

- **Contracts:** new `libs/contracts/src/realtime/client-socket-event.ts` (mechanism),
  `libs/contracts/src/chat/chat.client-events.ts` and `chat.rooms.ts`; `ClientToServerEvents` in
  the root `socket-events.ts` becomes the composition of the existing `auth.update.v1` and the
  registered events; new server → client event `chat.typing-changed.v1` in
  `chat.socket-events.ts`.
- **API / realtime:** new `ClientEventRegistry` (exported by `RealtimeModule`), `attach(socket)`
  in `RealtimeGateway.handleConnection`; `auth.update.v1` stays a `@SubscribeMessage` and is not
  migrated.
- **API / chat:** new `chat.socket-handlers.ts` registering the four events;
  `ChatService.markRead` signature changes from the JWT payload to a user id (controller passes
  `actor.sub`).
- **Web:** `features/chat/realtime/` (ack helper, subscription manager, typing store),
  `TypingIndicator`, `use-chat.ts` (`useMarkRead` prefers the socket), `chat-transcript.tsx`
  (read-on-view), `chat-composer.tsx` (typing pulse), `chat-conversation.tsx` (subscription).
  New strings in `locales/en/chat.json`.
- **Tests:** a new `apps/api/test/chat-socket-events.e2e-spec.ts` (authorization, rate limit,
  validation, typing reach, read parity with REST) and unit tests for the subscription manager,
  the typing store and the read-on-view rule.
- **No schema migration, no REST contract change** (so no `openapi:generate`/orval run), **no
  messaging topology change.**
- **Not touched, deliberately:** notifications and the presence dot (CHAT-0.2c); leaving rooms
  when a participant is removed (CHAT-0.3, which introduces removal — the helper is named in
  `design.md` so that phase cannot forget it); `chat.message-posted.v1` (still no subscriber).
- **Module graph:** `chat → realtime` already exists; no new edge.
