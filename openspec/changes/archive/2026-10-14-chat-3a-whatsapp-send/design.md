# Design

## Context

State after CHAT-2b (archived) and the plan reorder of 2026-10-14:

- `messaging_accounts` already has `external_id` (the WABA id), `credentials` and `app_secret`
  (encrypted with `CryptoService`), `token_kind`, `token_expires_at`, `token_checked_at`, `scopes`,
  `status` (`CONNECTED/NEEDS_REAUTH/DISABLED`), `last_sync_at`, `last_error`; `UNIQUE (tenant, provider)`.
  There is no `app_id`. `channels` has display number, verified name, quality rating, `account_mode`,
  `limits` JSON, `is_enabled`, `is_default`, `provider_missing_at`, `synced_at`, with a partial unique on
  `(provider, external_id)` across tenants. Nothing writes `meta_cloud` rows yet: the only accounts are
  fake ones created by the dev tool.
- The adapter contract has `verifyWebhook`, `handshake`, `parseWebhook`, `send(ctx, creds)` with
  `OutboundContext { channelExternalId, to, messageId, body, attempt, signal }`, `ChannelSendError` with
  the seven classes, and `capabilities { freeformWindowHours, maxTextLength }`. `createChannelAdapterRegistry`
  registers `fake` only under `CHAT_DEV_TOOLS`. There is a shared adapter contract test suite.
- Delivery (`ChannelDeliveryService`) claims `QUEUED → SENDING`, re-checks the window through
  `replyWindow`, calls `adapter.send` outside any transaction, and settles (`SENT` + `external_id`, `FAILED`
  with a class, or back to `QUEUED` for a retry). Ordering is a `key_strict_fifo` queue per conversation.
  `AUTH` marks the account `NEEDS_REAUTH`.
- `replyWindow(adapter, customerLastMessageAt, now)` is the one window rule (API, worker, conversation
  response). `customerLastMessageAt` is set only by inbound messages — in this slice it is always null.
- The settings screen lists accounts for an admin with `credentialsSet` / `appSecretSet` and a webhook
  block; there is no way to create a real account from the UI. A message's `payload` JSON is empty for text.
- The live probe (`docs/whatsapp-research/live-probe-2026-10-13.md`, `scripts/whatsapp-probe.ts`) verified on
  Graph v23.0: `debug_token` with an app token (`APP_ID|APP_SECRET`) for a system-user token, the WABA
  and phone-number reads, one template send (`message_status: "accepted"`) and one text send in an open
  window (no `message_status`). Not verified: real error codes, `biz_opaque_callback_data` placement.
- The WABA is shared with another application (`legacy-api`) that holds the WABA's webhook override. This
  slice subscribes to nothing, so it cannot disturb it.
- `ApiError.code` is a closed set; `AllExceptionsFilter` accepts a domain-named code from it.

## Goals / Non-Goals

**Goals:**
- The first real message from the system to a phone, through the same queue, ordering and failure
  handling that was proven on the fake provider.
- A connection that proves what it can about the token *before* trusting it, and says what it could not prove.
- Every provider error ends in one of the existing classes; nothing new is needed in the delivery core.
- Secrets never leave the encrypted columns: not in responses, logs, error text or the call log.
- All of it testable without the network (a local Graph stub), plus one repeatable live check.

**Non-Goals:**
- Webhooks in any form, inbound messages, receipts, mark-as-read, typing, window tracking from inbound
  (CHAT-3b); template sync, picker, variables (3c); media (2c); health checks, scheduled token checks and
  scheduled synchronisation (3b/3c); Embedded Signup; a platform-wide Meta application.
- Registering or verifying a phone number, business profile, payment — done in Meta Business Manager.

## Decisions

### D1. A small Graph client, owned by the adapter layer

`libs/shared/src/channels/meta-cloud/graph-client.ts` — a class over `fetch`:
`request({ method, path, query?, body?, token, operation })`. Base URL `META_GRAPH_BASE_URL`
(default `https://graph.facebook.com`), version `META_GRAPH_VERSION` (default `v23.0`; the probe's value).
The token goes in `Authorization: Bearer`, never in the URL. A fixed timeout (10 s; sends use the
caller's `AbortSignal`). A non-2xx answer or a Graph `error` object becomes `MetaApiError { httpStatus,
code, subcode, title, fbtraceId }`; the message text is passed through a redactor that replaces any
substring of the token (8+ characters) with `***`, because Meta sometimes echoes parts of what it was
sent. Every call reports `{ operation, method, path, status, durationMs, errorCode, errorTitle }` to an
optional callback, which is how the call log is fed (D8); the client itself writes nothing.

*Alternative: the official SDK / axios.* Rejected: one dependency and a version coupling for six
endpoints; `fetch` with a redactor is thirty lines and trivially stubbed by pointing the base URL at a
local server in tests.

### D2. Verification: prove what the credentials allow, say what they do not

Connecting runs, in this order, stopping at the first failure and storing nothing until all pass:

1. **With app id + app secret:** `GET /debug_token?input_token=<token>` using the app token
   `<appId>|<appSecret>` as the bearer. Require `is_valid`, `data.app_id == appId`, and both scopes
   `whatsapp_business_management` and `whatsapp_business_messaging`. Record `type` (→ `token_kind`),
   `expires_at` (0 → never → `token_expires_at = null`; otherwise the timestamp), and `scopes`.
2. **Always:** `GET /{waba}?fields=id,name,currency,timezone_id,health_status` with the token. Code `190`
   → invalid token; `100`/`200` → no access to this WABA; anything else → a verification error with the
   provider's title. The WABA name becomes the account's display `name`. `health_status` is *shown*, never
   used to block: on the test WABA it is `BLOCKED` (141006) and sends still worked (probe, point 4).
3. **Without app credentials:** step 1 is skipped; `token_kind = 'UNKNOWN'`, `scopes = []`, and the answer
   marks both as "not verified". A token with insufficient scopes then fails later, at send time, with
   an `AUTH`-class error — acceptable and said plainly in the UI.

Only after the steps pass is the account written, in one `withTenantTx`, together with the encrypted
token/secret/app id; then the number sync (D3) runs. If the sync fails the account stays connected with
`last_error` set and the UI offers "Refresh" — a working token is not thrown away because a list call
timed out.

A *temporary* token is any whose `expires_at` is non-zero; the UI shows the countdown. When Meta later
answers `190` on a send, the existing `AUTH` path marks the account `NEEDS_REAUTH`.

*Alternative: always call `debug_token` with the token itself as bearer.* Plausibly works for tokens of
the app's own admins, but it is unverified and Meta documents the app token; it is a one-line follow-up
if the live check (task 11) shows it works and the secret turns out to be a usability burden.

### D3. Numbers come from Meta; we never invent a channel

`GET /{waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,name_status,status,
account_mode,code_verification_status,platform_type,throughput&limit=50`, following `paging.cursors.after`
(bounded at 20 pages). If Graph rejects the field list, retry once with the minimal set
`id,display_phone_number,verified_name,quality_rating` (probe point 10). Per number, in one transaction:

- `INSERT INTO channels … ON CONFLICT (provider, external_id) WHERE provider_missing_at IS NULL DO NOTHING
  RETURNING id`; no row returned and no existing row of ours → the number belongs to another tenant →
  skip and report it (the unique index is global, RLS only hides the other tenant's row).
- An existing channel of this account is updated (display number, verified name, quality, mode, and a new
  `provider_meta` JSON: `nameStatus`, `codeVerificationStatus`, `status`, `platformType`, `throughput`); a
  number seen again after being missing clears `provider_missing_at`.
- Numbers of the account absent from the list get `provider_missing_at = now()`; never deleted.
- New channels start disabled; `code_verification_status = NOT_VERIFIED` is normal on a test number and is
  not an error (probe point 7).

`channels` gains `provider_meta jsonb default '{}'` (additive). One default per account is a partial
unique index `(account_id) WHERE is_default AND provider_missing_at IS NULL`; changing the default takes
`SELECT … FOR UPDATE` on the account row and flips both flags in one statement pair, so two admins cannot
produce two defaults. Enabling a missing channel is refused.

Scheduled synchronisation is not in this slice: the button is enough while one admin connects one
account, and the health work that justifies a cron is 3c.

### D4. `MetaCloudAdapter.send`: text and template by name

`POST /{channelExternalId}/messages` with `{ messaging_product: 'whatsapp', recipient_type: 'individual',
to: <digits>, type: 'text', text: { body, preview_url: false } }`, or `type: 'template', template: { name,
language: { code } }`. Success is `2xx` with `messages[0].id` → `externalId`; `message_status` is neither
required nor trusted (the probe saw it only on templates). A 2xx without `messages[0].id` is `TRANSIENT`
`no_message_id` (we cannot tell whether it was accepted — the existing unconfirmed machinery then applies
on a redelivery). `OutboundContext` gains an optional `template?: { name, language }`; `body` stays the
display text. `capabilities` gains `templates: boolean` and `windowEnforcement: 'local' | 'provider'`
(Meta: `templates: true`, `windowEnforcement: 'provider'`, `freeformWindowHours: 24`, `maxTextLength: 4096`).

`biz_opaque_callback_data` (our message id, which CHAT-3b needs to match a receipt that beats the stored
`external_id`) is added at the top level of the request body. Its placement is **unverified** (plan §8):
the live check (task 11.2) confirms Meta accepts it; if it answers `100` the field is dropped and the
finding recorded for 3b, not worked around.

A template that needs variables is sent without them and fails at Meta (`132000/132001/132012/132016/
132018` → `PERMANENT`, with Meta's title); the UI does not offer variables until 3c.

### D5. One error table, in the adapter, from the plan

`meta-cloud/errors.ts` maps Meta's `error.code` (and HTTP status) to a class, title and provider code:

| Class | Meta codes |
| --- | --- |
| `WINDOW_CLOSED` | 131047 |
| `PERMANENT` | 131026, 131030 (title: recipient not on the allowed list), 131008, 131009, 100, 135000, 132000, 132001, 132012, 132016, 132018, 131052, 131053, any other 4xx |
| `POLICY` | 131049, 131050, 130497 |
| `RATE_LIMITED` | 130429, 131056, 80007 (retry-after honoured when given) |
| `AUTH` | 190, 0, 3, 10, 200 |
| `TRANSIENT` | 131000, 131016, 131057, 133004, any 5xx, network error, timeout |
| `HUMAN` | 131048, 131031, 130403, 131042, 131045 |

Unknown code: 4xx → `PERMANENT`, 5xx/other → `TRANSIENT`. The table lives in one file with the codes as
data so adding a code is one line, and a unit test pins every row. The provider's text is kept only as the
stored `title` after redaction and truncation to 200 characters.

### D6. The window is the provider's until we know better

`capabilities.windowEnforcement === 'provider'` changes one rule in `replyWindow`: when
`customerLastMessageAt` is null, `canReply` is `true` and `endsAt` is `null`. When it is known (CHAT-3b),
the local rule applies exactly as before, for every provider. Consequences, all through the one function:
the API accepts a first text into a started conversation; the worker's re-check passes; Meta's `131047`
fails the message as `WINDOW_CLOSED`; the existing UI then explains it (resend is already withheld for that
class) and the agent sends a template. A template skips the window check in both API and worker.

*Alternative: refuse text until a template was sent.* Rejected: it would block a legitimate reply to a
customer who wrote recently from another system (a real case for a number also used by an app); the
provider is the authority and answers in milliseconds.

### D7. A template message is a normal message with a payload

`POST /conversations/:id/template-messages { name, language, clientMessageId }` creates a `TEXT` message
(`direction OUTBOUND`, `QUEUED`) whose `payload` is `{ template: { name, language } }` and whose `body` is
the template name (so previews, search and the existing code that expects a body keep working). The
transcript renders it as a template bubble from the payload. Everything else is the reply path: the same
claim/reopen, the same `publish` with `singletonKey`, idempotent on `clientMessageId`. The delivery service
reads the payload and passes `template` to the adapter, and skips the window check. `name` is validated
(`^[a-z0-9_]{1,512}$`), `language` (`^[a-z]{2,3}(_[A-Za-z]{2,4})?$`). If the channel's adapter does not
declare `templates`, the request is a `422`.

### D8. `channel_logs`: what happened, never what was said

Table `channel_logs` (tenant-scoped, RLS ENABLE+FORCE): `id, tenant_id, account_id, message_id?,
operation ('verify'|'sync'|'send'), ok, http_status?, error_code?, error_title?, duration_ms, detail jsonb,
created_at`; indexes `(tenant_id, account_id, created_at desc)` and `(created_at)`. `detail` holds only
whitelisted keys: `endpoint` (path without query), `recipientLast4`, `providerMessageId`, `pages`,
`numbers`. `ChannelLogService.record(tx, entry)` builds the row from a typed input — there is no free-text
parameter — and runs the redactor over `error_title`. Sends log inside the settle transaction of the
delivery service; connect/sync log in their own short transaction after the HTTP call. A daily cron command
`channels.purge-logs` (`04:30`, system scope, `retryLimit: 1`) deletes entries older than 30 days.
`GET /settings/messaging/accounts/:id/logs?cursor&limit` is admin-only, newest first, keyset on
`(created_at, id)`.

*Alternative: log request and response bodies, masked.* Rejected: a body is message content; "masking" it
is a bet that the masker is complete. Logging only what a person needs to debug (which call, what code)
cannot leak content by construction.

### D9. Starting a conversation: one contact-resolution, shared

The contact/address/auto-link/conversation logic of `ChannelIngestService` (`resolveContact`,
`autoLinkCustomer`, `resolveConversation`) moves into `ChannelContactService` in
`libs/shared/src/channels/`, used by ingest and by `POST /chat/outreach { channelId, phone, name? }`
(an existing test suite — `chat-channels-ingest` — is the safety net for the move). Outreach: validate the
phone with the existing helpers (digits + E.164), require the channel to be enabled, not missing and of the
tenant (`404` otherwise), resolve or create the contact, return the contact's open conversation or create
an empty `CUSTOMER` conversation (`INSERT … ON CONFLICT DO NOTHING` on the existing partial unique, so two
simultaneous starts yield one). A new contact is auto-linked under the same "exactly one customer" rule;
the display name given by the agent becomes the contact's `display_name`. No message is created, no system
entry is written (nothing happened yet).

### D10. Honest about receipts

`ChannelResponse` (and the conversation's `contact` block) gain `deliveryReceipts: boolean`: `true` for the
fake provider, `false` for a Meta account until it has a webhook subscription (`webhook_subscribed_at`,
set in 3b). The conversation shows a quiet notice under the composer when it is false ("Delivery receipts
and replies need the WhatsApp webhook, which is not connected yet"), and the settings account card says
the same. No new delivery state is invented: a Meta message stays `SENT`.

### D11. Connection endpoints

All admin-only (`@Roles(Role.ADMIN)`, a named rate limit on the ones that call Meta):
`POST /settings/messaging/accounts` (connect: `{ provider: 'meta_cloud', wabaId, accessToken, appId?,
appSecret? }`), `PUT /settings/messaging/accounts/:id/credentials` (re-authenticate: same body minus
`wabaId`; verified, replaces only on success), `POST …/:id/sync`, `POST …/:id/disconnect` (deletes
credentials, status `DISABLED`, keeps everything else), `PATCH /settings/messaging/channels/:id
{ isEnabled?, isDefault? }`, `GET …/:id/logs`. A second `POST` for the same provider is `409`. The admin
account response gains `token { mask, kind, expiresAt, scopes, verified, checkedAt } | null`,
`appIdSet`, `lastSyncAt`, `lastError`, and per channel `qualityRating`, `mode`, `isMissing`, `nameStatus`.
Failures that are the provider's verdict (bad token, no access, missing scope) are `400` with a
`fieldErrors` entry on the offending field (`accessToken` / `wabaId`) and a code the UI translates;
provider outages during verification are `503`.

### D12. Repeatable live check

`pnpm chat:connect-meta` (script) reads `WHATSAPP_*` from `.env`, logs in as the default tenant's admin and
performs the same API calls as the screen: connect, enable the first number and make it default, then, with
`--send`, start a conversation with `WHATSAPP_TEST_RECIPIENT` and send `hello_world`/`en_US` and optionally
`--text`. It is the evidence for task 11 and the fastest way to reproduce an issue.

## Risks / Trade-offs

- **Receipts do not exist in this slice.** A message Meta later fails (payment, policy) shows `SENT`
  forever. Accepted and visible (D10); the cost of the alternative — polling Graph for message status,
  which does not exist — is not worth it a phase before webhooks.
- **A token without scopes is accepted when no app secret is given** and fails at send time. The UI says
  "permissions not verified"; supplying the app id and secret removes the gap.
- **`biz_opaque_callback_data` placement is unverified** (D4); the live check settles it before 3b depends on it.
- **A started conversation has no inbound message**, so `customerLastMessageAt` stays null and the
  provider-enforced window path is the only thing between an agent and a `131047` — the price of D6, paid
  by one failed message the agent can recover from with a template.
- **The Meta test account only reaches its allowed recipients** (≤5, `131030` otherwise). Tests and the
  live check use the owner's number; this is a limit of the sandbox, not of the code.
- **Moving the contact-resolution code** (D9) touches the inbound path. The ingest suites (`chat-channels-ingest`,
  `chat-delivery` inbound cases, `chat-customer-inbox`) must stay green unchanged; that is the acceptance for the move.
- **Verification runs inside an HTTP request** (up to a few Graph calls). Bounded by 10 s each and 20 pages;
  acceptable for a rare admin action, and the sync failure path keeps the account usable.
- **No scheduled token or number checks**: a token that expires is found at the next send (`AUTH`), a number
  that changes quality at the next manual refresh. 3b/3c add the schedule.

## Migration Plan

One additive migration: `messaging_accounts.app_id text`, `channels.provider_meta jsonb default '{}'`, the
partial unique `(account_id) WHERE is_default AND provider_missing_at IS NULL` (existing data: at most one
default per account today — verified by a pre-check in the migration that fails loudly otherwise),
`channel_logs` with RLS. No backfill; rollback drops the new objects. The registry change is code-only.

## Open Questions

None block implementation. Assumptions to confirm when convenient: 30-day log retention; templates without
variables only in this slice; permissions are *required* only when the app secret is supplied.

## Documentation to promote

Before archive: D2–D6 into `docs/whatsapp-channel.md` §4.5/§4.13 ("as built"), D8 and D9 into `docs/chat.md`,
the purge into `docs/event-driven-architecture.md`, the live results (accepted `biz_opaque_callback_data`
or not, real error codes seen) into `docs/whatsapp-research/live-probe-*.md`, and the connection runbook into
`docs/whatsapp-feature-flows.md`.
