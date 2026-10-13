# Proposal

## Why

After CHAT-2a a customer's message reaches a shared inbox, but nobody can answer it: posting into a
customer conversation is refused with `422` on purpose, and a conversation has no owner, no workflow
state and no way to tell the team "this one is mine". The product goal is a *dialogue* with a
customer. The hard part of a reply is not the text box; it is the **delivery**: an at-least-once
queue talking to an external provider, a 24-hour freeform window the provider enforces, failures of
seven different kinds that need different handling, and delivery receipts (sent / delivered / read)
that arrive later, out of order, or before we have even recorded the provider's id.

CHAT-2a proved the inbound half against a fake provider. CHAT-2b proves the outbound half the same
way, so that when the real WhatsApp adapter arrives (CHAT-3a) every defect that is *ours* — ordering,
idempotency, state folding, the "did it actually send?" hole — is already found and tested, and only
the Meta-specific mapping remains.

This is **CHAT-2b**: reply, delivery state and the minimum workflow around a conversation. Media and
operator tools are CHAT-2c; templates, the real adapter and its error mapping are CHAT-3a/3b.

## What Changes

- **A reply to a customer.** An agent posts text into a customer conversation. The request is
  answered at once with the message stored as *queued*; a worker sends it through the channel's
  adapter. Outside the provider's freeform window the request is refused (`422`,
  `CHANNEL_WINDOW_CLOSED`), and the worker checks the window again before sending because a job can
  wait in the queue across the boundary.
- **A delivery pipeline** `QUEUED → SENDING → SENT`, or `FAILED`. Sends for one conversation are
  strictly ordered; a failure never blocks that ordering forever (a bounded number of attempts, and
  every non-retryable outcome becomes `FAILED` instead of an exception).
- **Failures are classified**, not stringified: window closed, permanent, policy, rate-limited,
  authentication, transient, "needs a human". Each class has a defined effect. A message whose
  delivery cannot be confirmed is marked failed *as unconfirmed* and offers an explicit resend rather
  than a blind retry that could send twice.
- **Delivery receipts.** A provider status event moves a message forward along
  `SENT → DELIVERED → READ` and never backwards; a late `SENT` never overrides a `FAILED` that was
  decided later and a `FAILED` never overrides a delivery. A receipt for a message we cannot find yet
  is parked and applied when the id is recorded. The browser learns by a *re-read* signal.
- **Workflow around a conversation.** Status `OPEN` / `PENDING` / `RESOLVED`, assignment to a user,
  and internal notes that only colleagues see and that are never sent. Replying to an unassigned
  conversation assigns it to the replier; replying to a resolved one reopens it. Each of these writes
  a system entry into the transcript and an activity on the conversation (and on the linked
  customer). An assigned user is notified about a new inbound message.
- **Web:** the composer works in a customer conversation (reply / internal note), shows the closed
  window as an explanation instead of a dead box, delivery ticks and the failure reason on each own
  message with a resend action, and the conversation header gets status and assignee controls; the
  "mine" inbox filter now means something.
- **Fake provider:** `send` with deterministic failure scenarios and a simulator for delivery
  receipts, so every path above is exercised without a provider account.

## Capabilities

### New Capabilities

- `chat/outbound`: posting a reply to a customer conversation — the freeform window, the queue and
  its ordering, the delivery attempt, error classes and their effects, the unconfirmed-delivery
  rule, and explicit resend.
- `chat/delivery-status`: provider receipts — forward-only folding, the failure exception, parking of
  receipts that arrive early, and the signal that tells the browser to re-read.
- `chat/workflow`: conversation status, assignment, internal notes, the system entries and
  activities they write, and the notification of an assignee.

### Modified Capabilities

<!-- None under openspec/specs/. The one behaviour this change reverses — "posting into a customer
     conversation is refused" — was introduced by chat-2a-channel-inbound, which is not archived
     yet, so it is superseded by `chat/outbound` here and recorded in the design. -->

## Impact

- **Database:** `chat_messages` gains `failure` (JSON), `attempts`, `sentAt`, `deliveredAt`, `readAt`;
  new table `channel_pending_statuses` (RLS, FORCE); an index to find a message by provider id for
  status folding; `conversations` is unchanged (its columns arrived in 2a). One migration.
- **Contracts:** `NormalizedEvent` gains `status`; message response gains delivery fields and
  `failure`; request gains `visibility`; new `chat.message-updated.v1` socket event; new error code
  `CHANNEL_WINDOW_CLOSED`; activity types for the conversation; new system entry types; OpenAPI and
  both generated clients.
- **Messaging:** a new command `channels.deliver-outbound` on a strictly ordered queue keyed by
  conversation; a bounded sweep for parked receipts. Topology and worker subscribers change together.
- **Adapter contract:** `ChannelAdapter` gains `send` and a typed send error; the fake adapter gains
  deterministic outcomes. The contract test suite grows so the real adapter must pass it.
- **API (`apps/api/src/chat/`):** `ChatService.post` for customer conversations, new endpoints for
  status, assignment, resend; the single access function is reused unchanged.
- **Worker:** delivery subscriber; ingest also folds `status` events and notifies an assignee.
- **Web (`features/chat`):** composer, bubble footer, header controls, system-entry texts.
- **Docs:** `docs/chat.md` (§4.8/§4.10/§7), `docs/whatsapp-channel.md` §6 and §4.4/§4.5 "as built",
  `docs/event-driven-architecture.md` (the ordered queue), `docs/roadmap.md`, `docs/realtime.md`.
- **Depends on** `chat-2a-channel-inbound` (code and spec); archive that change first so the spec
  for posting into customer conversations is replaced rather than contradicted.
