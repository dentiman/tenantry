# Tasks

## 1. Contracts and wiring

- [ ] 1.1 Add `libs/contracts/src/chat/chat.notifications.ts` with `defineNotificationTypes({ ns: 'chat', prefix: 'notifications' }, { 'chat.message_received': { payload: z.object({ conversation: EntityRefSchema, preview: z.string() }), category: 'chat', defaultEnabled: true, muteable: true, subject: 'conversation' } })`, export it from the chat barrel and add `CHAT_NOTIFICATIONS` to `mergeTypeGroups` in `libs/contracts/src/notification-types.ts`. The type enters the OpenAPI document, so run `pnpm openapi:generate && pnpm web:codegen` and verify that only the notification type enums in `apps/api/openapi.json` and `apps/web/src/api/generated` changed, plus `pnpm typecheck`.
- [ ] 1.2 Add `libs/shared/src/messaging/definitions/chat.messages.ts` (`chatMessagePostedEvent = defineEvent('chat.message-posted.v1', z.object({ conversationId: z.uuid(), messageId: z.uuid(), viewerIds: z.array(z.uuid()) }))`), export it from the messaging barrel, and add its `MESSAGE_TOPOLOGY` entry with consumer `{ id: 'chat-notify', pollingIntervalSeconds: 0.5 }`. Verify that `pnpm typecheck` passes and that the topology guard in `topology.ts` raises no duplicate-name or invalid-queue-name error (a Vitest run in `libs/shared`).
- [ ] 1.3 In `modules.config.ts` add `'messaging'` and `'notifications'` to `chat.dependsOn` and `'apps/worker/src/chat/'` and `'libs/shared/src/messaging/definitions/chat.messages.ts'` to `chat.paths`. Verify with `pnpm modules:check --strict` and `pnpm deps:check` (run after the code that imports them exists, tasks 2 to 4).

## 2. Shared logic (load the `backend-change` skill first)

- [ ] 2.1 Add `NotificationRecorder.markReadByTarget(tx, userId, target)` in `libs/shared/src/notifications/`: update the user's unread, unarchived rows for `{ kind, id }` to read, bump the revision and register the after-commit `notification.changed` (`change: 'read'`, `scope: { kind: 'ids', ids }`, counters from `state.summary`) through the dispatcher registry; do nothing and emit nothing when no row matched. Verify with a unit test (matched, unmatched, other user's rows untouched, already-read rows untouched).
- [ ] 2.2 Add `ChatNotifier` in `libs/shared/src/chat/` with `notifyMessagePosted(tx, { conversationId, messageId, viewerIds })`: load the message (only `kind = TEXT` and not deleted; otherwise return), the conversation and its active participants with names; recipients are participants minus the sender minus `viewerIds`; for each recipient build the label (conversation title; else the sender's name when the conversation is direct; else up to three other participants' names) and the preview (`toPreview`, shared with the conversation list preview — move it into `libs/shared/src/chat/` and import it from `ChatService`) and call `NotificationRecorder.notify` with `type: 'chat.message_received'`, `actor` the sender, `target: { kind: 'conversation', id }`, `groupKey: conversation:<id>`. A missing conversation or message throws `NonRetryableMessageError`. Export it and register it as a provider where `NotificationRecorder` is provided so both apps can inject it. Verify with the real-database test in 4.3.
- [ ] 2.3 Add `RealtimeEmitter.userIdsInRoom(room)`: `namespace.in(room).fetchSockets()` mapped to the distinct `socket.data.userId`; on a timeout or any error log a warning and return `[]` (fail-open); return `[]` while the namespace is not ready. Verify with the e2e in 4.2 (a viewing socket is returned, a non-viewing one is not, an unavailable namespace yields `[]`).

## 3. API and worker

- [ ] 3.1 In `ChatService.post()` compute `viewerIds = await realtime.userIdsInRoom(conversationRoom(tenantId, conversationId))` after the access check and the replay check and before `insert()`; pass it to `insert()`. In `insert()` replace the 0.2b seam comment with `await this.messages.publish(tx, chatMessagePostedEvent, { conversationId, messageId: message.id, viewerIds }, { actor })` after the emission. Inject `MessagePublisher` and `RealtimeEmitter`. Verify with e2e 4.1.
- [ ] 3.2 In `ChatService.markRead`, when `count > 0` call `notificationRecorder.markReadByTarget(tx, userId, { kind: 'conversation', id: conversationId })` in the same transaction. Verify with e2e 4.4.
- [ ] 3.3 Add `apps/worker/src/chat/chat-notify.subscriber.ts`: `@MessageSubscriber({ definition: chatMessagePostedEvent, id: 'chat-notify' })` whose `handle(data, envelope)` is `inbox.runOnce(envelope, 'chat-notify', (tx) => notifier.notifyMessagePosted(tx, data))`; register it and `ChatNotifier` in `worker.module.ts`. Verify that the worker boots (the manifest check passes) and with the unit test in 4.5.

## 4. Tests

- [ ] 4.1 API e2e (`chat-notifications.e2e-spec.ts`): posting publishes exactly one `chat-notify` job whose envelope carries the tenant and the sender, whose payload has only ids and `viewerIds`, and which is not published for a replayed `clientMessageId`, for a rejected send or for a rolled-back transaction; `viewerIds` contains a user with a socket subscribed to the conversation and not a user who merely has a connection (uses the `sentJobs` mock and a socket client).
- [ ] 4.2 API e2e: `userIdsInRoom` returns the viewing users across two sockets of one user once, and `[]` when nobody views.
- [ ] 4.3 Real-database test of `ChatNotifier` (API e2e, constructing it from the app's `NotificationRecorder`): recipients exclude the sender, viewers and a participant who left; an event entry produces nothing; three messages collapse into one notification with `groupCount` 3 and the newest preview; a read notification is followed by a fresh one; a user who disabled the type gets none; the label rule for a titled, a direct and an untitled group conversation; a second call for another recipient set does not touch the first recipients' rows; a missing conversation throws `NonRetryableMessageError`.
- [ ] 4.4 API e2e: a recipient with an unread chat notification reads the conversation through both REST and `chat.read.v1`; the notification is read, `notification.changed` reaches the recipient's other tab, the bell summary drops; a stale `seq` leaves it unread and emits nothing; another participant's reading changes nothing for the recipient.
- [ ] 4.5 Worker unit test for `ChatNotifySubscriber` (mocks as in the other subscriber tests): it calls the notifier inside `runOnce` with the message data, and a redelivery of the same envelope does not call the notifier twice.
- [ ] 4.6 Run the new e2e suites plus `chat.e2e-spec.ts`, `chat-realtime.e2e-spec.ts`, `chat-socket-events.e2e-spec.ts`, `notifications.e2e-spec.ts` and `messaging.e2e-spec.ts` in isolation (a throwaway-container run like `scripts/ci-verify.sh` with a narrowed command list, not against the live dev stack) and confirm they are green.

## 5. Web

- [ ] 5.1 Add the texts to `apps/web/src/locales/en/chat.json` under `notifications` (`type.chat.message_received_one`/`_other`, `label.chat.message_received`, `category.chat`) and the `conversation` entry to `apps/web/src/lib/entity-routes.ts` (`/chat/$conversationId`). Verify that `registry-texts.test.ts` passes for the new type and that following a notification of kind `conversation` resolves a link.
- [ ] 5.2 Add a pure `directPeerId(participants, viewerId)` (the other participant when there are exactly two and one is the viewer, else `null`) and render the existing user presence dot on the peer's avatar in `conversation-list.tsx` and in the conversation header when it returns an id. Verify with Vitest on `directPeerId` (two people, a group, a conversation with just the viewer, a viewer not among the participants) and by eye in 6.1.

## 6. Live verification

- [ ] 6.1 In the dev stack (the API and the worker must both run the new code; ask before restarting the user's processes), with two users, confirm and record:
  - a colleague's message while the user is on another screen produces a bell entry and a toast within about a second, naming the author and the conversation, and following it opens the conversation;
  - while the user has the conversation open, the colleague's message produces no notification;
  - several messages while the user is away collapse into one notification with a count;
  - opening the conversation clears the notification and the bell count in every tab;
  - turning the chat category off in the preferences stops new notifications;
  - the online dot appears next to a direct conversation's other person and disappears when they go offline, and is absent in a group conversation.

## 7. Documentation (promote before archiving)

- [ ] 7.1 Update `docs/chat.md` (§4.8 intro and §7.3/§7.5: 0.2c built; §4.11: the subscriber, `viewerIds`, the label rule and read-clears as built; the follow-up for a "last seen" line), `docs/notifications.md` (the `chat.message_received` type, its category and the worker-born path), `docs/event-driven-architecture.md` (the `chat.message-posted.v1` topology row and the `chat-notify` consumer) and `docs/roadmap.md`. Verify with a grep that no doc still lists the notification or the presence dot as pending for 0.2.
- [ ] 7.2 Add the end-user lines (a chat notification appears in the bell when you are not looking at the conversation; reading it clears the notification; the chat category in the preferences; the online dot in direct conversations) to `docs/ai-knowledge/` and run `pnpm ai:knowledge`.
- [ ] 7.3 Run the full gate `bash scripts/ci-verify.sh` and confirm it is green before commit.
