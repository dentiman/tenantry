# Proposal

## Why

CHAT-0.2a and 0.2b made the Chat screen live *while it is open*. Someone who is not looking at it
still learns nothing: a colleague's message raises an unread badge in the chat list, but the bell,
the toast and the inbox stay silent. `docs/chat.md` §4.11 designed the missing piece — a
`chat.message_received` notification that collapses per conversation and is never sent to someone
who is already reading — and 0.2b built its prerequisite: the server now knows who is viewing a
conversation, because a viewing socket is in the conversation room.

This is **CHAT-0.2c**, the last slice of CHAT-0.2. The presence dot that used to be part of it was
dropped on 2026-10-13 (`docs/whatsapp-channel.md` §0): it does not bring the customer channel closer. It touches the notification inbox and the
messaging topology, which is why it is its own change rather than part of 0.2b.

## What Changes

- **A notification when someone writes to you and you are not looking.** A new type
  `chat.message_received` (new category `chat`, on by default, mutable). It is addressed to every
  active participant except the sender and except anyone who is viewing the conversation at the
  moment the message is posted. Notifications collapse per conversation while unread (the existing
  `groupKey`), so ten messages read "10 new messages", not ten rows. It respects the user's
  notification preferences like every other type.
- **It is written by a worker, not inside the send.** `ChatService.insert()` publishes
  `chat.message-posted.v1` in the same transaction as the message (the seam 0.1 left and
  `docs/chat.md` §4.11 reserved). A new subscriber in the worker, `chat-notify`, is its first
  consumer and records the notifications. The send never waits for notifications and can never be
  rolled back by them.
- **"Viewing" is decided before the transaction.** The API asks the realtime layer which users
  have a socket in the conversation room and carries those user ids in the event. The worker needs
  no socket access, and the external call stays outside the transaction.
- **Reading a conversation clears its notification.** When the read cursor really moves, the
  recipient's unread `chat.message_received` rows for that conversation are marked read and every
  open tab is told (`notification.changed`). A new `markReadByTarget` on the shared
  `NotificationRecorder` does this.
- **Texts and routing:** the notification texts and preference labels in `locales/en/chat.json`
  under the chat namespace, and a `conversation` entry in `entity-routes.ts` so the notification
  opens the conversation.
- **Docs:** `docs/chat.md` §4.8, §4.11 and §7, `docs/notifications.md`,
  `docs/event-driven-architecture.md` (topology), `docs/roadmap.md`.

## Capabilities

### New Capabilities

- `chat/notifications`: who is notified of a new chat message and who is not, how notifications
  collapse, what reading a conversation does to them, and the guarantee that notifying never
  affects sending.

### Modified Capabilities

None.

## Impact

- **Contracts:** new `libs/contracts/src/chat/chat.notifications.ts` (`defineNotificationTypes`),
  one line in the root `notification-types.ts`; new
  `libs/shared/src/messaging/definitions/chat.messages.ts` (`chat.message-posted.v1`) and one entry
  in `MESSAGE_TOPOLOGY`. No REST contract change, so no `openapi:generate`/orval run — except that a
  new notification type widens the generated enum of notification types, which does regenerate the
  web client (checked in task 1.1).
- **Shared:** `ChatNotifier` (builds the notifications for one posted message; used by the worker
  and testable against a real database), `NotificationRecorder.markReadByTarget`.
- **API:** `RealtimeEmitter.userIdsInRoom(room)` (generic, adapter-wide, fail-open);
  `ChatService.post/insert` computes `viewerIds` before the transaction and publishes the event;
  `ChatService.markRead` clears the conversation's notifications.
- **Worker:** new `apps/worker/src/chat/chat-notify.subscriber.ts`, registered in `worker.module.ts`.
- **Web:** `locales/en/chat.json`; `entity-routes.ts`.
- **Module graph:** `chat` gains `messaging` and `notifications` in `dependsOn`; its `paths` gain
  `apps/worker/src/chat/` and `libs/shared/src/messaging/definitions/chat.messages.ts`.
- **Tests:** unit tests for the notifier and the subscriber, an API e2e for the publish (same
  transaction, rolled back with it, `viewerIds`) and the read-clears-notification path, a real-DB
  test of `ChatNotifier` (recipients, collapse, preferences).
- **Not touched, deliberately:** mentions, per-conversation notification levels and the presence
  dot (all dropped, `docs/whatsapp-channel.md` §0); customer-facing channels (CHAT-2a…3c).
