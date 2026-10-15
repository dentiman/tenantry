## 1. Schema and contracts

- [x] 1.1 Migration: `chat_messages.provider_read_at timestamptz` (nullable, no backfill) and the Prisma field
- [x] 1.2 `channel_logs.operation` accepts `read` (contract enum and `LogEntryInput`); `NormalizedMessageEvent.content.reactionEmoji`
- [x] 1.3 Command `channels.mark-read` with its topology entry and a subscriber in the worker

## 2. Acknowledgement

- [x] 2.1 `ChatService.markRead` claims the inbound messages and publishes the command in its transaction
- [x] 2.2 `ChannelReadReceiptService`: load message and channel, skip when unsupported/disabled/not connected, call the adapter outside a transaction, log a failure
- [x] 2.3 `ChannelAdapter.markRead?` and the Meta implementation (`status: "read"`), stub route in the Graph stub

## 3. Reactions

- [x] 3.1 Parser fills `reaction`; ingest stores `payload.reaction` and does not set `customerLastMessageAt` for it
- [x] 3.2 Transcript renders "Reacted <emoji>" / "Removed a reaction"

## 4. UI

- [x] 4.1 Own bubble tint lighter so read ticks are visible (dark and light theme)

## 5. Tests and docs

- [x] 5.1 Unit: parser reaction, adapter `markRead` request shape, helper text for reactions
- [x] 5.2 e2e: claim once across two readers and repeated moves, internal conversation untouched, old message untouched, reaction does not open the window, worker call and failure log
- [x] 5.3 Docs: `whatsapp-channel.md`, `whatsapp-feature-flows.md` (F13, F16), `chat.md`, roadmap; ai-knowledge if a label changes
- [x] 5.4 Live check on the Meta test number: open a message from the phone, the phone shows blue ticks
