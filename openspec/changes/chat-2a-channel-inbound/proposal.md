# Proposal

## Why

Chat today is internal: people talking to colleagues. The product goal is a conversation with a
**customer** over WhatsApp (`docs/whatsapp-channel.md`). The expensive and risky part is not
WhatsApp itself but the channel core underneath it: a public signed webhook, a raw event store,
idempotent ingest, identity of the person on the other end, and a customer inbox with its own access
rule. If that core is built against a real provider first, every defect looks like a Meta problem.
So CHAT-2a builds it against a **fake provider**, with a simulator that sends signed inbound
messages, and ships a screen that can be demonstrated before any WhatsApp account is involved.

This is **CHAT-2a**: inbound only. Replying (CHAT-2b), media and operator tools (CHAT-2c) and the
real WhatsApp adapter (CHAT-3a…3c) are separate changes. The schema and invariants that are expensive
to retrofit (`docs/whatsapp-channel.md` §6, "Інваріанти, які закладаються в 2a") land here.

## What Changes

- **A messaging account and its channels.** One account per tenant (provider `fake` now,
  `meta_cloud` in CHAT-3a) holding the credentials and a public webhook key; a *channel* is one
  phone number of that account. A tenant admin can see them. For `fake`, an account and a channel
  are created by a dev-only action (no real credentials exist).
- **A public webhook** `/public/channels/:provider/:webhookKey`: GET handshake, POST with a signature
  verified over the **raw bytes**. A valid POST is stored as a raw event and acknowledged with
  `200` in the same transaction that queues its processing. An unknown key, a disabled channel or
  an unparsable body is acknowledged too (never an oracle, never a retry storm) and recorded; a bad
  signature is rejected and writes nothing. A named rate limit protects the route.
- **Ingest** in the worker: an inbound message becomes a stored chat message exactly once, however
  often the provider repeats it (partial unique index on the provider's message id), ordered by the
  conversation's `seq`, with the provider's own timestamp driving the 24-hour customer-message clock.
- **Contacts and addresses.** The person on the other end is a *channel contact* with one or more
  addresses (phone, later BSUID); a contact exists without a customer. A phone that belongs to
  **exactly one** customer links automatically; otherwise the contact stays unlinked and an agent
  links it or creates a customer from the conversation. No customer is ever auto-created
  (O-W5, accepted 2026-10-13).
- **Customer conversations.** A `CUSTOMER` conversation per contact (one open at a time, reopened
  within 24 h of the last message — O-W4) visible to **every active user of the tenant**
  (`access = 'tenant'`, O-W1) through the single access function; internal conversations stay
  private. Filters: mine / unassigned / all.
- **Web:** a customer inbox in the Chat area (channel and contact on each row), a contact card with
  customer linking, and a **simulator** (dev-only endpoint and `pnpm chat:simulate`) to receive
  messages without a provider.
- **Unroutable events** without a tenant (a webhook for an unknown key) are recorded in a table with
  no RLS, written only by a `SECURITY DEFINER` function and readable only by platform-api.
- **Docs:** `docs/chat.md` §7, `docs/whatsapp-channel.md` §6 status, `docs/event-driven-architecture.md`
  (topology), `docs/roadmap.md`, `docs/modules.md` if the graph changes.

## Capabilities

### New Capabilities

- `chat/channels`: the tenant's messaging account and its channels; how a channel exists, what an
  admin sees, and that credentials are never returned in clear.
- `chat/inbound`: the public webhook contract (handshake, signature, acknowledgement rules,
  unroutable events), exactly-once ingest of inbound messages, and the contact/address model.
- `chat/customer-inbox`: customer conversations — who may see them, one open conversation per
  contact, filters, linking a contact to a customer, and the simulator.

### Modified Capabilities

- `chat/conversation`: "Participation is the only way to see a conversation" now applies to
  internal conversations only; customer conversations follow `chat/customer-inbox`.

## Impact

- **Database:** new tables `messaging_accounts`, `channels`, `channel_contacts`,
  `channel_contact_addresses`, `channel_webhook_events`, `channel_unroutable_events` (no tenant, no
  RLS) with RLS migration, `resolve_account_by_key()` `SECURITY DEFINER`; new columns on
  `conversations` (`channelId`, `contactId`, `customerLastMessageAt`, `assigneeId`) and
  `chat_messages` (`direction`, `channelId`, `externalId`, `senderContactId`); `MessageStatus` gains
  `SENDING` (unused until 2b but a retrofit later is costlier); partial unique indexes.
- **Contracts:** `libs/contracts/src/chat/` (channel, contact, inbox schemas; `NormalizedEvent`);
  REST for channels, inbox list, contact, link-customer. `pnpm openapi:generate && pnpm web:codegen`.
- **Shared:** adapter registry and `FakeChannelAdapter` (`libs/shared/src/channels/`), ingest logic.
- **API:** public channel controller (raw body, 3 MB route limit, `@RateLimit('channel-webhook')`),
  channel/inbox/contact controllers, `ConversationAccessService` `tenant` branch, dev simulator.
- **Worker:** `channels.ingest-webhook` subscriber.
- **Platform-api:** read endpoint for `channel_unroutable_events` (minimal).
- **Web:** inbox list, contact card, link dialog; `locales/en/chat.json`.
- **Module graph:** `chat` gains `customers`, `messaging`; new paths for the worker and shared dirs.
- **Tests:** webhook e2e (handshake, signature, replay, unroutable, poison body), ingest dedupe under
  `Promise.all`, access (tenant branch positive, tenant B negative, internal stays private), linking
  rules, adapter contract tests on the fake.
- **Not touched, deliberately:** sending, statuses, templates, media, assignment actions and
  internal notes (2b/2c); notifications for customer conversations (needs assignment, 2b); the real
  WhatsApp adapter and account connection UI (3a).
