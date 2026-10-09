# Tasks

## 1. Contracts and module graph

- [x] 1.1 Add `libs/contracts/src/chat/chat.socket-events.ts` with `ChatMessageCreatedSchema` (`conversationId`, `message: ChatMessageResponseSchema`, `occurredAt`) and `ChatConversationChangedSchema` (`conversationId`, `change: 'created' | 'membership' | 'read'`, `occurredAt`), exported as `CHAT_SOCKET_EVENTS` (`chat.message-created.v1`, `chat.conversation-changed.v1`). Export it from the chat contracts barrel and spread it into `SERVER_SOCKET_EVENTS` in `libs/contracts/src/socket-events.ts`. Verify that `REALTIME_EVENTS.chatMessageCreated` type-checks in both `apps/api` and `apps/web` (`pnpm typecheck`).
- [x] 1.2 Add `'realtime'` to `chat.dependsOn` in `modules.config.ts` and import `RealtimeModule` in `apps/api/src/chat/chat.module.ts`. Verify that `pnpm modules:check --strict` and `pnpm deps:check` pass.

## 2. Backend emission (load the `backend-change` skill first)

- [x] 2.1 Add `activeParticipantIds(tx, conversationId)` to `libs/shared/src/chat/` and export it from the barrel. It returns the user ids of participants with `left_at IS NULL`. Verify with `pnpm typecheck`.
- [x] 2.2 Change `joinDefaultChannel` to return `{ conversationId, message } | null`, where `null` means the user was already a member. Callers in platform-api and the seed keep ignoring the value. Verify with `pnpm typecheck` and the existing chat and platform e2e suites.
- [x] 2.3 Add `apps/api/src/chat/chat-realtime.ts` (`ChatRealtime`) with two methods, `messageCreated(tx, conversationId, message)` and `conversationChanged(tx, conversationId, change, recipientIds?)`. Each method reads recipients inside `tx` (design D1), takes the tenant from `TenantContextService`, and calls `RealtimeEmitter.toUsers` inside `onCommit(tx, …)`, with the payload built by `toChatMessageResponse`. Register it in `ChatModule`. Verify with `pnpm typecheck`.
- [x] 2.4 In `ChatService.insert()`, replace the CHAT-0.2 seam comment with `chatRealtime.messageCreated(tx, …)`, keeping a one-line pointer to the deferred `publish`. The replay paths in `post()` must not emit. Verify with e2e 4.2 and 4.4.
- [x] 2.5 In `ChatService.create()`, emit `conversationChanged(tx, id, 'created', memberIds)`. Verify with e2e 4.5.
- [x] 2.6 In `ChatService.markRead()`, use the `updateMany` count and emit `conversationChanged(tx, id, 'read', [actor.sub])` only when the count is greater than 0. Verify with e2e 4.6.
- [x] 2.7 In `DefaultChannelService`'s hook, when `joinDefaultChannel` returns a result, emit `messageCreated` for the `member.added` entry and `conversationChanged(…, 'membership')`, both bound to the user-creating transaction. Verify with e2e 4.7.

## 3. Web sync

- [x] 3.1 Add `apps/web/src/features/chat/realtime/chat-cache.ts`:
  - `mergeIncomingMessage(queryClient, conversationId, message)` implements the D4 table (no cache → nothing; `seq <=` newest → ignore; `newest + 1` → prepend to page 0; gap → invalidate the transcript);
  - in the same call, it runs `useChatOutboxStore.getState().resolve()` when `clientMessageId` matches.

  Verify with Vitest `chat-cache.test.ts`, which covers all four branches and outbox resolution.
- [x] 3.2 Add `apps/web/src/features/chat/realtime/chat-sync.ts` (`initChatSync(queryClient, socket = getSocket())`, injectable like `initAiSync`):
  - `message-created` → `mergeIncomingMessage` plus invalidating the list;
  - `conversation-changed` → invalidate the list; for `created` and `membership`, also `findOne` of that conversation (the `member.added` entry itself arrives as `message-created`, so the transcript needs no extra re-read);
  - `connect` with `!socket.recovered` → invalidate every chat query.

  Register it in `main.tsx`. Verify with Vitest `chat-sync.test.ts`, using a fake socket as `ai-sync.test.ts` does.
- [x] 3.3 In `use-chat.ts`:
  - `useSendMessage.onSuccess` calls `mergeIncomingMessage` with the POST response (resolving the outbox) and invalidates only the list;
  - remove `CHAT_STALE_TIME` and its comment;
  - remove `useRefreshChat`.

  Verify that the existing `chat-outbox.store.test.ts` still passes and that `pnpm --filter web typecheck` is green.
- [x] 3.4 In `chat-transcript.tsx`, export `buildRows()` and make it skip outbox entries whose `clientMessageId` is already among the cached messages (the D4 backstop). Verify with a unit test of `buildRows`, extracting it if needed.
- [x] 3.5 In `pages/chat-conversation.tsx`, remove the Refresh button and its i18n key if it becomes unused. Also drop the 5 s `staleTime` override on the conversation card query, which existed for the same reason. Verify that `pnpm lint` reports no unused key or import.

## 4. Tests (apps/api/test/chat-realtime.e2e-spec.ts, on the ai-realtime.e2e-spec.ts pattern)

- [x] 4.1 Set up users A and B (participants), C (same tenant, not a participant) and D (another tenant), each with a connected `socket.io-client`.
- [x] 4.2 When A posts, B and A's own socket each receive one `chat.message-created.v1` whose `message` deep-equals the transcript row (same `seq`, `clientMessageId`). C and D receive nothing within the wait window.
- [x] 4.3 Two concurrent posts (`Promise.all`) produce two events on B with consecutive `seq` values and no duplicates.
- [x] 4.4 Replaying a send with the same `clientMessageId` returns the stored message and emits no second event. A rejected send (empty body) emits nothing.
- [x] 4.5 When a conversation is created with A and B, B receives `conversation-changed` `created` and C receives nothing.
- [x] 4.6 When B marks read, only B's sockets receive `conversation-changed` `read`. Repeating the same `seq` emits nothing.
- [x] 4.7 When an admin creates a new user, the existing General members receive `message-created` (`member.added`) and `conversation-changed` `membership`.
- [x] 4.8 Run `pnpm api:test:e2e` (in a ws slot or `scripts/ci-verify.sh`, not alongside a live dev stack) and confirm that both the new suite and the existing `chat.e2e-spec.ts` are green.

## 5. Live verification

- [x] 5.1 In a ws slot, open two browsers as two users and walk through these steps:
  - B sees A's reply appear in the open transcript, and the list reorders with the unread badge;
  - reading in one of B's tabs clears the badge in B's other tab;
  - the author sees exactly one entry per send;
  - after stopping the API for a moment and restarting it, the transcript converges after reconnect;
  - with the window idle, the network tab shows no repeated chat requests.

  Record the result in the change notes.

  **Result (2026-10-09, dev stack, Orca browser, two tabs of one admin on `localhost:5173`, a second user posting over REST):**
  - a colleague's reply appeared in the open transcript with no action, and the list preview updated in both tabs;
  - with nobody reading, both tabs showed the new preview and unread badge `1`; opening the conversation in one tab cleared the badge in the other without touching it;
  - the author's own send produced exactly one row, and exactly one `POST /messages` (response and socket echo merged);
  - after a full API restart both tabs reconnected on their own and the next message arrived live;
  - with the window idle for 40 s the client issued no chat requests.

  Limitation: the second user was not a second browser session. A second origin (`[::1]:5173`) is rejected by the socket handshake origin check, so the browser path of the receiving side was exercised through the second tab of the same user; the other-user path is covered by the e2e suite.

## 6. Documentation (promote before archiving)

- [x] 6.1 Update `docs/chat.md`:
  - §4.8: event names and payloads as built; recipients read inside the transaction (D1); the merge table (D4); the list re-read and its cost (D5);
  - §7.3 and §7.5: split 0.2 into 0.2a (this change) and 0.2b (rooms, subscribe/typing/read over the socket, notifications with viewing suppression, presence, inbound-event registry in realtime).

  Verify that the doc no longer mentions dotted `chat.message.created.v1`.
- [x] 6.2 Reword AGENTS.md rule 15. A socket event may carry state only with a monotonic counter and a REST resync; the current examples are the AI delta (`chunkSeq`/`attempt`), `notification.created` (`revision`) and `chat.message-created` (`seq`). Add a matching line to `docs/realtime.md`. Verify with a grep that no doc still calls the AI delta "the one exception".
- [x] 6.3 Add the CHAT-0.2a row to `docs/roadmap.md` and update `docs/modules.md` §7.2 to list the `chat.socket-events.ts` definitions. Verify that `pnpm lint` is green.
- [x] 6.4 Run the full gate `bash scripts/ci-verify.sh` and confirm it is green before commit.
