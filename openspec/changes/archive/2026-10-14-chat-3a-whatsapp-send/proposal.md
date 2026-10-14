# Proposal

## Why

Everything built so far runs against a fake provider. Until a message leaves for a real phone, the
parts that are most likely to be wrong — the real error codes, the shape of Meta's responses, how an
account is connected, what a token actually proves — are guesses. The live probe of 2026-10-13
already verified the read-only API and one template and one text send on the test WABA; what is
missing is the product built around it.

The owner's decision of 2026-10-14 splits WhatsApp in two. **This change is the first half: send
only, no webhooks.** It is deliberately the half that needs no public address, no signature
verification and no subscription — so it cannot collide with the other application subscribed to the
shared test WABA, and it can be verified today from a laptop. It gives the first *real* message from
our system to a phone. Receiving, delivery receipts, window tracking from inbound messages and the
checks around the webhook are CHAT-3b.

Because nothing comes back, three things are honest limits of this slice and are shown as such: a sent
message cannot get past "accepted by WhatsApp"; there is no inbound, so a conversation is started by an
agent from a phone number; and the 24-hour window is decided by WhatsApp, not by us.

## What Changes

- **Connect a WhatsApp Business account** (tenant admin): WABA id, a system-user access token and,
  optionally, the app id and app secret. The system verifies the token against Meta before it
  stores anything — validity, type, expiry, the two required permissions and access to that WABA —
  and shows the result. The token is encrypted, never returned and never logged. A temporary token is
  accepted and clearly labelled with its remaining time.
- **Phone numbers come from Meta.** After connecting, the numbers of the WABA are synchronised into
  channels (quality, mode, status); the admin enables the ones to use and marks one default. A number
  that disappears at Meta is marked missing, never deleted. A "Refresh" action re-syncs.
- **`MetaCloudAdapter`**: sends a text and sends an **approved template by name and language** (no
  variables yet — the picker and variables are CHAT-3c), classifies Meta's error codes into the seven
  classes the delivery pipeline already acts on, and states that a successful response means
  "accepted", not "delivered".
- **An agent starts a conversation from a phone number**: pick a channel, enter a number, optionally a
  name; the system creates the contact and an empty customer conversation (or opens the existing one).
  Outside a window the first message is a template; inside one, text.
- **The window is enforced by the provider** for channels that have never received a message from the
  customer: our check does not block (we cannot know), Meta's refusal (`131047`) becomes the
  window-closed failure. Once we know the customer's last message (CHAT-3b) the local rule applies as
  before. A template is always allowed.
- **A minimal call log** (`channel_logs`): every call to the provider (connect, sync, send) with its
  outcome, status, duration and the provider's error, with secrets and message content left out, and a
  short retention. A tenant admin sees the recent entries of an account next to its settings.
- **Honest UI**: the account card and the conversation say that delivery receipts and replies need the
  webhook (not connected yet); a sent message shows one tick and stays there.
- **Dev tooling**: `pnpm chat:connect-meta` connects the default tenant from the `WHATSAPP_*` values
  in `.env`, the same way the settings screen does, so the live check is repeatable.

## Capabilities

### New Capabilities

- `chat/whatsapp-connection`: connecting, verifying, re-authenticating and disconnecting a WhatsApp
  Business account; what is shown and what never is; number synchronisation and enabling.
- `chat/whatsapp-send`: what sending through the WhatsApp adapter means — text, template by name,
  "accepted" is not "delivered", the error taxonomy, no receipts in this slice.
- `chat/outreach`: an agent starting (or reopening) a conversation with a phone number.
- `chat/channel-logs`: the provider call log, what it records and omits, retention and who reads it.

### Modified Capabilities

- `chat/outbound`: "Freeform replies are limited to the provider's window" now distinguishes a
  provider-enforced window (unknown last message → not blocked locally) and exempts templates.

## Impact

- **Database:** `messaging_accounts` gains `app_id`; `channels` gains `provider_meta` (name status,
  code-verification status, platform, throughput); new table `channel_logs` (RLS, FORCE); a
  `conversations`/`chat_messages` shape for a template message (payload, no schema change).
- **Contracts:** account connect/verify/sync/channel-update inputs and responses (credentials stay
  "set / not set"); template message post; start-conversation input; log entry; `windowEnforcement`
  and `templates` adapter capabilities; `deliveryReceipts` flag on a channel; OpenAPI and both clients.
- **Shared (`libs/shared/src/channels/`):** `meta-cloud/` — a small Graph client (bearer header,
  timeout, secret-free errors), `MetaCloudAdapter`, the error table; `ChannelLogService`; registry
  registers `meta_cloud` unconditionally (it needs no env).
- **API:** `settings/messaging` connect, verify, sync, channel enable/default, disconnect, logs;
  `chat` start-conversation and template message; `replyWindow` honours `windowEnforcement`.
- **Worker:** delivery sends a template when the message is one and skips the window check for it; a
  daily log purge; nothing subscribes to anything.
- **Web:** connect form and account card (token state, numbers, refresh, logs), "new customer
  conversation" dialog, template send in the composer, receipt limitation notices.
- **Docs:** `docs/whatsapp-channel.md` §4.5/§4.13/§6 "as built", `docs/whatsapp-feature-flows.md` runbook
  for connecting, `docs/chat.md`, `docs/event-driven-architecture.md` (the purge), `docs/roadmap.md`,
  `docs/ai-knowledge/` (connecting a number — only if it is reachable by end users, see design).
- **Depends on** `chat-2b-reply` (archived) and a live test WABA (`WHATSAPP_*` in `.env`).
- **Out of scope here:** webhooks of any kind, inbound messages, statuses, mark-as-read, template
  sync and picker, media, health checks, the shared-WABA subscription question (all CHAT-3b/3c/2c).
