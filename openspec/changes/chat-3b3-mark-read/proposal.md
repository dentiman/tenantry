# Proposal

## Why

With CHAT-3b2 a customer's text reaches the inbox and our reply shows sent, delivered and read ticks. The
other direction is missing: when an agent opens a customer's message, WhatsApp still shows that message to the
customer as unread (two grey ticks) until the agent answers. That is the one behaviour of the plain
"customer writes, we reply" conversation that is not built. A customer reaction (an emoji on one of our
messages) is also stored as a bare `[reaction]` placeholder and, being an inbound message, wrongly extends the
24-hour reply window. Separately, the blue "read" ticks on our own bubbles are almost invisible on the
primary-coloured bubble.

## What Changes

- **Read acknowledgement to the provider.** When an agent moves the read cursor of a customer conversation (the
  existing read-on-view path), every not-yet-acknowledged inbound message up to that point is marked as
  acknowledged and one best-effort job tells the provider that the newest of them is read; WhatsApp marks the
  older ones too. Only inbound messages that have a provider id and are not older than 30 days are
  acknowledged. Each inbound message is acknowledged once, however many agents open the conversation. A
  failure is written to the provider-call log and nothing is retried or shown: the next newer inbound message
  gets its own acknowledgement.
- **A reaction reads as a reaction.** An inbound reaction is stored with its emoji and shown as "Reacted 👍"
  (or "Removed a reaction"); it does not open or extend the reply window.
- **Read ticks are visible.** The own-message bubble uses a lighter tint of the primary colour so the blue
  "read" ticks have contrast.

Not in this change: the typing indicator (it needs a provider call per keystroke burst, throttling and a
composer hook; deferred), outbound reactions, media, templates and contact-state events.

## Capabilities

### New Capabilities

- `chat/whatsapp-read-receipts`: acknowledging inbound messages to the provider when an agent reads them

### Modified Capabilities

- `chat/whatsapp-inbound`: reactions are stored with their emoji and do not open the reply window
