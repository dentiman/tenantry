# Design

## Context

State of the code after CHAT-2a and CHAT-0.2c (both built and committed, neither archived):

- `ChatService.post()` refuses a customer conversation with `422` ("Replies … are not available yet").
  `ChatService.insert()` increments `last_seq` under the conversation row lock, inserts, bumps
  participants' unread counters, registers the socket emission and (0.2c) publishes
  `chat.message-posted.v1` for internal conversations.
- `chat_messages` already has `direction`, `channel_id`, `external_id` (partial unique per channel),
  `status` with `SENDING` in the scale, `provider_sent_at`, `provider_meta`, `client_message_id`
  (partial unique). It has **no** failure, attempt or receipt-time columns.
- `conversations` has `channel_id`, `contact_id`, `customer_last_message_at` (the provider's time of
  the customer's last message), `assignee_id`, `resolved_at`, `status` (`OPEN/PENDING/SNOOZED/RESOLVED`).
  Ingest (`libs/shared/src/channels/channel-ingest.service.ts`) already reopens a `RESOLVED`
  conversation within `channels.settings.reopenHours` and locks the conversation row before touching
  `seq`. Inbound messages bump no personal unread counter (there is no participant for a customer
  conversation).
- `ChannelAdapter` has `verifyWebhook`, `handshake`, `parseWebhook` and `capabilities`
  (`freeformWindowHours`, `maxTextLength`); **no `send`**. `NormalizedEvent` has `message` and
  `unsupported`. `FakeChannelAdapter` is registered only under `CHAT_DEV_TOOLS`. The webhook stores a
  raw event; the `channels-ingest` consumer is a **standard** queue.
- Messaging: `key_strict_fifo` queues exist and require a `singletonKey`; the publisher enforces it. A
  handler cannot see pg-boss's `retryCount` (`topology.ts`). `MessageInboxService.runOnce` is the
  idempotency primitive. pg-boss is mocked in API e2e (`sentJobs`), so ordering/retry semantics of a
  real queue are **not** testable there.
- `ApiError.code` is a **closed set** (`libs/contracts/src/error/error.schema.ts`); there is no code
  for "unprocessable".
- Notifications: `chat.message_received` exists (0.2c) and is written by `ChatNotifier` for internal
  messages; `NotificationRecorder.markReadByTarget` clears by `{ kind, id }`.
- There are no chat activity types yet; `ConversationAccessService` returns `membership: null` for a
  non-participant of a `tenant`-access conversation.
- Decisions this change implements, not reopens: `docs/whatsapp-channel.md` §4.4 (status folding),
  §4.5 (outbound, classes, the unconfirmed hole, O-W3 — strict FIFO per conversation with a bounded
  handler), §4.7 (participation means "handling it"); owners' O-W1…O-W5 (§7).

## Goals / Non-Goals

**Goals:**
- A reply is durable the moment the request returns, and is delivered at most once per user intent.
- Every way a delivery can end is one of a small closed set with a defined, tested effect.
- Receipt folding is order-independent and decided in SQL, not in application code.
- Everything is provable on the fake provider; the real adapter (3a) only supplies `send` and a
  code → class table, and must pass the same contract tests.

**Non-Goals:**
- Media, templates, `context` replies, mark-as-read / typing to the provider, reactions (2c/3a/3b).
- A "parked until reconnected" queue state for authentication failures (see D6).
- Notifying the whole team about unassigned inbound messages, working hours, auto-assignment, SLA,
  `SNOOZED` (CHAT-4).
- Editing or deleting a sent customer message; resend is the only correction.
- Changing the access rule: customer conversations stay visible to every active user (O-W1).

## Decisions

### D1. The reply is stored `QUEUED` and the request returns; a worker sends

`ChatService.post()` for a customer conversation, in one `withTenantTx` (the only transaction):

1. window check (cheap, early, so the user gets `422` and nothing is stored);
2. `insert()` as today (lock via `last_seq` increment) but with `direction='OUTBOUND'`, `channel_id`,
   `status='QUEUED'`, `sender_type='user'`;
3. claim and reopen (D5);
4. `publish(tx, channelsDeliverOutboundCommand, { messageId }, { singletonKey: conversationId })`;
5. after commit: `chat.inbox-changed.v1` to the tenant room (the existing re-read signal) so every
   open copy of the conversation refreshes.

Idempotency stays on the existing partial unique index on `client_message_id`; the loser of a race
returns the winner's row and publishes nothing (its transaction rolls back, and so does its
`publish`). The adapter is **never** called in the request.

*Alternative: call the provider synchronously.* Rejected: the request would hold the conversation row
lock across a network call and a provider outage would become an API outage.
*Alternative: write `SENT` optimistically.* Rejected: the footer would lie.

### D2. One strictly ordered queue per conversation, and a handler that cannot wedge it

`channels.deliver-outbound` is `key_strict_fifo` keyed by `conversationId` (O-W3, accepted): the
customer must see replies in the order the agent wrote them. The documented cost of that policy is
that a permanently failed job blocks its key. The handler therefore **never ends a job in failure
for any reason except a retryable one with attempts left**:

| Outcome | Handler does | Job |
| --- | --- | --- |
| sent | store `external_id`, `SENT` | completes |
| `WINDOW_CLOSED`, `PERMANENT`, `POLICY`, `HUMAN`, `AUTH` | store `failure`, `FAILED` | completes |
| `RATE_LIMITED`, `TRANSIENT`, attempts left | reset to `QUEUED`, keep `attempts` | throws → pg-boss retries with backoff |
| `RATE_LIMITED`, `TRANSIENT`, attempts exhausted (5) | `FAILED` with that class | completes |
| row not `QUEUED` and not recoverable (already sent, deleted) | nothing | completes (`NonRetryableMessageError` only for a missing row) |

The topology entry sets `retryLimit` above the attempt bound (6) so pg-boss never exhausts retries
before the handler's own bound does — the **row's** `attempts` is the counter, since the handler
cannot read the queue's.

The claim is one conditional statement:
`UPDATE chat_messages SET status='SENDING', attempts=attempts+1, sending_started_at=now()
WHERE id=$1 AND status='QUEUED' RETURNING …`. Zero rows means someone else holds it or it is done.

*Alternative: standard queue plus an application `ORDER BY`.* Rejected: order is a property of the
send, not of the stored `seq`; two replies could reach the provider in swapped order.
*Alternative: no ordering.* Rejected for this product (a two-part answer arriving reversed is the
exact bug a human notices).

### D3. The window is checked twice, and the second check is the authoritative one

`window(conversation, adapter) = customer_last_message_at + capabilities.freeformWindowHours`. No
`customer_last_message_at` means the customer never wrote: closed. A provider without
`freeformWindowHours` has no window. The API check is a courtesy (fast `422`, no row); the worker
check decides, because a job can wait in a strict queue across the boundary. A message the worker
finds outside the window becomes `FAILED(WINDOW_CLOSED)`; the UI then offers nothing to resend until
a customer message reopens the window (templates are CHAT-3b).

`422` needs a machine code the client can translate. The `ApiError.code` set is closed and has no
"unprocessable", so this change **adds `CHANNEL_WINDOW_CLOSED`** to it (and the filter maps the
exception), rather than overloading `BAD_REQUEST`. `docs/error-handling.md` is updated in the same
change, and both generated clients.

### D4. The adapter contract grows by one method and one error type

```ts
interface OutboundContext {
  channelExternalId: string;        // provider's id of our number
  to: { kind: ContactAddressKind; value: string };
  messageId: string;                // our id; sent as the provider's opaque callback value
  body: string;
  attempt: number;                  // 1-based, from the row — lets the fake script "fail once"
  signal: AbortSignal;              // hard timeout, 15 s
}
send(ctx: OutboundContext, creds: ChannelCredentials): Promise<{ externalId: string }>;

class ChannelSendError extends Error {
  readonly errorClass: 'WINDOW_CLOSED'|'PERMANENT'|'POLICY'|'RATE_LIMITED'|'AUTH'|'TRANSIENT'|'HUMAN';
  readonly code: string;            // provider's code, stored as text
  readonly title: string;
  readonly retryAfterSeconds?: number;
}
```

Anything thrown by `send` that is **not** a `ChannelSendError` (a bug, an unmapped network error) is
treated as `TRANSIENT`. A timeout is `TRANSIENT`. This keeps the rule "the adapter classifies, the
core acts" and keeps Meta's table (`docs/whatsapp-channel.md` §4.5) entirely inside the 3a adapter.

The fake adapter reads a scenario from a marker at the start of the body — `[[fake:permanent]]`,
`[[fake:window]]`, `[[fake:policy]]`, `[[fake:ratelimit]]`, `[[fake:auth]]`, `[[fake:transient]]`
(always), `[[fake:transient-once]]` (only while `attempt = 1`), `[[fake:human]]`, `[[fake:slow]]`
(waits for the abort signal) — and otherwise returns `fake-out-<messageId>`. Markers are honoured only
because the fake adapter itself exists only under `CHAT_DEV_TOOLS`. The contract-test suite written in
2a gains a `send` section the real adapter must pass.

### D5. Replying claims, reopens, and writes the workflow records in the same transaction

Inside the reply transaction, after the insert:
- **claim:** `UPDATE conversations SET assignee_id=$user WHERE id=$c AND assignee_id IS NULL`; if a row
  matched, also upsert the user as a participant (D7) and write the `conversation.assigned` system
  entry and activity. The conditional update is the guard (read-modify-write rule): two simultaneous
  first replies assign exactly one user and both messages are stored.
- **reopen:** `UPDATE … SET status='OPEN', resolved_at=NULL WHERE id=$c AND status='RESOLVED'`, with a
  `conversation.status_changed` entry and activity when a row matched. A `PENDING` conversation stays
  pending.

The same helpers serve the explicit endpoints (`PUT …/status`, `PUT …/assignee`): a no-op (same value)
matches zero rows and writes nothing, so the transcript never fills with "assigned to X" repeated by a
double click. Ingest uses the same status helper for the inbound side (`PENDING → OPEN`, and the
existing `RESOLVED → OPEN` reopen), writing the entry with the contact as the actor.

System entries extend `CHAT_SYSTEM_ENTRY_TYPES` with `conversation.assigned`
(`{ assignee: {id,label} | null }`) and `conversation.status_changed` (`{ from, to }`); the web renders
them with i18next like the existing two. Activities are new types in
`libs/contracts/src/chat/chat.activities.ts` (`conversation.assigned`, `conversation.status_changed`)
linked to the conversation and, when `contact.customer_id` is set, to the customer, through the
existing `ActivityRecorder` (so the customer feed shows the history, `docs/chat.md` §4.11).
Because both records are written with the change, a rolled-back change leaves neither.

### D6. Authentication failures fail the message; the account is flagged; no "parked" state

`docs/whatsapp-channel.md` §4.5 says an `AUTH` failure leaves the message `QUEUED` until
re-authentication. Doing that needs a queue state that stops delivering for the account and resumes
on reconnect — which is the account health work of CHAT-3c (`NEEDS_REAUTH` UI, admin notification,
resume). Until then 2b does the honest minimal thing: the message becomes `FAILED(AUTH)`, the account
is set to `NEEDS_REAUTH` (the column exists since 2a), and the user resends after reconnecting. The
fake provider can produce it, so the path is tested now. This is a recorded deviation from §4.5, to
be reversed in 3c; `docs/whatsapp-channel.md` §6 gets the note.

### D7. Participation of a customer conversation means "the assignee"

Per `docs/whatsapp-channel.md` §4.7 participation means "handling it". The smallest rule that makes
unread counters and the "mine" filter honest: **the participant set of a customer conversation is its
current assignee**. Assigning inserts the participant row (and sets `left_at` on the previous
assignee's row); unassigning sets `left_at`. Then everything already built keeps working unchanged:
`insert()`/ingest increment `unread_count` for participants, `markRead` moves the cursor,
`markReadByTarget` clears the notification, and `ConversationAccessService` still lets everyone read
(`tenant` branch) while only the assignee has a `membership`. Inbound ingest gains the same one-line
participant increment that `insert()` has.

*Alternative: also add every colleague who replied.* Rejected for now: it makes "unread" mean
"anyone who ever touched it" and nothing in the plan needs it.

### D8. Inbound notification: assignee only, from a second subscriber

A new event `chat.customer-message-received.v1 { conversationId, messageId }` is published by ingest
in its transaction when it stored a message; its consumer `chat-notify-customer` (worker) computes
`viewerIds` (D9) **before** `runOnce`, then calls `ChatNotifier.notifyCustomerMessage`, which
notifies the conversation's assignee unless they are viewing, with a new type
`chat.customer_message_received` (category `chat`, collapses on the same `conversation:<id>` key,
text "New message from <a>…</a>", no actor — the person is not a user). `markReadByTarget` already
clears every unread notification with that target, so reading the conversation clears both types.
Unassigned conversations notify nobody (the inbox and the "unassigned" filter are the queue).

*Alternative: reuse `chat.message_received`.* Rejected: its text names a user actor ("X wrote in …");
the sender here is a contact, and `ActivityActor` has no such shape.
*Alternative: notify everyone for unassigned.* Rejected: with O-W1 that is every user for every
message; who is "on duty" is a CHAT-4 concept.

### D9. "Who is viewing" from the worker

The worker already has a headless Socket.IO server on the same Valkey adapter (`WorkerRealtimeEmitter`).
`fetchSockets()` on a room goes through the adapter, so the worker can ask the same question the API
does. `WorkerRealtimeEmitter` gains `userIdsInRoom(room)` with the API's contract (1 s timeout,
fail-open `[]`). **This is unverified for a headless server and is the first task of the group**: if
`fetchSockets` does not answer from the worker, the fallback is to carry the question through the API
(a tiny internal call) or to accept "notify even if viewing, cleared on read" for inbound only — the
spec's suppression scenario then moves to a follow-up. The decision is made on that evidence, not
assumed.

### D10. Receipts are folded in SQL; unknown ones are parked

`NormalizedEvent` gains `status { channelExternalId, externalMessageId, opaqueId?, status:
sent|delivered|read|failed, occurredAt, failure?{code,title,details?}, providerMeta }`. The ingest
service folds it with one statement per kind, with `rank: QUEUED 0, SENDING 1, SENT 2, FAILED 2,
DELIVERED 3, READ 4`:

- `sent`: `… WHERE target AND status IN ('QUEUED','SENDING')` (a late `sent` can never beat `FAILED`
  or a delivery);
- `delivered` / `read`: `… WHERE target AND rank(status) < $rank` — it overrides `FAILED` and clears
  `failure`; sets `delivered_at` / `read_at` (a `read` also fills a missing `delivered_at`);
- `failed`: `… WHERE target AND status IN ('QUEUED','SENDING','SENT')` with the failure JSON.

`target` is `(channel_id = $ch AND external_id = $ext) OR id = $opaque`, **always** with the channel
id from the signed account, so a receipt can never touch another tenant's or channel's row (RLS is
the second wall). The count of updated rows decides whether to emit `chat.message-updated.v1
{ conversationId, messageId }` (tenant room, re-read only — it carries no state, so rule 15 of
AGENTS.md does not apply to it). Zero rows matched and the message simply is not there (not "already
ahead") means **park**: insert into `channel_pending_statuses`. Distinguishing the two needs one extra
`SELECT` of the target on the zero-row path only.

Parked receipts are applied (a) by the delivery step right after it stores `external_id`, and (b) by a
cron command `channels.sweep-pending-statuses` (every minute, system scope, tenant context per row)
that retries up to 5 times and then deletes with a warning log (`attempts` column). The table is a
tenant table under RLS; the sweep enters each row's tenant like other system-scope crons.

### D11. The unconfirmed-delivery hole

A crash between the provider accepting a message and `external_id` being stored leaves the row
`SENDING` with no id, and the queue redelivers the job. Because the claim in D2 requires `QUEUED`, the
second job finds `SENDING`, **does not call the provider**, and takes the unconfirmed path: if
`sending_started_at` is younger than 60 s it throws a retryable error (the retry is the wait; a
receipt carrying our opaque id may arrive and set `external_id` through D10); if older, the row
becomes `FAILED` with code `outcome_unknown` (class `TRANSIENT`, flagged `unconfirmed` in the failure
JSON). The UI wording for that flag is "could not confirm delivery — resend?", and resend is the
explicit action of D12. This is the one at-least-once hole that cannot be closed without provider
idempotency; the design makes it visible instead of hiding a duplicate.

### D12. Resend, status and assignment endpoints

- `POST /conversations/:id/messages/:messageId/resend` — one conditional statement
  `UPDATE … SET status='QUEUED', failure=NULL, attempts=0 WHERE id=$1 AND status='FAILED' AND
  direction='OUTBOUND'` plus a `publish`; zero rows → `409`. A window-closed resend re-runs the D3 API
  check first (`422` while closed).
- `PUT /conversations/:id/status { status }` (`OPEN|PENDING|RESOLVED`; customer conversations only,
  `400` otherwise) and `PUT /conversations/:id/assignee { userId | null }` (target must be an active user
  of the tenant: `400` with a field error otherwise). Both reuse D5's helpers.
- `POST …/messages` accepts `visibility: 'PUBLIC' | 'INTERNAL'` (default `PUBLIC`). `INTERNAL` is valid
  only in customer conversations; it skips the window, the queue, the claim and the reopen, is stored
  `SENT`, and does **not** touch `last_message_at`, `last_message_preview` or `awaitingReply` (the
  inbox ordering is about the customer). Internal-conversation behaviour is untouched.

### D13. Web

The composer gets two modes (Reply / Internal note) in customer conversations; when the window is
closed the Reply mode is replaced by an explanation (the 24-hour rule, "last customer message …") and
Internal note stays. Own outbound bubbles show a footer: clock (queued/sending), one tick (sent), two
(delivered), two accent (read), or a red mark with the failure title and a Resend button (not for
`WINDOW_CLOSED`). The header gets a status control and an assignee picker. The existing
`chat.inbox-changed.v1` and the new `chat.message-updated.v1` both call the existing re-read path in
`chat-sync.ts`; neither patches the cache. Delivery state strings live in `chat.json`; failure titles
are rendered from our `failure.code` mapping with the provider's title as a fallback, never raw
provider text as the only message.

## Risks / Trade-offs

- **Strict FIFO is not provable in API e2e** (pg-boss is mocked). The pure parts (claim, classes,
  bounded attempts, unconfirmed path) are tested against the real database by calling the delivery
  service directly; the ordering/retry behaviour of the real queue is checked live on the dev stack
  (task group "Live verification") with two quick replies and a scripted `transient-once`.
- **One slow job delays its conversation** for up to the 15 s send timeout times the attempt bound,
  by design. Other conversations are unaffected.
- **Unconfirmed deliveries become visible failures.** Acceptable and intended (D11); the alternative
  is a silent duplicate to a customer.
- **Receipt parking adds a table and a cron.** Needed: Meta receipts routinely beat the `external_id`
  write, and "drop quietly" loses the very ticks this phase exists to show.
- **`AUTH` fails instead of waiting** (D6): a short outage of credentials makes the user resend manually.
  Reversed in 3c with the health work.
- **Assigning inserts participant rows for customer conversations.** Anything that lists "my internal
  conversations" must filter by `kind`; the existing `list()` goes through `participants.some` and would
  now also return assigned customer conversations in the internal list. Task 5.x makes that filter
  explicit and covers it with a test.
- **`ApiError.code` is a closed set shared by every client.** Adding a code is a contract change; it is
  regenerated and covered by the error-handling test in the same change.
- **Worker `fetchSockets` is unverified** (D9) — handled as the first spike with a stated fallback.

## Migration Plan

One migration: new `chat_messages` columns (`failure jsonb`, `attempts int default 0`,
`sending_started_at`, `sent_at`, `delivered_at`, `read_at`), the lookup index for receipt folding
(`(channel_id, external_id)` already unique-partial from 2a — reused; add `(tenant_id, id)` only if
missing), `channel_pending_statuses` with RLS `ENABLE` + `FORCE`. Additive; existing rows keep their
values (inbound rows have `status='SENT'`). No backfill. Rollback is dropping the new columns and table
(no data worth keeping before the first real reply).

## Open Questions

None block implementation. Recorded assumptions to confirm with the owner when convenient: replying
auto-assigns (D5), replying reopens a resolved conversation (D5), only the assignee is notified of
inbound messages (D8), authentication failures fail the message until 3c (D6).

## Documentation to promote

Before archive: D1–D5, D10, D11 move into `docs/chat.md` §4.8/§4.10 and `docs/whatsapp-channel.md` §4.4/§4.5
("as built" note, including the D6 deviation); the ordered queue and the sweep into
`docs/event-driven-architecture.md`; the new signal into `docs/realtime.md`; the new code into
`docs/error-handling.md`.
