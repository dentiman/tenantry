# Tasks

Load the `backend-change` skill before sections 1, 4, 5, 6 and 7. Every section that touches Graph is
tested against a **local Graph stub** (an HTTP server the test starts and points `META_GRAPH_BASE_URL` at);
only section 11 talks to Meta.

## 1. Schema and migration

- [ ] 1.1 Add `appId` to `MessagingAccount` and `providerMeta Json @default("{}")` to `Channel`; add `ChannelLog` (`channels.prisma`: `accountId`, `messageId?`, `operation`, `ok`, `httpStatus?`, `errorCode?`, `errorTitle?`, `durationMs`, `detail Json`, `createdAt`; composite FK to the account; indexes `(tenantId, accountId, createdAt desc)` and `(createdAt)`). Verify with `pnpm db:generate` and `prisma validate`.
- [ ] 1.2 Migration `chat_whatsapp_send`: the new columns and table, RLS `ENABLE`+`FORCE` and the `tenant_isolation` policy on `channel_logs`, and the partial unique `(account_id) WHERE is_default AND provider_missing_at IS NULL` on `channels` after a pre-check that no account has two defaults (fail loudly if it does). Written from `migrate diff`, applied with `migrate deploy`. Verify that it applies on the fresh e2e database and that `migrate diff` shows no drift beyond the standing `tenant_id` default noise.
- [ ] 1.3 Add `channel_logs` to the RLS isolation test and a case for the single-default index (a second default in one account is a unique violation, in another account is fine). Verify the cases fail when the policy / index is removed.

## 2. Contracts

- [ ] 2.1 In `libs/contracts/src/chat/`: `ConnectMessagingAccount` (`provider: 'meta_cloud'`, `wabaId`, `accessToken`, `appId?`, `appSecret?`), `UpdateAccountCredentials`, `UpdateChannel` (`isEnabled?`, `isDefault?`), the admin account response (`token { mask, kind, expiresAt, scopes, verified, checkedAt } | null`, `appIdSet`, `lastSyncAt`, `lastError`; per channel `qualityRating`, `mode`, `isMissing`, `nameStatus`), `SyncResult` (created/updated/missing/skipped counts), `ChannelLogEntry` + list, `StartConversation` (`channelId`, `phone`, `name?`), `PostTemplateMessage` (`name`, `language`, `clientMessageId`), `deliveryReceipts` on the channel response and the conversation `contact` block. Verify with `pnpm typecheck` and a Vitest of the input schemas (template name/language patterns, phone required, token never in any response schema).
- [ ] 2.2 Add `capabilities.templates` and `capabilities.windowEnforcement` to the adapter contract (`libs/shared`), `template?` to `OutboundContext`, and set them on the fake adapter (`templates: true`, `windowEnforcement: 'local'`). Verify with `pnpm typecheck` and the existing adapter contract suite, extended: every adapter declares both fields.
- [ ] 2.3 Regenerate OpenAPI and the web clients after section 5/7 controllers exist (task 8.0 repeats it); here only the contract types compile.

## 3. Graph client and `MetaCloudAdapter` (`libs/shared/src/channels/meta-cloud/`)

- [ ] 3.1 `graph-client.ts` as in design D1: bearer header, base URL and version from env, 10 s timeout, `MetaApiError`, redactor, call callback. Verify with unit tests against a local stub server: token only in the header; a Graph error becomes `MetaApiError` with code/subcode/title; a message that echoes the token is redacted; a timeout is reported; the callback receives path without query and no body.
- [ ] 3.2 `errors.ts`: the table of design D5 as data and `classifyMetaError`. Verify with a unit test that pins **every** listed code to its class and covers unknown 4xx → `PERMANENT`, unknown 5xx / network / timeout → `TRANSIENT`, `131030` title, and `Retry-After` carried for rate limits.
- [ ] 3.3 `meta-cloud.adapter.ts`: `send` for text and template (design D4), `capabilities`, and no-op `verifyWebhook` / `handshake` / `parseWebhook` that return `false` / `null` / `{ events: [], error: 'webhooks_not_enabled' }` (3b implements them) so the interface stays satisfied and an accidental webhook is rejected, not misparsed. Verify by running the shared adapter contract suite against it with the stub as transport (`okSend` fixture), plus unit tests: request body shapes for text and template, `to` in digits, a 2xx without a message id is `TRANSIENT`, `message_status` neither needed nor trusted, `biz_opaque_callback_data` present.
- [ ] 3.4 Register `meta_cloud` in `createChannelAdapterRegistry` unconditionally. Verify with a unit test of the registry with and without `CHAT_DEV_TOOLS`.
- [ ] 3.5 Add a small stub Graph server for tests (`libs/shared/src/channels/meta-cloud/testing/graph-stub.ts`, exported only to tests) implementing `debug_token`, `GET /{waba}`, `phone_numbers` with paging, and `POST /{phone}/messages` with scriptable answers (success, any Meta error code, 5xx, delay). Verify by using it in 3.1–3.3.

## 4. Call log

- [ ] 4.1 `ChannelLogService.record(tx, entry)` with a typed entry and whitelisted `detail` keys, redaction of `error_title`, recipient masked to last four digits; `list(accountId, cursor, limit)` keyset on `(created_at, id)`. Verify with real-database tests: no secret, no text and no full number ever reach the row (assert on the serialised row for a send whose body and token are known strings); newest-first paging; RLS isolation.
- [ ] 4.2 Add the daily `channels.purge-logs` command (`04:30`, system scope, `retryLimit: 1`) to `chat.messages.ts`, the topology and a worker subscriber; 30-day retention constant. Verify that the worker boots and with a real-database test that old rows are removed and recent ones stay.
- [ ] 4.3 Write a log entry from `ChannelDeliveryService.settle` for every send outcome (success and each class), with the measured duration. Verify with extensions of `chat-delivery.e2e-spec.ts`: one entry per attempt, success and failure, linked by `message_id`.

## 5. Connecting an account (API)

- [ ] 5.1 `WhatsAppConnectionService` (`apps/api/src/chat/`): verification of design D2 (debug_token with the app token when `appId`+`appSecret` are given, WABA read always, scopes required only with the secret, `health_status` shown not enforced), storing encrypted token/secret/app id with `token_kind`, `token_expires_at`, `scopes`, `token_checked_at`, name from the WABA, status `CONNECTED`; connect, re-authenticate (replace only on success), disconnect (credentials deleted, `DISABLED`, history kept). Verify with e2e against the Graph stub: valid token; missing messaging scope (names it); no access to the WABA (`fieldErrors` on `wabaId`); invalid token (`accessToken`, token not echoed); connect without secret (kind/permissions reported unverified); a temporary token shows its expiry; re-authenticate keeps channels and conversations and a bad replacement keeps the old token; a second connect is `409`; a non-admin is `403`; the stub's request log proves the token was only ever sent as a bearer header.
- [ ] 5.2 Number synchronisation (design D3): paged read with the minimal-field fallback, upsert by provider id with the cross-tenant skip, `provider_meta`, missing marking, new channels disabled, "Refresh" endpoint, `SyncResult`. Verify with e2e against the stub: first sync of two numbers; a repeated sync changes nothing; a vanished number with conversations is marked missing and stays; a number already registered to another tenant is skipped and reported; a field-list rejection falls back; two pages are both read.
- [ ] 5.3 `PATCH /settings/messaging/channels/:id` (enable/disable, default) with the `SELECT … FOR UPDATE` serialisation and the refusal for missing channels; the starting-conversation and send paths refuse a disabled channel. Verify with e2e: exactly one default after two concurrent default requests (`Promise.all`); enabling a missing channel is refused; a disabled channel refuses a send and starting a conversation, history untouched.
- [ ] 5.4 Admin account response with token info, masks and `deliveryReceipts`; `GET …/logs`. Verify with e2e that the response never contains the token or secret anywhere (serialised-response assertion), shows only the last four characters, `deliveryReceipts` is `false` for `meta_cloud`, and the logs endpoint is admin-only, newest first and tenant-isolated.
- [ ] 5.5 Named rate limit on the Meta-calling endpoints. Verify with e2e that the limit answers `429` with `Retry-After` and that other settings routes are unaffected.

## 6. Window and template sending

- [ ] 6.1 `replyWindow` honours `windowEnforcement: 'provider'` (null last message → `canReply: true`, `endsAt: null`); the API check, the worker re-check and the conversation response all go through it. Verify with unit tests of the function (local vs provider, null vs known, expired, no window) and e2e: a text into a Meta conversation with no inbound is accepted and queued; the same on a fake conversation is still `422`.
- [ ] 6.2 `POST /conversations/:id/template-messages` (design D7): payload `{ template }`, body = name, same claim/reopen/`publish` path as a reply, window exempt, `422` when the adapter has no `templates`, idempotent on `clientMessageId`. Delivery passes `template` to the adapter and skips the window check for it. Verify with e2e and real-database delivery tests: queued with the payload; accepted with a closed window and with none; replayed id queues once; racing identical requests queue once; the worker sends a template (stub receives `type: template` with name and language) and a text (stub receives `type: text`); a template send claims an unassigned conversation.
- [ ] 6.3 Delivery against the Meta adapter end to end with the stub: success stores the provider id and `SENT`; `131047` → `FAILED(WINDOW_CLOSED)`; `190` → `FAILED(AUTH)` and the account `NEEDS_REAUTH`; `130429` → retry then success; 5xx → retry to the bound; `131030` → `FAILED(PERMANENT)` with the allowed-list title; a stub timeout is transient. Verify with `chat-delivery`-style real-database tests using the stub and the real adapter.

## 7. Starting a conversation

- [ ] 7.1 Extract `ChannelContactService` (`resolveContact`, `autoLinkCustomer`, `resolveConversation`) from `ChannelIngestService` into `libs/shared/src/channels/` and make ingest use it, with no behaviour change. Verify that `chat-channels-ingest`, `chat-customer-inbox`, `chat-dev-tools` and the inbound cases of `chat-delivery` pass **unchanged**.
- [ ] 7.2 `POST /chat/outreach` (design D9): validation (`400` with a field error for an invalid number), enabled own-tenant channel (`404` otherwise), reuse of the contact and of its open conversation, a new conversation when the previous is resolved, auto-link under the one-customer rule, no message and no system entry. Verify with e2e: new number; existing open conversation returned; resolved → new conversation for the same contact; invalid number; disabled / foreign / missing channel; exactly-one-customer link and the two-customers case; two simultaneous starts (`Promise.all`) yield one conversation.

## 8. Web

- [ ] 8.0 Regenerate the OpenAPI document and both web clients (`pnpm openapi:generate && pnpm web:codegen`, platform pair if its document changed). Verify with `pnpm typecheck`.
- [ ] 8.1 Settings: "Connect WhatsApp" form (WABA id, access token, optional app id and secret, with the explanation of what each is for and what stays unverified without the secret), account card with token state (mask, kind badge, expiry countdown for a temporary token, scopes or "not verified"), numbers table (quality, mode, status, enabled switch, default radio, missing badge), "Refresh", "Update token", "Disconnect", the receipts notice, and the recent call log. Verify with Vitest on the pure helpers (token badge / countdown, number row state, error code → text) and the live run in section 11.
- [ ] 8.2 "New customer conversation" in the Customers tab: dialog with the enabled channels, phone and optional name, opening the returned conversation. Verify with Vitest on the form schema and the live run.
- [ ] 8.3 Composer: "Send template" (name and language, defaulting to the last used, remembered per browser) for customer conversations, available also when the window is closed; the template bubble in the transcript from the payload; the receipts notice when `deliveryReceipts` is false. Verify with Vitest on the pure state (`effectiveMode` with templates, bubble text from payload) and the live run.
- [ ] 8.4 Texts in `locales/en/chat.json` for everything above, including the verification error codes and `CHANNEL`/`AUTH` failure explanations ("reconnect the account"); `registry-texts` and `nav` tests pass.

## 9. Dev tooling

- [ ] 9.1 `scripts/chat-connect-meta.ts` and `pnpm chat:connect-meta` (design D12), with `--send` and `--text`. Verify with `--help`, lint, and its use in section 11.

## 10. Regression

- [ ] 10.1 Run the new suites plus `chat-outbound`, `chat-delivery`, `chat-channels-*`, `chat-customer-inbox`, `chat-dev-tools`, `rls`, `notifications`, `messaging` and confirm green.

## 11. Live verification (the owner's test WABA; `.env` has the values; ask before restarting the user's processes)

- [ ] 11.1 With api and worker on the new code: `pnpm chat:connect-meta` connects the default tenant. Confirm and record: the token kind, expiry and scopes reported; the account name from the WABA; the numbers synced with their ratings; the settings screen shows all of it and no secret; a wrong token is rejected with the right message and stores nothing.
- [ ] 11.2 `pnpm chat:connect-meta --send`: start a conversation with `WHATSAPP_TEST_RECIPIENT`, send `hello_world`/`en_US`, then a text. Confirm the phone receives them, the messages show `SENT` with Meta's ids, the call log shows both sends with masked numbers and no content, and record whether Meta accepts `biz_opaque_callback_data` at the top level of the body (if it answers `100`, drop the field and note the finding for CHAT-3b).
- [ ] 11.3 Provoke real errors and record the codes Meta returns: a text to a number with no open window (expect `131047` → `WINDOW_CLOSED` and the template path), a recipient outside the allowed list (expect `131030`), a bad template name, an invalid token (expect `190` → `NEEDS_REAUTH`, then re-authenticate and send again). Add any code the table lacks.
- [ ] 11.4 In the browser (Orca): connect form, account card, numbers, start a conversation, send a template and a text, the receipts notice. Record anything that does not fit or read well.

## 12. Documentation (promote before archiving)

- [ ] 12.1 Update `docs/whatsapp-channel.md` (§4.5 error table "as verified", §4.13 as built incl. the two verification modes, §6 status, §8.1 with the live results), `docs/whatsapp-research/` (a new live-probe note with the codes and the `biz_opaque_callback_data` finding), `docs/whatsapp-feature-flows.md` (connecting runbook), `docs/chat.md` (channel logs, outreach, the window rule), `docs/event-driven-architecture.md` (the purge), `docs/roadmap.md`, `AGENTS.md` if the map changed. Verify with a grep that no doc still lists 3a items as pending.
- [ ] 12.2 Add the end-user lines (connecting a WhatsApp account as an administrator, enabling numbers, starting a conversation, templates, what is not available until the webhook) to `docs/ai-knowledge/` (`08-settings-organization.md` and `13-chat.md`), copying labels from `locales/en/chat.json`, and run `pnpm ai:knowledge` (the corpus tests expect the document count and the `ApiError` rows — update them if a code is added).
- [ ] 12.3 Run the full gate `bash scripts/ci-verify.sh` and confirm it is green before commit.
