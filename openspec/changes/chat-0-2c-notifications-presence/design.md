# Design

## Context

Observed in the code after CHAT-0.2b:

- **Posting.** `ChatService.post()` reads the conversation access, replays a repeated
  `clientMessageId`, otherwise calls `insert()`, which in one `withTenantTx` increments `last_seq`
  (the row lock), inserts the message, bumps unread counters and registers the after-commit socket
  emission. The comment at the end of `insert()` reserves `publish(tx, chatMessagePostedEvent, …)`.
- **Who is viewing.** A socket that announced a conversation (`chat.subscribe.v1`) is in
  `tenant:{t}:conversation:{c}` (`conversationRoom`, contracts). The API owns the namespace;
  `RealtimeEmitter` is a generic emitter with `toUsers`. Rooms are cluster-wide through the Valkey
  streams adapter, so `namespace.in(room).fetchSockets()` answers across replicas, with a timeout.
- **Notifications.** `NotificationRecorder.notify(tx, input)` is written to run inside the caller's
  transaction: it validates the payload against the type's schema, drops the actor and users who
  turned the type off, upserts one row per recipient with the partial-unique collapse on
  `(tenant, recipient, group_key)` while unread, bumps the recipient's revision and emits
  `notification.created` after commit. The worker already calls it
  (`welcome-email.subscriber.ts`, the scheduled dispatcher) with a `NotificationDispatcher`
  registered by `WorkerRealtimeEmitter`, so a notification born in the worker reaches the browser.
  Reading is done by `NotificationsService` in the API (`bumpRevision` + an after-commit
  `notification.changed`); nothing in `libs/shared` can mark rows read yet.
- **Types.** A type is declared with `defineNotificationTypes` in the owner's contracts and merged
  in the root `notification-types.ts`; its texts live in the owner's i18n namespace and
  `registry-texts.test.ts` fails when a type has no text, label or category text. The web maps a
  `{kind, id}` target to a route in `entity-routes.ts`.
- **Messaging.** `MESSAGE_TOPOLOGY` is the one manifest; a declared event without a subscriber class
  crashes the worker at boot, which is why `calendar.*` events were never declared. A subscriber is
  `@MessageSubscriber({ definition, id })`; `MessageInboxService.runOnce(envelope, consumerId, fn)`
  makes the effects idempotent per message. `pgboss.*` lives outside RLS, so payloads carry ids,
  never content (`generateAiReplyCommand` is the precedent). The API e2e mocks pg-boss and records
  every `send` (`sentJobs`).
- **Presence on the web.** `usePresence()` (online set from `GET /presence` plus socket deltas) and
  `PresenceDot` exist. `ConversationParticipantResponse` has no `lastSeenAt`.

## Goals / Non-Goals

**Goals:**
- A participant who is not looking is notified, collapsed per conversation, and only for text
  messages from others.
- The send is independent of notifying: no extra work under the conversation row lock, and no way
  for a notification failure to undo a message.
- "Not looking" is the fact 0.2b established — a socket in the conversation room — evaluated at the
  moment of posting.
- Reading clears the notification everywhere.
- A presence dot for direct conversations.

**Non-Goals:**
- Mentions and per-conversation notification levels (CHAT-0.3).
- A "last seen" line for the other person (it needs `lastSeenAt` on the participant contract).
- Notifications for customer-facing channels (CHAT-2) and for event entries.
- Push or email delivery (the inbox is the only channel).

## Decisions

### D1. The notification is written by a subscriber of `chat.message-posted.v1`, not inside the send

`insert()` publishes `chat.message-posted.v1` with `publish(tx, …)` in the same transaction as the
message. A new worker subscriber `chat-notify` consumes it and records the notifications.

- **Why not `notify()` inside `insert()`:** it runs one upsert plus one revision bump per recipient,
  sequentially, *while the conversation row is locked* by the `last_seq` increment, so in a channel
  with dozens of members every send is serialised behind that fan-out. Worse, the notification is
  written in the message's transaction: a failure in it (a preference lookup, a bad payload) rolls
  the **message** back. The send must not depend on the inbox.
- **Why not an `onCommit` hook in the API:** after-commit hooks are for lossy accelerators, and a
  notification is a durable record. A crash between the commit and the hook would silently drop it.
  The project rule is that anything that must happen goes through `publish(tx, …)`.
- **Cost:** the notification arrives after the pg-boss poll interval. The live message already
  reached every open tab through the socket, so the notification only has to catch up for people who
  are not looking; the consumer sets `pollingIntervalSeconds: 0.5`, the same value the AI reply
  consumer uses for a human-visible delay.
- This is the first real subscriber of the event the 0.1 seam and `docs/chat.md` §4.11 reserved, so
  the manifest entry and the class arrive together, as the calendar's comment in `topology.ts`
  requires.

Event: `chat.message-posted.v1 { conversationId, messageId, viewerIds }` (`tenantId` and the actor
ride the envelope). Ids only: the worker reads the message and the participants under RLS. No
`singletonKey` — every message is its own event.

### D2. "Viewing" is computed before the transaction and carried in the event

`ChatService.post()` asks `RealtimeEmitter.userIdsInRoom(room)` — a generic method,
`namespace.in(room).fetchSockets()` mapped to `socket.data.userId` — **before** `insert()` opens its
transaction. Reasons:
- an adapter round trip is an external call and must not sit inside a transaction that holds the
  conversation row lock;
- the worker then needs no socket access: `viewerIds` is plain data in the event, so the subscriber
  is deterministic and testable;
- the semantic is exactly "who was looking when this was posted".

The query is **fail-open**: a timeout or any error is logged and yields an empty set, so people are
notified rather than silently skipped (the spec requires this). The cost is one adapter request per
posted message, which is the same order as the per-message emission already made in 0.2a; if posting
rates ever make it hurt, the room membership can be mirrored into Valkey leases the way presence is.
The set is a snapshot: a participant who opens the conversation a moment later keeps the
notification they were sent and clears it by reading (D4).

The replayed-send path (`clientMessageId` already stored) neither queries nor publishes.

### D3. The notification type and its payload

`chat.message_received` in `libs/contracts/src/chat/chat.notifications.ts`:
category `chat` (new, its heading text in `chat.json`), `defaultEnabled: true`, `muteable: true`,
`subject: 'conversation'`. Payload `{ conversation: EntityRef(kind 'conversation', id, label),
preview }`; `target = { kind: 'conversation', id }`, `groupKey = conversation:{id}`.

- **The label is computed per recipient.** A conversation title is nullable and, when absent, the
  chat screen builds a label relative to the viewer. The notifier does the same for the recipient:
  the title if there is one; otherwise the sender's name for a direct conversation; otherwise up to
  three other participants' names. The row is therefore self-contained, like every other
  notification (no join at render time).
- `preview` is the message body flattened and cut to `CHAT_PREVIEW_CHARS`, the same function the
  conversation list preview uses. It is stored in the `notifications` table, which is under RLS and
  addressed to a participant — not in the pg-boss payload, which is outside RLS (D1).
- Collapse semantics are the recorder's: payload and actor come from the newest message of the group,
  `group_count` says how many.
- Texts in `chat.json`: `notifications.type.chat.message_received_one/_other`,
  `notifications.label.chat.message_received`, `notifications.category.chat`. `entity-routes.ts`
  gains `conversation → /chat/$conversationId`.

### D4. `ChatNotifier` in `libs/shared`, so the logic is not trapped in the worker

`ChatNotifier.notifyMessagePosted(tx, { conversationId, messageId, viewerIds })` holds everything the
subscriber does: read the message (TEXT only), the conversation and its active participants, compute
the recipient set (participants − sender − `viewerIds`), build the per-recipient payload and call
`NotificationRecorder.notify` once per recipient. The worker subscriber is then a thin wrapper:
`runOnce(envelope, 'chat-notify', tx => notifier.notifyMessagePosted(tx, data))`. This keeps the rule
testable against a real database from the API e2e suite (the worker's own tests mock the database),
and it is where CHAT-2's webhook path will call the same code.

Failure behaviour: a missing conversation or message throws `NonRetryableMessageError` (nothing to
notify, retrying cannot help); anything else is retried by pg-boss. A job that exhausts its retries
goes to the shared `dlq`; the user-visible cost is a missing bell entry while the conversation's
unread badge and the live message are unaffected. `runOnce` makes a redelivery a no-op.

### D5. Reading clears the notification: `NotificationRecorder.markReadByTarget`

`markReadByTarget(tx, userId, target)` marks the user's unread, unarchived notifications for the
target read, bumps their revision and registers an after-commit `notification.changed`
(`change: 'read'`, `scope: { kind: 'ids', ids }`), reusing the dispatcher and the summary the inbox
already uses. It does nothing, and emits nothing, when no row matched.

`ChatService.markRead` calls it in its existing transaction when the cursor really moved
(`count > 0`) — the same condition that gates the `read` echo, so a stale report touches nothing.
Both the REST and the socket paths go through `markRead`, so both clear it.

`chat` therefore depends on `notifications` and `messaging`; both are platform-tier, so the edges are
downward, and `modules.config.ts` gains the two names.

### D6. Presence dot

`conversation-list.tsx` and the conversation header render the existing user presence dot for the
other participant when `participants.length === 2`, on the avatar, and nothing otherwise. The
component already draws nothing for offline and for `isUnknown`. A pure `directPeerId(participants,
viewerId)` selects the peer (null for anything but exactly two participants where one is the viewer),
so the rule is unit-tested without a DOM. Presence deltas already invalidate the shared query, so the
dot follows without new wiring. A "last seen" line is a recorded follow-up (Non-Goals).

### D7. Docs

`docs/chat.md` §4.8 (0.2c row, built), §4.11 (as built: the subscriber, `viewerIds`, label rule,
read-clears) and §7; `docs/notifications.md` (the type and the worker-born path);
`docs/event-driven-architecture.md` (the topology row and consumer); `docs/roadmap.md`.

## Risks / Trade-offs

- **Notification latency of about a poll interval.** Accepted (D1). A user who is looking sees the
  message live; a user who is not sees the bell within about a second.
- **A snapshot of viewers can be wrong by a moment.** Someone who opens the conversation between the
  query and the worker's run gets a notification for a message they are already reading. Reading it
  clears the row at once (D5), and the web toast is already skipped when the inbox panel is open.
- **One adapter request per posted message.** Same order as the emission cost; fail-open on timeout
  so a slow broker degrades to "notify everyone", never to "notify nobody".
- **Per-recipient upserts in the worker.** Dozens per message in a large channel, but outside the
  conversation lock and off the send path. If channels reach hundreds of members, the
  `docs/chat.md` §4.4 bound applies and this becomes a set-based insert.
- **`viewerIds` in the job payload.** User ids in `pgboss.*` (outside RLS) reveal that a user was
  viewing a conversation, no content. Same class as the `senderId`/`userId` the other events carry.
- **New notification type widens a generated enum.** The notification type union is part of the
  OpenAPI document, so adding a type regenerates the web client; this is checked in the first
  contracts task rather than assumed away.

## Documentation to promote

Before this change is archived, D1–D5 move into `docs/chat.md` §4.8/§4.11, the type into
`docs/notifications.md`, and the topology row into `docs/event-driven-architecture.md` (last task
group).
