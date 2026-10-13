# Design

## Context

State of the code after CHAT-0.2b (0.2c — notifications — is planned, not built):

- `conversations` has `kind` (`INTERNAL`/`CUSTOMER`) and `access` (`private` only). The single access
  function `ConversationAccessService.assertParticipant` answers 404 for anyone who is not a
  participant, and its `canSee()` has an unhandled `tenant` branch reserved for exactly this change
  (`docs/chat.md` §4.4, `docs/whatsapp-channel.md` §4.7).
- `ChatService.insert()` increments `last_seq` under the conversation row lock, inserts the message,
  bumps unread counters of participants and emits `chat.message-created.v1` to participants'
  personal rooms after commit.
- Every socket joins the tenant room (`tenantRoom`) and its user room; the worker has a headless
  Socket.IO emitter on the same Valkey adapter (`apps/worker/src/realtime/`).
- Public (unauthenticated) routes exist (`@Public()`), and so do the named rate limits
  (`@RateLimit`). The tenant of a public request is resolved by a `SECURITY DEFINER` lookup
  (`resolve_tenant(slug)`); there is no `rawBody` capture yet.
- `CryptoService` (`libs/shared/src/crypto`, AES-256-GCM `v1:`) exists. `libphonenumber-js` is a dependency.
- Prior decisions this change implements, not reopens: `docs/whatsapp-channel.md` §0 (WhatsApp only,
  provider-neutral core), §4.1 (model), §4.2 (adapter), §4.3 (webhook), §4.6 (identity), §4.7
  (access). Owner decisions O-W1…O-W5 (§7) accepted 2026-10-13. Live facts about the provider API:
  `docs/whatsapp-research/live-probe-2026-10-13.md`.

## Goals / Non-Goals

**Goals:**
- Run the whole inbound path — public route, signature over raw bytes, raw store, queue, ingest,
  inbox — against a fake provider, with no WhatsApp account.
- Land the schema and invariants whose retrofit is expensive: `provider` apart from `type`; raw bytes
  in the adapter contract; partial unique `external_id`; `SENDING` in the status scale;
  `customer_last_message_at` from provider time; a contact without a customer; several addresses per
  contact; `channel_unroutable_events` without a tenant.
- Keep the adapter contract so that Meta (CHAT-3a) and a later second provider are adapters.

**Non-Goals:**
- Sending, statuses, templates, media, assignment actions, internal notes (2b/2c).
- Notifications for customer conversations: they need an assignee to be addressed; 2b.
- The real WhatsApp adapter, account-connection UI and number sync (3a). Here a fake account is
  created by a dev-only action.
- A second channel type, a second account per provider, Embedded Signup.

## Decisions

### D1. Adapter contract, registry and the fake provider

`libs/shared/src/channels/` holds the `ChannelAdapter` interface (`provider`, `type`, `capabilities`,
`verifyWebhook(req, creds)`, `handshake?`, `parseWebhook(raw: Buffer, ctx): NormalizedEvent[]`) and a
`provider → adapter` registry. Optional capabilities (templates, media, health, connection, read
receipts) are separate interfaces and are **not** written here. `NormalizedEvent` is a Zod
discriminated union in `libs/contracts`; 2a implements `message` and `unsupported` (anything the core
cannot yet use is stored and marked so, never dropped); the other kinds are added by the phase that
consumes them. Provider specifics live in `providerMeta`, which the core does not read.

`FakeChannelAdapter` has its own simple wire format (a JSON body mirroring `NormalizedEvent`) and signs
with HMAC-SHA256 over the raw bytes in a header, using the account's secret — the same shape as Meta's
`X-Hub-Signature-256`, so the verification path exercised is the real one. It is registered only when
development tooling is enabled (`CHAT_DEV_TOOLS`), which also gates the simulator and the fake-account
action. *Alternative:* simulate by calling ingest directly. Rejected: it would skip the signature, the
raw store, the acknowledgement rules and the rate limit — the parts most likely to be wrong.

### D2. Data model

Tables follow the MT-2 template (RLS `ENABLE`+`FORCE`, `tenant_id` with the DB default, composite FKs):
`messaging_accounts` (`UNIQUE (tenant_id, provider)`, `webhookKey` unique across tenants, encrypted
credentials and app secret, `verifyToken`, `status`), `channels` (`UNIQUE (provider, external_id)` among
non-missing), `channel_contacts`, `channel_contact_addresses` (`UNIQUE (channel_id, kind, value)`),
`channel_webhook_events` (raw body, `UNIQUE (channel_id, payload_hash)`, `state`). `conversations` gains
`channel_id`, `contact_id`, `customer_last_message_at`, `assignee_id`, and a partial
`UNIQUE (contact_id) WHERE status <> 'RESOLVED'`. `chat_messages` gains `direction`, `channel_id`,
`external_id`, `sender_contact_id`, `provider_meta`, a partial `UNIQUE (tenant_id, channel_id,
external_id) WHERE external_id IS NOT NULL`, and `MessageStatus` gains `SENDING`.
`channel_unroutable_events` has **no** `tenant_id` and no RLS; it is written only through a
`SECURITY DEFINER` function and read by platform-api. `resolve_account_by_key(provider, key)` is
`SECURITY DEFINER` in the style of `resolve_tenant`, returning only tenant id and account id.

`messaging_accounts` stores `externalId` (WABA id) as a plain indexed column from day one although the
fake provider has none: the app-level webhook of CHAT-3a routes by it, and adding it later would need a
backfill that FORCE RLS makes awkward (AGENTS.md rule 17). Retrofit cost, not speculation.

### D3. The public webhook

One controller, `/public/channels/:provider/:webhookKey` (GET handshake, POST delivery); `@Public()`,
named limit `channel-webhook`. The Nest application is created with `rawBody: true` and the route has a
body limit of 3 MB (Meta batches up to 1000 updates). The order for POST is: resolve the account by key
(`SECURITY DEFINER`), enter the tenant context, decrypt the secret, **verify the signature over
`req.rawBody`**, then one `withTenantTx` that inserts the raw event and `publish`es
`channels.ingest-webhook`, then `200`. Outcomes:

| Situation | Response | Effect |
| --- | --- | --- |
| signature missing/invalid (known key) | 401 | nothing written |
| unknown key / disabled account | 200 | `channel_unroutable_events` (no body, reason) |
| signed, body unparsable | 200 | event stored as `FAILED` |
| signed, channel unknown/disabled/foreign | 200 | event stored, ingest records unroutable per change |
| signed, valid | 200 after commit | event stored, job queued |
| byte-identical repeat | 200 | unique `payload_hash` → no second row |
| transaction fails | 5xx | provider retries |

An unknown key answers **200 before** any signature check, so the response cannot be used to enumerate
keys; a known key with a bad signature answers 401, which is what the provider needs to see during
setup. The tradeoff — a 401 reveals that a key exists — is accepted: the key is a 128-bit random value,
not a guessable name. *Alternative:* 200 for everything. Rejected: it would hide a misconfigured
secret from the person setting the channel up.

### D3a. The webhook block of the account

The admin read of the account (`GET /settings/messaging`) also returns a *webhook block*: the public
address, the verify token, `signingSecretSet`, `lastDeliveryAt` and the last-24-hour counts by `state`
of `channel_webhook_events` (plus unroutable events of that account). The address is the configured
public base (`CHANNEL_WEBHOOK_BASE_URL`, an env var of the API; in development the same tunnel address
that `WHATSAPP_WEBHOOK_BASE_URL` holds for the probe) plus `/public/channels/:provider/:webhookKey`;
with no base configured the block reports `address: null`. The verify token and address are returned
to administrators only. This block works for the fake provider with no external service: its webhook
is the simulator's own path (D9), so the whole "address → delivery → counters" loop is visible in
development. **What is deliberately not here:** telling Meta to use the address (`POST
/{waba}/subscribed_apps`), reading the subscription back, and the "subscribed / not subscribed /
could not check" state. That is `docs/whatsapp-feature-flows.md` §F3 in CHAT-3a, and it carries a known
conflict (a WABA has one callback override; see `docs/whatsapp-channel.md` §8.1).

### D4. Ingest

`channels.ingest-webhook` is a command with one consumer, in the worker, keyed per channel and sender
(`singletonKey = channelId:address`) so one contact's messages are ordered while others run in
parallel. It parses with the adapter, then for each `message` runs **one transaction**: find or create
the contact and address (D5) → find or open the conversation (D6) → `INSERT … ON CONFLICT DO NOTHING
RETURNING` on `(tenant_id, channel_id, external_id)`; only a returned row proceeds to take the next
`seq` (the same increment-and-return as `ChatService.insert`), update `last_message_at`,
`customer_last_message_at` (provider time) and the preview, and register the after-commit signal. Dedup
is the index, never a prior `SELECT`; `MessageInboxService.runOnce` guards only the database effects of
a redelivered job. A poison payload sets the event `FAILED` and does not throw, so the queue is not
wedged. The sequence is taken **after** the insert-or-skip so a duplicate does not burn a `seq`.
*Alternative:* take the `seq` first and discard on conflict. Rejected: it leaves holes the gap
detector (`chat.md` §4.3) would then chase forever.

### D5. Contacts, addresses and phone matching

An address is stored as received; a phone address also stores the E.164 form (`libphonenumber-js`, the
rules of `apps/api/src/common/phone.ts`), and lookup tries both. Auto-link to a customer runs only for a
**new** contact and only when exactly one customer (or one customer contact) of the tenant has that
phone (`customers.phone` / `customer_contacts.phone`); otherwise the contact stays unlinked. Linking
afterwards is an explicit user action. No automatic merge of contacts, ever; that is a human decision
recorded for CHAT-3c (identity events).

### D6. Conversations for contacts

One open conversation per contact is enforced by the partial unique index, not by the code that looks
for one: the loser of a race catches the unique violation and re-reads. The reopen window (default 24 h,
`channels.settings`) is evaluated against the conversation's last message time: a `RESOLVED`
conversation inside the window is reopened to `OPEN`, outside it a new one is created. `RESOLVED` is
not reachable by a user in 2a (that action is 2b), but ingest must already honour it, and tests set it
directly.

### D7. Access

`ConversationAccessService` gains the `tenant` branch: for `access = 'tenant'` any active user of the
tenant passes (RLS has already fixed the tenant), with no membership row required. The returned shape
makes `membership` optional for such conversations; the callers that need a read cursor (mark-read,
unread counts) treat a missing membership as "no personal state yet" and do nothing rather than
fabricate rows. Internal conversations are untouched, including the negative e2e that an admin cannot
read a private one. This is the single access function; no second one is introduced.

### D8. The inbox and the live signal

Read side: `GET /chat/inbox?filter=mine|unassigned|all&cursor=` returns customer conversations ordered
by `last_message_at`, each with channel, contact, linked customer, preview, `awaitingReply` (last
message is inbound) and `assigneeId`. "Mine" matches `assignee_id = me`, which is empty until 2b adds the
action. Personal unread counters are deliberately absent: a shared inbox has no per-person cursor until
a conversation is assigned (`whatsapp-channel.md` §4.7). Write side: after commit the worker emits
`chat.inbox-changed.v1 { conversationId, occurredAt }` to the **tenant room** through its headless
emitter. The notice carries no state, so rule 15 of AGENTS.md (payloads need a counter and a resync) does
not apply; the client invalidates its inbox query and, if that conversation is open, its transcript.

### D9. Simulator

`POST /dev/chat/simulate` (only with `CHAT_DEV_TOOLS`, ADMIN) builds a fake-provider body and posts it to
the public webhook of the tenant's fake channel **over HTTP to itself**, signed with the account secret,
so every layer runs. `pnpm chat:simulate` is a thin CLI over the same endpoint. The web has a small
dev-only panel in the inbox that calls it. Production builds neither register the route nor ship the panel.

### D10. Platform visibility of unroutable events

platform-api exposes a read-only list of `channel_unroutable_events` (reason, provider, key hash, time,
address), enough for an operator to answer "why does a customer's webhook do nothing". Replay and
retention tooling are CHAT-2c.

### D11. Module graph

`chat` gains `customers` and `messaging` in `dependsOn` (customers for phone matching and for creating a
customer from a contact — through the customers module's exported service, not its tables), and its
`paths` gain `apps/worker/src/chat/`, `libs/shared/src/channels/` and
`libs/shared/src/messaging/definitions/chat.messages.ts`. `pnpm modules:check --strict` is the gate. If
0.2c lands first it will already have added `messaging`; the edit is idempotent.

## Risks / Trade-offs

- **A bad signature answers 401 and thereby confirms a key.** → Keys are 128-bit random; unknown keys
  answer 200; the rate limit applies per key and address.
- **Tenant-wide visibility of customer conversations is coarse.** → It is owner decision O-W1; the
  single access function is where RBAC will narrow it later.
- **`rawBody: true` changes body parsing for the whole API.** → Only buffers a copy; checked by the
  existing e2e suites in task 3.4; the 3 MB limit is route-scoped.
- **Ordering per sender relies on `singletonKey`, not on a global order.** → The `seq` is the order of
  record; provider order is not trusted (live probe confirms Meta gives none).
- **A dev-only fake provider shipped in the same code.** → Registered and routed only under
  `CHAT_DEV_TOOLS`; a test asserts the routes are absent without it.
- **Notifications for customer conversations are absent in 2a.** → Stated; an agent sees inbound only
  by looking at the inbox (and the live signal). Closed by 2b with assignment.

## Migration Plan

One Prisma migration adds the tables, the columns, the partial indexes, the RLS policies and the two
`SECURITY DEFINER` functions, plus the enum value. All new `conversations`/`chat_messages` columns are
nullable or defaulted, so existing internal rows need no backfill (AGENTS.md rule 17: nothing here
updates tenant rows). Rollback is the reverse migration; no data exists in the new tables until a fake or
real account is created. Deploy order: migration → API/worker together (the worker needs the new
subscriber before the API starts queueing). No feature flag beyond `CHAT_DEV_TOOLS` for the fake provider.

## Open Questions

- Where the contact card and the link action live in the web layout (list column vs context panel).
  Resolved in implementation by following `docs/frontend/layout-structure.md`; it does not change the
  API.
