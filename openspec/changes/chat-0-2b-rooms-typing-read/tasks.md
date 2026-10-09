# Tasks

## 1. Contracts

- [ ] 1.1 Add `libs/contracts/src/realtime/client-socket-event.ts` with `defineClientSocketEvent(name, payloadSchema, ackDataSchema)`, `ClientEventsOf<T>` (handler signature `(payload, ack) => void`), the ack envelope schema `{ ok: true, data } | { ok: false, code }` and the closed code set `INVALID_PAYLOAD | NOT_FOUND | FORBIDDEN | RATE_LIMITED | LIMIT_EXCEEDED | INTERNAL`. Export it from the realtime barrel. Verify with `pnpm typecheck` in contracts.
- [ ] 1.2 Add `libs/contracts/src/chat/chat.rooms.ts` (`conversationRoom(tenantId, conversationId)`, `CHAT_MAX_VIEWED_CONVERSATIONS = 5`, `CHAT_TYPING_TTL_MS = 6000`, `CHAT_TYPING_PULSE_MS = 3000`) and `chat.client-events.ts` declaring `chat.subscribe.v1`, `chat.unsubscribe.v1`, `chat.typing.v1`, `chat.read.v1` (read payload reuses `MarkConversationReadSchema` plus `conversationId`; subscribe ack data `{ conversationId }`; the others `{}`), exported as `CHAT_CLIENT_SOCKET_EVENTS`. Add `chat.typing-changed.v1 { conversationId, userId, expiresInMs }` to `CHAT_SOCKET_EVENTS` in `chat.socket-events.ts`. Verify that the schemas parse a valid sample and reject a malformed one (Vitest or Jest unit test next to the schema).
- [ ] 1.3 In `libs/contracts/src/socket-events.ts` add `CLIENT_SOCKET_EVENTS` (spreading the chat definitions) and export `ClientToServerEvents = PlatformClientToServerEvents & ClientEventsOf<typeof CLIENT_SOCKET_EVENTS>`. Rename the interface in `realtime/realtime.types.ts` to `PlatformClientToServerEvents` (it keeps `auth.update.v1` only) and fix the realtime barrel. Verify that `pnpm typecheck` is green for api, worker and web, which all import the name from the contracts root.

## 2. Inbound registry in `realtime` (load the `backend-change` skill first)

- [ ] 2.1 Add `apps/api/src/realtime/client-event.registry.ts` (`ClientEventRegistry`): `register(definition, handler, options?)` (duplicate name throws at boot), `attach(socket)` attaching `socket.on(name, …)` for every registered definition. Pipeline: Zod-parse payload → per-socket fixed-window rate limit (default 20 per 10 s, per-registration override, state in a `WeakMap` keyed by the socket) → `TenantContextService.runWith(socket.data.tenantId, …)` → ack. Handler context is `{ socket, userId, tenantId, role, payload }`. Export `SocketEventError(code)`; map Nest `NotFoundException`, `ForbiddenException` and `BadRequestException` to `NOT_FOUND`, `FORBIDDEN` and `INVALID_PAYLOAD`; anything else is logged and acknowledged as `INTERNAL`. A missing ack callback discards the result. Verify with e2e 4.1 to 4.3 and 4.8.
- [ ] 2.2 Provide and export `ClientEventRegistry` from `RealtimeModule`, and call `registry.attach(socket)` in `RealtimeGateway.handleConnection` after the rooms are joined. `auth.update.v1` stays a `@SubscribeMessage`. Verify that the existing `realtime.e2e-spec.ts` is still green.

## 3. Chat handlers

- [ ] 3.1 Change `ChatService.markRead` to take `userId: string` instead of the JWT payload and update the controller (`actor.sub`). Verify with `pnpm typecheck` and the existing `chat.e2e-spec.ts` and `chat-realtime.e2e-spec.ts`.
- [ ] 3.2 Add `apps/api/src/chat/chat.socket-handlers.ts` (`ChatSocketHandlers implements OnModuleInit`), registered in `ChatModule`, registering the four events:
  - subscribe: `assertParticipant`, join the room, enforce `CHAT_MAX_VIEWED_CONVERSATIONS` (counted from `socket.rooms` by prefix; re-joining does not count), ack `{ conversationId }`;
  - unsubscribe: leave, always `ok`;
  - typing (limit 5 per 10 s): refuse `FORBIDDEN` unless `socket.rooms` holds the room, otherwise `socket.to(room).emit(typingChanged, { conversationId, userId, expiresInMs: CHAT_TYPING_TTL_MS })`, no database access;
  - read: `markRead(userId, …)`.

  Verify with e2e 4.2 to 4.7.

## 4. Tests (apps/api/test/chat-socket-events.e2e-spec.ts, on the chat-realtime.e2e-spec.ts pattern, with `socket.io-client` and `emitWithAck`)

- [ ] 4.1 Subscribe matrix: a participant is accepted; a non-participant of the same tenant, a user of another tenant, a user whose `leftAt` is set and an unknown uuid each get the identical `NOT_FOUND` ack; unsubscribe, including for a never-subscribed conversation, is `ok`.
- [ ] 4.2 Limit: the sixth distinct subscription on one socket is `LIMIT_EXCEEDED` and the earlier five stay joined; re-subscribing to a held conversation is `ok` and does not consume a slot.
- [ ] 4.3 Typing reach: a viewer receives `chat.typing-changed.v1` with the typist's id and `expiresInMs`; a participant who has not subscribed receives nothing; the typist's own other tab receives it (the client filters it); a typing signal from an unsubscribed socket is `FORBIDDEN` and nobody receives anything; after a typing signal the conversation's `lastSeq`, `lastMessagePreview` and every participant's `unreadCount` are unchanged.
- [ ] 4.4 Typing flood: sending more than 5 typing signals within 10 s yields `RATE_LIMITED` for the excess, the first five reach the viewer, and the socket still works afterwards.
- [ ] 4.5 Read parity: `chat.read.v1` and `POST …/read` leave identical participant rows (`lastReadSeq`, `unreadCount`) for the same inputs; a stale `seq` is `ok`, moves nothing and emits no `read` event; a forward `seq` emits `chat.conversation-changed.v1` `read` to the reader's other tab and to no one else; a non-participant is `NOT_FOUND` and changes nothing.
- [ ] 4.6 Validation: a missing field, a wrong type and a non-uuid `conversationId` each get `INVALID_PAYLOAD`, change nothing and leave the socket connected; an event sent with no ack callback does not crash the handler.
- [ ] 4.7 Tenant context: a handler that reaches the database (subscribe, read) succeeds under RLS for tenant A and cannot see a tenant B conversation id.
- [ ] 4.8 Registry in isolation: registering the same event name twice throws; an exception that is not a Nest HTTP exception is acknowledged as `INTERNAL` without leaking its message (assert the ack body).
- [ ] 4.9 Run the new suite plus `chat.e2e-spec.ts`, `chat-realtime.e2e-spec.ts` and `realtime.e2e-spec.ts` in isolation (a throwaway-container run like `scripts/ci-verify.sh` with a narrowed command list, not against the live dev stack) and confirm all are green.

## 5. Web

- [ ] 5.1 Add `features/chat/realtime/chat-socket.ts`: a typed `emitWithAck(event, payload)` over `socket.timeout(5000).emitWithAck`, returning the ack envelope or `{ ok: false, code: 'INTERNAL' }` on timeout. Verify with a Vitest test using a fake socket.
- [ ] 5.2 Add `chat-subscriptions.ts` (`watchConversation(id): () => void`): ref-counted per id; first reference emits subscribe, last emits unsubscribe deferred by one tick (StrictMode churn); a `connect` handler re-subscribes every held id regardless of `socket.recovered`; refusals and timeouts are swallowed. Hold the reference in `ChatConversationPage` with `useEffect`. Verify with Vitest: ref-count, StrictMode mount-unmount-mount emits no unsubscribe, reconnect re-subscribes, a refusal does not throw.
- [ ] 5.3 Add `chat-typing.store.ts` and `TypingIndicator`; extend `chat-sync.ts` to set entries from `chat.typing-changed.v1` (ignoring the user's own id, local deadline = receipt time + `expiresInMs`) and to clear the sender's entry on their `chat.message-created.v1`. The indicator names one or two typists and summarises more, prunes lapsed entries on a 1 s tick that runs only while entries exist, and holds a fixed-height row above the composer. Add the i18n plural keys to `locales/en/chat.json`. Verify with Vitest on the store, the pruning and the text selection, and `pnpm lint` for key usage.
- [ ] 5.4 Add a pure `shouldPulseTyping(lastPulseAt, now, value)` and an `onTyping` prop on `ChatComposer`: fired from `onChange` for a non-empty value at most once per `CHAT_TYPING_PULSE_MS`, reset on send, wired to `emitWithAck('chat.typing.v1')` without waiting for the ack. Verify with Vitest on `shouldPulseTyping` (empty value, inside the interval, after the interval, after send).
- [ ] 5.5 Switch `useMarkRead` to the socket (`chat.read.v1`) when `socket.connected`, falling back to `POST …/read` when not connected or when the ack is not `ok`; keep the list invalidation on the REST path only. Verify with Vitest: connected-ok sends no REST call, not-connected falls back, a failed ack falls back.
- [ ] 5.6 Replace the unconditional read effect in `ChatTranscript` with `useReadOnView` backed by a pure `shouldReportRead({ windowActive, atEnd, newestSeq, reportedSeq })`. `windowActive` comes from `visibilitychange`/`focus`/`blur`; `atEnd` from the vendored scroller hooks (check which of `useMessageScrollerScrollable`/`useMessageScrollerVisibility` exposes it, otherwise an `IntersectionObserver` on the last row). Verify with a Vitest truth table for `shouldReportRead` and that the existing outbox and `buildRows` tests still pass.

## 6. Live verification

- [ ] 6.1 In the dev stack (ask before restarting the API, and keep the page focused: `hasFocus()` matters), open the chat in two tabs of one user and drive a second user over REST and a Node socket client. Confirm and record:
  - a colleague's typing shows in the open conversation and disappears on send and on lapse;
  - the user's own typing does not show in their other tab;
  - a message that arrives while the window is blurred or scrolled up leaves the unread badge, and returning or scrolling down clears it in both tabs;
  - after an API restart the open conversation re-announces itself and typing works again;
  - with the window idle, no chat requests are issued.

## 7. Documentation (promote before archiving)

- [ ] 7.1 Update `docs/chat.md`: §4.8.2 becomes "built in 0.2b" with the real event names, the `expiresInMs` correction, the room rules (D2) and the read-on-view rule (D6), and names CHAT-0.2c (notifications with viewer suppression, presence dot) as the rest; §7.3 and §7.5 gain the 0.2b/0.2c rows; the known gap about leaving rooms on removal is recorded under CHAT-0.3. Verify with a grep that no doc still lists typing, subscribe or read as "planned" for 0.2b.
- [ ] 7.2 Update `docs/modules.md` §7.2 with the inbound registry (`defineClientSocketEvent`, `CLIENT_SOCKET_EVENTS`, `ClientEventRegistry`) and `docs/realtime.md` with the client → server contract (ack envelope, closed codes, rate limit, tenant context, why not `@SubscribeMessage`). Add the CHAT-0.2b row to `docs/roadmap.md`.
- [ ] 7.3 Run the full gate `bash scripts/ci-verify.sh` and confirm it is green before commit.
