# Proposal

## Why

CHAT-3a sends real WhatsApp messages but hears nothing back: a message stays at "accepted" forever, and
inbound is impossible. Before building receipts and inbound on top of Meta's webhooks, we need the real
thing in hand. fms-api (another project on the same test WABA) already logged 300 real webhooks; they
show what Meta actually sends — statuses with pricing, `biz_opaque_callback_data` coming back, BSUIDs
(`user_id`), media, reactions, template and account updates, `131049` failures. Reading them is a start;
receiving and storing **our own** hooks on a public address, then reading them back through the API, is the
cheapest way to test the whole path (public URL → handshake → subscription → delivery) before any
processing exists.

This change is deliberately **capture only**: every webhook Meta sends is stored as received, nothing is
interpreted, no conversation or message changes. That makes it safe to deploy early and lets the next
slice (receipts and inbound) be written against recorded samples.

## What Changes

- **Meta webhook endpoint becomes real**: the GET handshake (`hub.mode=subscribe`, verify token) and the
  POST. The body is stored byte-for-byte together with the request headers and the result of the
  `X-Hub-Signature-256` check. The answer is always 200 for a known account. The signature is verified
  (checked against 215 real hooks: all match) but, in this slice, **recorded, not enforced** for Meta
  (owner's decision) — enforcement is one setting away and the default everywhere else.
- **Subscribe / unsubscribe by button, per phone number.** The admin sees where the number's webhooks go
  today (ours, nobody, or another host) and presses "Subscribe": we set the number-level
  `override_callback_uri` to this account's address with its verify token. Nothing subscribes by itself.
  When the number's events currently go to another host (the shared test WABA has fms-dev), the admin must
  name that host to take them over. "Unsubscribe" clears our override, and the events return to the
  level above.
- **Read the captured hooks through the API** (tenant admin, per account): list with headers, raw body,
  signature result and state. This is how an agent or the owner inspects what arrived.
- **Public address on the Hetzner stand**: the stack passes `CHANNEL_WEBHOOK_BASE_URL` to the API
  (derived from the stand's public URL) so the settings screen shows a real address.

Not in this change: interpreting any webhook (inbound messages, status folding, receipts, template or
account events), enforcing the signature, a WABA-level subscription, health checks and drift detection.
`deliveryReceipts` stays false: nothing yet turns a status into a tick.

## Capabilities

### New Capabilities

- `chat/webhook-capture`: the Meta handshake and POST, raw storage with headers and signature result
- `chat/webhook-subscription`: reading and setting where a number's webhooks go, by explicit action
- `chat/webhook-events`: admin read access to the captured events

### Modified Capabilities

None. (The generic public webhook of CHAT-2a keeps its behaviour for the fake provider.)

## Impact

- Migration: `channel_webhook_events.headers`, `.signature_valid`; `channels.webhook_subscribed_at`.
- API: three admin routes under `/settings/messaging/channels/:id/webhook*` and one under
  `/settings/messaging/accounts/:id/webhook-events`; contracts and generated clients.
- Web: a webhook block on each number in the account card (state, Subscribe/Unsubscribe) and a captured
  events list.
- Deploy: `docker/docker-compose.stack.yml` api env, `scripts/hetzner/common.sh` defaults
  (`CHANNEL_WEBHOOK_BASE_URL`, `CHANNEL_WEBHOOK_SIGNATURE=record`).
- Docs: `whatsapp-channel.md` §4.3/§4.13/§6/§8.1, `whatsapp-feature-flows.md` F3, a research note on the fms-api
  sample.
