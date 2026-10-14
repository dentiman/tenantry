## Context

The read cursor already moves forward only, in one transaction, through `ChatService.markRead` (REST and
socket). The provider call must stay out of that transaction (backend-conventions §5) and must not block the
cursor. Meta's mark-as-read is `POST /{phone-id}/messages` with `{messaging_product:"whatsapp",
status:"read", message_id}`; it marks the message and the earlier ones read, and fails with `131009` for a
message older than 30 days (docs/whatsapp-feature-flows.md F13).

## Decisions

- **D1 — a column claims the work.** `chat_messages.provider_read_at` is set by a conditional
  `UPDATE … WHERE provider_read_at IS NULL … RETURNING` for the inbound messages of the conversation up to the
  cursor, inside the `markRead` transaction. The claim is the dedupe: concurrent readers and repeated cursor
  moves cannot acknowledge a message twice, and no extra state or counter is needed. The statement joins
  `conversations` for `kind = 'CUSTOMER'`, so internal conversations never match. A message older than 30 days
  or without a provider id never matches, so it is never claimed and never retried by accident.
- **D2 — publish a command, do not call from the request.** `channels.mark-read` carries the conversation id
  and the newest claimed message id; it is published in the same transaction as the claim (`publish(tx, …)`).
  Policy `standard`: order does not matter, and a stuck job must not block anything. Retry limit 1.
- **D3 — best effort, claimed means done.** If the call fails the claim stays: the message is not retried. The
  cost of a lost acknowledgement is a customer seeing grey ticks until the next acknowledged message, which is
  cheaper than retry state and than an extra read receipt storm. The failure is logged (`channel_logs`,
  operation `read`, failures only — successes would be one row per conversation view).
- **D4 — an optional adapter method.** `ChannelAdapter.markRead?(ctx, creds)`. Meta implements it; the fake
  provider does not, so the worker skips it. The Graph client's existing send path (bearer header, redaction,
  timeout) is reused through `MetaGraphClient`.
- **D5 — reactions.** The parser keeps the message-event shape and adds optional `content.reactionEmoji`
  (`null`-able through an empty string when removed). Ingest stores it as `payload.reaction.emoji` and skips
  `customerLastMessageAt` for it — a reaction is not a message a customer service window opens on. Everything
  else about it (preview, unread count, notification) stays as for any inbound message.
- **D6 — tick contrast.** The own bubble keeps the primary tint but at lower strength (`bg-primary/15` with
  the foreground text colour) so the existing blue read ticks stand out; no new colour tokens.

## Risks

- A cursor moved by a non-participant now causes a provider call; that matches "an agent opened the message".
  Unassigned conversations are acknowledged on first view too.
- The typing indicator is left out on purpose: it needs a provider call per typing burst (every ~20 s),
  per-conversation throttling state and a composer hook; the value is low next to its moving parts.
