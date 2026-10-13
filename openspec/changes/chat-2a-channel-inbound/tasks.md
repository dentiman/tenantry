# Tasks

Load the `backend-change` skill before sections 1, 3, 4 and 5.

## 1. Schema and migration

- [ ] 1.1 Add `libs/database/prisma/schema/channels.prisma` with `MessagingAccount`, `Channel`, `ChannelContact`, `ChannelContactAddress`, `ChannelWebhookEvent` (tenant-scoped, composite FKs, `tenantId` DB default as in `chat.prisma`) and `ChannelUnroutableEvent` (no tenant); extend `Conversation` (`channelId`, `contactId`, `customerLastMessageAt`, `assigneeId`) and `ChatMessage` (`direction`, `channelId`, `externalId`, `senderContactId`, `providerMeta`); add `SENDING` to `MessageStatus`. Verify with `pnpm db:generate` and `prisma validate`.
- [ ] 1.2 Create the migration (`cd libs/database && pnpm exec prisma migrate dev --name chat_channels`): RLS `ENABLE`+`FORCE` and policies for every tenant table, the partial unique indexes (`conversations(contact_id) WHERE status <> 'RESOLVED'`, `chat_messages(tenant_id, channel_id, external_id) WHERE external_id IS NOT NULL`, `channels(provider, external_id)` among non-missing, `messaging_accounts(tenant_id, provider)`, `webhookKey`), `resolve_account_by_key(provider, key)` and `record_unroutable_event(...)` as `SECURITY DEFINER` with `REVOKE … FROM PUBLIC` and `GRANT … TO saas_app`, and grants for `saas_platform` on the unroutable table. Mirror any generated or partial index in the Prisma schema so `migrate diff` is empty. Verify with `pnpm db:reset` from scratch, then `prisma migrate diff` reporting no drift.
- [ ] 1.3 Extend the RLS isolation test with every new tenant table (tenant B sees no row of tenant A; `saas_app` cannot read `channel_unroutable_events` directly; the lookup function returns only ids). Verify the new cases fail when the policy is removed.

## 2. Contracts, adapter contract and the fake provider

- [ ] 2.1 Add to `libs/contracts/src/chat/` the schemas: `NormalizedEvent` (`message`, `unsupported`), channel, account (credentials as set/not-set booleans), contact, inbox entry and filter, link-customer input, `chat.inbox-changed.v1` socket event (registered in the realtime event map). Verify with `pnpm typecheck` and a Vitest on the discriminated union (valid, unknown kind rejected).
- [ ] 2.2 Add `libs/shared/src/channels/`: `ChannelAdapter` interface, capability flags, `ChannelAdapterRegistry`, and `ChannelSendError` placeholder types only if 2b needs them (omit otherwise). Verify with `pnpm modules:check --strict`; the new directory is covered by a `chat` path pattern.
- [ ] 2.3 Implement `FakeChannelAdapter` (JSON wire format, HMAC-SHA256 over raw bytes in `X-Fake-Signature-256`, handshake, `parseWebhook` for message and unsupported) registered only when `CHAT_DEV_TOOLS` is set. Verify with adapter contract tests that any adapter must pass (signature over bytes not meaning, handshake, empty and batched bodies, malformed body yields no event and no throw) — the suite is written against the interface so 3a can reuse it.
- [ ] 2.4 Add phone matching helpers over `libphonenumber-js` (E.164 plus candidate list) in `libs/shared/src/channels/`. Verify with unit tests: leading plus or not, spaces, a number with no region, an invalid number (no crash, no match).

## 3. Public webhook

- [ ] 3.1 Enable `rawBody: true` in `configureApp()` / bootstrap shared by `main.ts` and the e2e, with a 3 MB route limit for `/public/channels/*` only. Verify that `req.rawBody` equals the exact bytes sent in an e2e, and that other routes keep their existing limit.
- [ ] 3.2 Add a `channel-webhook` named limit (generous, per key and per address) in `libs/shared/src/auth/throttler` and apply `@RateLimit('channel-webhook')`. Verify with an e2e that a burst beyond the limit gets a retry hint and stores nothing.
- [ ] 3.3 Add `apps/api/src/chat/channel-webhook.controller.ts` (`@Public()`): GET handshake and POST per design D3 — resolve by key, tenant context, decrypt secret, verify over raw bytes, one `withTenantTx` inserting `channel_webhook_events` and `publish(tx, channelsIngestWebhookCommand, { eventId })`, then 200. Add the command definition in `libs/shared/src/messaging/definitions/chat.messages.ts` with its `MESSAGE_TOPOLOGY` entry. Verify with e2e: handshake right/wrong/unknown, valid signature stored once, altered byte → 401 and nothing stored, re-serialised JSON → 401, unknown key → 200 plus an unroutable row without a tenant and without a body, disabled channel → 200 and unroutable, poison signed body → 200 and `FAILED`, byte-identical repeat → one row, failing transaction → 5xx.
- [ ] 3.4 Run the existing e2e suites that post JSON bodies (`auth`, `customers`, `files`, `chat`) after 3.1 and confirm green (rawBody must not change parsing).

## 4. Ingest (worker)

- [ ] 4.1 Add `ChannelIngestService` in `libs/shared/src/channels/` (used by the worker, testable against a real database): per message one transaction doing contact/address resolution (D5, auto-link only when exactly one customer matches), find-or-open conversation (D6, partial unique with catch-and-reread, reopen window from `channels.settings`, default 24 h), `INSERT … ON CONFLICT DO NOTHING RETURNING` on the message, and only on a returned row: next `seq`, `last_message_at`, `customer_last_message_at` from provider time, preview, after-commit inbox signal. Verify with real-database tests: redelivery creates one message and counts once; `Promise.all` of the same provider message creates one; concurrent first messages from one contact open one conversation; delayed delivery keeps provider time and takes the next `seq`; duplicate burns no `seq`; address in two formats resolves to one contact; phone with exactly one / two / zero matching customers.
- [ ] 4.2 Add `apps/worker/src/chat/channels-ingest.subscriber.ts` (`@MessageSubscriber`, `singletonKey = channelId:address`, `inbox.runOnce` for database effects only): load the event, parse with the adapter, mark `PROCESSED`/`FAILED` (poison payload does not throw), record unroutable per change for a channel that is unknown, disabled or of another account. Register it in `worker.module.ts`. Verify with a unit test of the subscriber and a worker boot where the topology guard passes.
- [ ] 4.3 Make the worker emit `chat.inbox-changed.v1` to the tenant room after commit through the headless emitter (`apps/worker/src/realtime/`). Verify with a test that a connected tenant socket receives it and a socket of another tenant does not.

## 5. Access, inbox and linking (API)

- [ ] 5.1 Implement the `tenant` branch in `ConversationAccessService` (D7): active tenant user passes without membership; `membership` becomes optional in the return type and every caller is updated (mark-read and unread paths do nothing without membership). Verify with e2e: a non-participant reads a customer conversation; the same user still gets 404 for a private one; an admin still gets 404 for a private one; a user of tenant B gets 404; a deactivated user is refused; and a negative test that creating a tenant-access conversation is impossible through the internal create endpoint.
- [ ] 5.2 Add `GET /chat/inbox` (filter `mine|unassigned|all`, opaque cursor, `awaitingReply`, no personal unread) and `GET /chat/channels`, `GET /chat/contacts/:id`. DTOs from contracts, mapper, Swagger. Verify with e2e covering the three filters, ordering after a new inbound message, pagination without repeats or gaps, and tenant isolation.
- [ ] 5.3 Add `POST /chat/contacts/:id/link-customer` and `POST /chat/contacts/:id/create-customer` (create through the customers module's exported service, not its tables) and unlink. Verify with e2e: link, create-from-contact (name and phone copied), already linked → 409, customer of another tenant → 404, unlink then relink.
- [ ] 5.4 Add the account/channel read endpoints for admins (`GET /settings/messaging`, credentials as booleans only) and a test that no response or log line contains a credential. Verify by grepping the serialised responses and the captured logs of the e2e for the secret.
- [ ] 5.5 Extend the account read with the webhook block (D3a): address from `CHANNEL_WEBHOOK_BASE_URL` (null when unset), verify token and address for administrators only, `signingSecretSet`, `lastDeliveryAt` and the last-24-hour counts by event state and unroutable. Verify with e2e: counts follow stored and unroutable deliveries, nothing arrived → empty and zero, no base URL → address null, a non-admin does not receive the token or the address. Add `CHANNEL_WEBHOOK_BASE_URL` to `.env.example` with a comment.
- [ ] 5.6 Run `pnpm openapi:generate && pnpm web:codegen` and commit both outputs; verify `pnpm typecheck` and that only the new endpoints and schemas appear in the diff.

## 6. Development tooling

- [ ] 6.1 Gate by `CHAT_DEV_TOOLS`: `POST /dev/chat/fake-channel` (creates the fake account and channel, returns the webhook address and signing secret to an admin) and `POST /dev/chat/simulate` (sends a signed fake body to the tenant's own public webhook over HTTP). Verify with e2e: with the flag, simulate → contact and conversation appear; the same simulated provider message twice → one message; without the flag both routes answer 404.
- [ ] 6.2 Add `scripts/chat-simulate.ts` and the `pnpm chat:simulate` script (login or token from env, sender, text, optional provider message id). Verify by running it against the dev stack and seeing the conversation in the inbox.

## 7. Platform visibility

- [ ] 7.1 Add a read-only platform-api endpoint and a minimal list in platform-web for `channel_unroutable_events` (reason, provider, key hash, time, address; no body). Verify with a platform e2e that an operator sees a row produced by 3.3 and that the tenant API cannot read the table.

## 8. Web

- [ ] 8.1 Add the customer inbox to the Chat area: an Inbox entry beside the internal conversations with the mine/unassigned/all filter, rows showing channel, contact name, linked customer, preview, time and awaiting-reply; empty, loading and error states; the open customer conversation renders its transcript read-only (no composer — sending is 2b). Verify with Vitest on the pure row/label helpers and by eye in 9.1.
- [ ] 8.2 Add the contact card in the context panel with the link/create/unlink actions and a customer picker (search through the existing customers API). Verify with a component test of the state machine (unlinked → linked → unlinked) and by eye in 9.1.
- [ ] 8.3 Subscribe the inbox to `chat.inbox-changed.v1`: invalidate the inbox query and, for the open conversation, its transcript; on reconnect re-read. Verify with a test that the notice triggers a refetch and carries no state that is applied directly.
- [ ] 8.4 Add the webhook block to the account settings screen (address with a copy button, verify token, signing secret set/not set, last delivery and daily counts, a clear "no public address configured" state). Verify with a component test of the four states (unset base, nothing received, healthy, failures present) and by eye in 9.1.
- [ ] 8.5 Add the dev-only simulator panel (visible only when the API reports dev tools enabled) and all texts in `apps/web/src/locales/en/chat.json`. Verify that `registry-texts.test.ts` and the i18n key checks pass and that the panel is absent when the flag is off.

## 9. Live verification

- [ ] 9.1 In the dev stack with `CHAT_DEV_TOOLS=true` (API and worker both on the new code; ask before restarting the user's processes): create the fake channel, simulate from a new number and see a contact plus an inbox row within about a second with the inbox already open; simulate from a number that exactly one demo customer has and see it auto-linked; simulate the same provider message twice and see one message; simulate from a number two customers share and see it unlinked; link and unlink from the card; open the conversation as a second user and see it; confirm an internal private conversation stays invisible to a non-participant. Record the result.
- [ ] 9.2 Replay the signature failures against the running API with `curl` (altered byte, re-serialised body, wrong key) and confirm the status codes in design D3.

## 10. Documentation (promote before archiving)

- [ ] 10.1 Update `docs/chat.md` (§7.3 CHAT-2a built, §4.4 `tenant` branch implemented), `docs/whatsapp-channel.md` (§6 status of 2a; §4.1 notes any column that changed during implementation), `docs/event-driven-architecture.md` (the `channels.ingest-webhook` command and its consumer), `docs/realtime.md` (`chat.inbox-changed.v1`), `docs/roadmap.md`, and `docs/modules.md` if the graph moved. Verify with a grep that no doc still lists 2a items as pending.
- [ ] 10.2 Add end-user lines for the inbox (what a customer conversation is, filters, linking a contact) to `docs/ai-knowledge/` using the English locale labels, then run `pnpm ai:knowledge`.
- [ ] 10.3 Run the full gate `bash scripts/ci-verify.sh` and confirm it is green before commit.
