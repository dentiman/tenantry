# Proposal

## Why

CHAT-3b1 proved the whole path on the Hetzner stand: Meta delivers signed webhooks to our public address
and we store them. A text typed on the phone and the `sent`/`delivered` statuses of a message sent from the
stand are sitting in `channel_webhook_events`, and nothing turns them into a conversation or a tick. The
core that does that — ingest, de-duplication, status folding that is forward-only, parking of a status that
beats the write of its id — has existed since CHAT-2a/2b for the fake provider. This change is the missing
piece: a real `MetaCloudAdapter.parseWebhook`, written against 300 real payloads (legacy-dev's export and our own
captures), plus the switches that make the stand behave like a product.

## What Changes

- **Meta webhooks become events.** Each `entry[].changes[]` of a `messages` change yields one event per
  `messages[]` item and per `statuses[]` item:
  - an inbound **text** becomes a message event (sender phone, profile name, provider time, the id);
  - any other inbound type (`image`, `document`, `audio`, `video`, `sticker`, `location`, `contacts`,
    `interactive`, `button`, `reaction`, `order`, `system`, unknown, and the provider's own "unsupported")
    becomes a message with a language-neutral placeholder body (`[image]`) and the provider type recorded, so
    the feed has no holes; media download and reactions are CHAT-2c;
  - a **status** (`sent`, `delivered`, `read`, `failed`) becomes a receipt carrying our message id from
    `biz_opaque_callback_data`; a `failed` status carries the provider code classified into the existing
    seven classes, with the provider's `error_data.details` kept;
  - every other change field (`message_template_status_update`, `account_update`, …) is stored and left
    alone.
  The BSUIDs Meta already sends (`user_id`, `from_user_id`, `recipient_user_id`) are kept in the event's
  provider metadata; identity merging remains CHAT-3c.
- **Receipts are real for a subscribed number.** `deliveryReceipts` for a Meta channel becomes true while the
  number is subscribed to this system, so the composer stops saying ticks are not tracked and the message
  bubble shows sent, delivered and read.
- **A failed message says why.** The `failed` status's code and details appear on the message the way a send
  failure does today (`131049` is the one seen in practice).
- **Inbound opens the window.** The existing ingest sets the customer's last-message time, so the local
  24-hour rule applies from the first inbound; a conversation starts without a manual outreach.
- **Signature is enforced on the stand.** The Hetzner default `record` is removed: a request without a valid
  `X-Hub-Signature-256` is refused. (The 3b1 captures prove the algorithm.)
- **An unsupported message reads as one in the transcript** ("Message not supported (image)"), not as a raw
  placeholder.

Not in this change: mark-as-read and the typing indicator, media download, reactions on messages, template
status handling, identity events and aliases, `pricing` accounting, health checks. They stay stored.

## Capabilities

### New Capabilities

- `chat/whatsapp-inbound`: turning Meta messages into conversation messages (text and placeholders)
- `chat/whatsapp-receipts`: turning Meta statuses into delivery state, failures and the receipts flag

### Modified Capabilities

- `chat/webhook-capture`: capture no longer promises "no interpretation"; interpretation happens after storing; the stand enforces the signature
- `chat/webhook-subscription`: a subscription now turns receipts on for that number

## Impact

- `MetaCloudAdapter.parseWebhook`, `errors.ts` (webhook failure classification), one optional field on the
  normalized message content, ingest storing the placeholder payload, `hasDeliveryReceipts` per channel.
- Web: transcript text for an unsupported message, locale; no new screens.
- Deploy: `scripts/hetzner/common.sh` default for `CHANNEL_WEBHOOK_SIGNATURE`.
- Docs: `whatsapp-channel.md` §4.3/§4.4/§6, `whatsapp-feature-flows.md` F4/F5/F11, `chat.md`, roadmap, ai-knowledge.
