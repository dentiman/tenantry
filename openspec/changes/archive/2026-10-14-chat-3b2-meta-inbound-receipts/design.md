## Context

The pipeline after "stored" exists: `channels.ingest-webhook` → `ChannelIngestService.ingestEvent` → adapter
`parseWebhook` → per event `ingestMessage` / `ChannelStatusService.foldOrPark` (forward-only conditional
UPDATE, parking in `channel_pending_statuses`, one-minute sweeper). `MetaCloudAdapter.parseWebhook` returns
`events: []` since 3b1. The stand holds real captures: an inbound text, `sent` and `delivered` of our own send,
with `biz_opaque_callback_data` equal to our message id, and legacy-dev's export shows the rest: `read`, `failed`
(131049), `image`, `document`, `reaction`, `message_template_status_update`, `account_update`.

## Goals / Non-Goals

**Goals:** a faithful `parseWebhook`; receipts on for a subscribed number; failure reasons; placeholders for
everything we cannot show; signature enforced on the stand. **Non-Goals:** media, reactions, mark-as-read,
typing, template/account events, identity merging, pricing accounting, replaying 3b1 captures.

## Decisions

### D1. One webhook, many events, one parser
`parseWebhook(raw)` walks `entry[].changes[]`. For `field = messages`: `statuses[]` → status events,
`messages[]` → message events (text, or placeholder). Any other field → one `unsupported` event
(`reason: field name`) so the stored row says it was seen. A malformed branch (missing id, non-object) becomes an
`unsupported` event with `reason: invalid_*`; it never throws and never discards the rest of the batch. A body
that is not JSON stays `error: invalid_json`. The channel is `metadata.phone_number_id`; an event without it is
`unsupported` (unroutable by ingest anyway).

### D2. Message mapping
`from` = `{ kind: 'phone', value: messages[].from }`; `profileName` from `contacts[]` matched by `wa_id`;
`sentAt` = `timestamp` (seconds) as ISO; `externalMessageId` = `id`; `content.body` = `text.body` for text,
`[<type>]` for everything else with `content.unsupportedType = <type>`; `providerMeta` keeps `from_user_id`,
the matched `contacts[].user_id` and `context` when present (BSUID and reply context for later phases). Echo-like
or own-number messages are not special-cased: the real payloads contain none.

### D3. Placeholder is data, not copy
Backend never emits localized text. A placeholder message has `body = "[image]"` (so previews and search have
something) and `payload.unsupported = { type }`; the transcript renders "Message not supported (image)" from the
payload through i18next. Ingest stores `payload` from one optional field on the normalized content
(`unsupportedType`); the contract change is that single optional string.

### D4. Status mapping
`externalMessageId` = status `id`; `opaqueId` = `biz_opaque_callback_data` or null; `status` as given (unknown
values → `unsupported`); `occurredAt` = `timestamp`; `providerMeta` = `{ recipient_id, recipient_user_id,
pricing, conversation }` for later phases. For `failed`: `errors[0]` → `failure { class, code, title, details }`
with `class` from the same table as sending (`errors.ts`, extended with one export for webhook use); a code not in
the table is `PERMANENT`, because a final `failed` is never retried; `details` = `error_data.details`.

### D5. Receipts flag is per channel and follows our own record
`hasDeliveryReceipts(provider, subscribedAt)` takes the channel's `webhookSubscribedAt` (set and cleared by the
Subscribe/Unsubscribe actions) instead of the account's, which nothing ever sets. It is a cheap indicator, not
truth: if someone re-points the number outside the product, the flag lies until the status screen is opened.
The fake provider stays always-true.

### D6. Enforce on the stand
`scripts/hetzner/common.sh` stops defaulting `CHANNEL_WEBHOOK_SIGNATURE` to `record`; the compose default is
`enforce`. The account on the stand has its app secret (the 3b1 captures verified), so nothing legitimate is
refused. `record` remains available as a setting.

### D7. No replay of 3b1 captures
Events stored before this change are `PROCESSED` and are not reprocessed: the captured inbound text of the live
test stays a captured event. Processing starts with the next webhook.

## Risks / Trade-offs

- **A placeholder body in a text column** — previews show `[image]`; acceptable and honest; a proper attachment
  model is CHAT-2c.
- **The receipts flag can lie** (D5) if the destination is changed outside the product. Mitigated by the status
  line on the number; the sweeper discards parked statuses after five attempts as today.
- **One contact per phone**, BSUID only recorded: when Meta stops sending the phone (username rollout) contacts
  will need the BSUID address — CHAT-3c; the data is already kept.
