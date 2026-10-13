# Патерни WhatsApp-каналу з опенсорс-проєктів
> **Знімок дослідження 2026-10-13 (англійською, як згенеровано).** Це довідковий додаток до [whatsapp-channel.md](../whatsapp-channel.md): рішення й план — там, тут — докази. Не редагується руками; при зміні фактів дослідження повторюють і замінюють файл.
> Шляхи `oss/…`, `oss2/…` — шалоу-клони у scratchpad дослідження (у репозиторій не входять); читати як посилання на файли в апстрімі на дату знімка. Ліцензії — розділ 5: BSL/FSL/AGPL-проєкти — лише патерни, не код.

# WhatsApp channel: patterns from local OSS clones (condensed)

Date 2026-10-13. Paths are relative to `scratchpad/` (SP). "V" = verified by reading code, "R" = recalled/inferred, not read here.
Chatwoot (CW) base: `oss/chatwoot/`. All CW paths below are under `app/` unless noted.

## 1. Chatwoot, deep (V unless marked)

### 1.1 Inbound path
- `controllers/webhooks/whatsapp_controller.rb`: route is `/webhooks/whatsapp/:phone_number`. Checks `X-Hub-Signature-256` (HMAC-SHA256 over raw body). Rejects numbers on a global inactive list. Skips payloads that only carry `tracking_events`. Then `WhatsappEventsJob.perform_later` and `head :ok`. GET handles `hub.verify_token` against a per-channel `provider_config['webhook_verify_token']`.
- `controllers/concerns/meta_token_verify_concern.rb`: `secure_compare` against a set of candidate secrets (per-channel keys, plus a global `WHATSAPP_APP_SECRET`). Signature is **mandatory only for embedded-signup channels or when a channel secret exists**. A manual channel with no secret skips verification (weak default).
- `services/whatsapp/webhook_channel_finder_service.rb`: resolves channel from payload `metadata.display_phone_number` plus `phone_number_id`. Tries raw digits, then a country-normalized form. Accepts a candidate only if its stored `phone_number_id` matches. Payload metadata beats the URL param (one app serving many numbers).
- `jobs/webhooks/whatsapp_events_job.rb`: queue `low`. Mutex per `(inbox, sender_id)` with a 30 s TTL, because album media arrive as concurrent webhooks. `retry_on LockAcquisitionError` is 20 attempts x 2 s, deliberately longer than the lock TTL. Status-only webhooks skip the lock. Lock key prefers `parent_user_id`, then `user_id`, then `from` (BSUID aware). Routes `smb_message_echoes` (coexistence: message sent from the WA Business app) to an outgoing-echo path.
- `services/whatsapp/incoming_message_base_service.rb`: the ingest core.
  - Skips reactions, ephemeral and `request_welcome`.
  - Dedupe: `find_message_by_source_id`, then `Whatsapp::MessageDedupLock` (Redis `SET NX EX 1 day` on the wamid).
  - Then `set_contact`, and a transaction of `set_conversation` + `create_messages`.
  - `type: unsupported` is persisted as a placeholder message with `is_unsupported`, so the thread is not headless.
  - Stores `referral` (click-to-WA ads), Flow `nfm_reply` JSON, and `in_reply_to` (found by external id).
  - Echo messages get status `delivered`, so the send job never resends them.
  - Contact name updated from profile name only if the current name equals the phone number.
- `services/whatsapp/message_dedup_lock.rb`: the Redis lock above.
- `services/whatsapp/incoming_message_whatsapp_cloud_service.rb`: media download is 2 steps. GET `media_url(id)` with the bearer token returns a JSON `url`, then `Down.download(url, headers)`. A 401 calls `channel.authorization_error!` (marks channel for reauthorization). Preserves the payload `filename`.
- `services/whatsapp/incoming_message_service_helpers.rb`: message-type map. image/sticker to image, audio/voice to audio, location, contacts, else file.
- `db/schema.rb`: `contact_inboxes` has a **unique** index `(inbox_id, source_id)` (line ~789). `messages.source_id` has a **non-unique** index (line ~1393), so message dedupe is Redis + lookup only.

### 1.2 Identity, phone normalization, BSUID
- `services/whatsapp/phone_normalizers/{base,brazil,argentina,mexico}_phone_normalizer.rb`:
  - Brazil: adds the mobile 9 only for legacy 8-digit ranges `[6-9]\d{7}`, never landlines. Has `variants` for lookup.
  - Argentina: `549` becomes `54`. **No `variants` override**, because a 54 number without the 9 may be a valid landline, so synthesizing an alias could answer as a different subscriber.
  - Mexico: strips the `1` after `52` only on the 13-digit form.
- `services/whatsapp/phone_number_normalization_service.rb`: finds an existing `contact_inbox` under any equivalent variant. The stored `source_id` wins; otherwise the raw wa_id is used.
- `services/whatsapp/incoming_message_identifier_helper.rb`:
  - Builds an ordered list of source ids: phone first, then parent BSUID and BSUID.
  - If the caller was first seen BSUID-only, BSUID history wins.
  - A mixed payload for a new caller starts on the phone.
  - `ContactInboxSourceIdResolver` picks or creates the contact_inbox.
- `services/whatsapp/identity_source_id_orderer.rb`: keeps conversation history on whichever identifier already has conversations.
- `services/whatsapp/user_id_rotation_service.rb`:
  - Handles system messages `user_changed_user_id` and `user_changed_number`. Reads typed `system` fields, never the human text.
  - Records new ids as **aliases** of the existing contact. Old aliases stay.
  - Locks all involved ids. **Conflicting identifiers (multiple contacts) are logged and never auto-merged.**
- `services/whatsapp/providers/base_service.rb#recipient_params`: BSUID goes in `recipient`, a phone goes in `to`.
- `services/whatsapp/authentication_template_guard.rb`: a BSUID-only recipient cannot receive an authentication-category template (needs a phone). The template must exist in the synced list.
- `incoming_message_base_service.rb#set_conversation`: conversation reuse is scoped to the `contact_inbox` (the exact identity), not the contact. 360dialog keeps contact-wide reuse because it cannot address a BSUID.
- `lib/regex_helper.rb`: `WHATSAPP_BSUID_REGEX`.

### 1.3 Outbound, 24h window, templates, statuses
- `models/message.rb:~408`: after-commit enqueues `SendReplyJob` (queue `high`). If attachments are present it waits 2 s, because ActiveStorage attaches after commit (a race workaround).
- `services/whatsapp/send_on_whatsapp_service.rb`:
  1. Template params present: `TemplateProcessorService`, then `send_template`.
  2. Contact-info-request: eligibility check, then send.
  3. `conversation.can_reply?`: `send_message`.
  4. Otherwise the message is marked `failed` with `message_outside_messaging_window`.
  The returned wamid is saved to `message.source_id` **after** the API call.
- `services/conversations/message_window_service.rb`: WhatsApp window is 24 h from `last_incoming_message.created_at`. This is the server's row time, not Meta's timestamp. No incoming message at all means false.
- `services/whatsapp/providers/whatsapp_cloud_service.rb`: text, attachment, interactive (`input_select`), template. `process_response` returns the wamid or marks the message `failed` with Meta's `error.message`. There is **no retry classification**. Graph versions are hardcoded and mixed (v13, v14, v22, v24).
- `services/whatsapp/media_upload_service.rb`: uploads the file to Meta and sends by media `id`. This avoids Meta fetching our URL (error 131053 per destination ASN).
- `services/messages/status_update_service.rb`: `with_lock`, then re-check the transition. Forward-only by enum priority. `failed` is allowed from anywhere and out of `failed`. Keeps the old `external_error`.
- `incoming_message_base_service.rb#process_statuses`: finds the message by `source_id`. **If it is not found the status is silently dropped.** Error is stored as `"code: title"`.
- Templates:
  - `models/channel/whatsapp.rb`: `message_templates` JSONB cached on the channel row, plus `message_templates_last_updated`.
  - `jobs/channels/whatsapp/templates_sync_job.rb` and `templates_sync_scheduler_job.rb`: sync with cursor pagination.
  - `template_processor_service.rb`, `populate_template_parameters_service.rb`, `template_parameter_converter_service.rb`: build send params.
  - `csat_template_service.rb`: creates a UTILITY CSAT template through the API.
  - UI picker: `javascript/dashboard/components-next/whatsapp/WhatsAppTemplateParser.vue`.

### 1.4 Channel lifecycle, credentials, reopen rules
- `models/channel/whatsapp.rb`:
  - Table `channel_whatsapp`, unique `phone_number`, `provider_config` JSONB (holds `api_key`, `phone_number_id`, `business_account_id`, `webhook_verify_token`, `source`).
  - Only `business_management_token` uses `encrypts`. The `api_key` in JSONB is plain.
  - Validates credentials remotely on save (`validate_provider_config?`).
  - `after_commit` webhook setup; `before_destroy` teardown (`webhook_setup_service.rb`, `webhook_teardown_service.rb`).
  - `Reauthorizable` concern: `prompt_reauthorization!`.
- `embedded_signup_service.rb`, `token_exchange_service.rb`, `reauthorization_service.rb`, `channel_creation_service.rb`: embedded signup, token exchange, reauth that verifies the same phone number.
- `health_service.rb` plus `jobs/channels/whatsapp/health_sync*_job.rb`: persists quality rating, messaging tier, status, throughput. Error code 190 means authorization error.
- Reopen: `models/message.rb#reopen_conversation`. An incoming message reopens snoozed or resolved conversations. A bot-active inbox sets `pending` instead. `inbox.lock_to_single_conversation` reuses the last conversation even if resolved.
- Campaigns: `services/whatsapp/oneoff_campaign_service.rb` and `jobs/campaigns/send_whatsapp_batch_job.rb`. Cursor-batched self-re-enqueueing job, audience by contact labels, Liquid template params, skips contacts without a usable destination. No rate limiting seen.
- Other: `contact_info_request_*` services (ask the user to share their number, needed for BSUID), `useWhatsappCallSession.js` (Calling API), `in_reply_to_message_finder.rb`.

## 2. Short cards

### Evolution API (`oss2/evolution-api`)
- **Inbound auth and routing (V):** `src/api/integrations/channel/meta/meta.router.ts` has GET verify with one **global** env `TOKEN_WEBHOOK`. POST has no check. A grep for `x-hub-signature` over `src` finds nothing, so no signature verification. `meta.controller.ts` routes by `entry[].changes[0].value.metadata.phone_number_id` to `instance.number`, then calls `waMonitor.waInstances[name].connectToWhatsapp(data)`. It handles only `changes[0]` of each entry. It forwards `message_template_status_update` to a per-template `webhookUrl`.
- **One interface, two engines (V):** `src/api/integrations/channel/{meta,whatsapp(Baileys),evolution}` are subclasses of one `ChannelController` and instance service. The Cloud API service is `whatsapp.business.service.ts` (1771 lines). `eventHandler` whitelists message types and ignores the rest with a warning.
- **Statuses (V):** the `Message` / `MessageUpdate` tables hold `keyId`, `status` and `messageId`, with indexes but no unique constraint. A status upsert with `DELETED` exists (service lines ~771-805).
- **Dedupe (R):** none found. No dedupe code was located in the Meta service; I did not read the full file.
- **Event delivery (V):** `integrations/event/{webhook,websocket,rabbitmq,sqs,kafka,nats,pusher}`. `webhook.controller.ts#retryWebhookRequest` is an in-process loop: default 10 attempts, 5 s initial delay, exponential backoff capped at 300 s, 20% jitter, non-retryable codes `[400,401,403,404,422]`. It is not durable, since it sleeps in memory.
- **Unique:** `integrations/chatbot/{chatwoot,typebot,dify,flowise,n8n,openai,evoai,evolutionBot}` share `base-chatbot.controller.ts`. A Chatwoot bridge exists at `chatbot/chatwoot/services/chatwoot.service.ts` (not read).
- **24h:** nothing seen (R).

### RapidPro courier (`oss2/courier`)
- **Auth and routing (V):** `handlers/meta/handlers.go`.
  - `validateSignature` does HMAC-SHA256 with one global app secret.
  - `GetChannel` resolves a channel of type `WAC` by `GetChannelByAddress(phone_number_id)`.
  - `RespondError` answers **200 even for errors**, because Meta retries non-200 and disables a failing subscription.
  - Groups are ignored.
  - The user's BSUID is added as a secondary URN (`handlers/meta/whatsapp/incoming.go`).
- **Batch parse then write (V):** `ParseChanges` builds the whole batch without writing. In-payload dedupe uses `seenMsgIDs`. Media URL is resolved at parse time; a failure is logged and the message still goes through.
- **Dedupe (V):** `core/models/models.go:57-64` and `msg.go:380`. Valkey interval-hash of `channel|urn|externalID` for 24-48 h. Fallback is a content hash for 2-4 s when there is no external id. A sent-msgs UUID set (1-2 h) prevents duplicate sends. A `sentExternalIDs` cache (1-2 h) exists "in case we need one before its status update has been written". This is the fix for the status race.
- **Status model (V):** `handlers/meta/whatsapp/api.go` maps sent/delivered/read/failed to `MsgStatus{Sent,Delivered,Read,Failed}`; `deleted` is ignored; an unknown status is logged. Sender statuses are `Wired` (accepted by provider), `Errored` (retryable) and `Failed` (permanent) (`core/sender/sender.go:200-280`).
- **Send error classes (V):** `api.go:30-34,464` throttling `[4,80007,130429,131048,131056,133016]` give `ErrConnectionThrottled` (retryable); `131053` is retryable-with-reason; everything else is failed-with-reason.
- **Durability (V):** `msg.go` spools incoming messages to disk if the DB is down and flushes later.
- **Channel logs (V):** `core/models/channel_log.go` has types receive, msg_send, msg_status, attachment_fetch, token_refresh, webhook_verify. Handlers expose `RedactValues` so secrets are scrubbed from logs.
- **Rate limit (V, corrects the brief):** `core/channels/ratelimit.go#AllowRate` (fixed-window INCR plus EXPIRE NX, fails open) is used only by `handlers/webchat`. For WhatsApp, throttling is provider-driven. I found no per-channel send limiter.
- **24h (R):** lives in mailroom/goflow, not courier. Not read.
- **Licence note:** BSL 1.1.

### WAHA (`oss2/waha`)
- **Not the Cloud API (V):** `src/core/engines/{webjs,noweb,gows,wpp}` are unofficial session engines, one QR-linked number per session. It is a lesson for outbound webhooks only.
- **Webhook delivery (V):** `src/modules/waha-webhook/WebhookPlugin.sender.ts`.
  - Defaults: 15 attempts, 2 s delay.
  - Policies: constant, linear, exponential. Exponential adds 0-20% jitter.
  - Honors `Retry-After` through `axios-retry`.
  - Sends `X-Webhook-Hmac` (sha512 default) and `X-Webhook-Request-Id`.
  - Config per session (`structures/webhooks.config.dto.ts`).
- **Message status (V):** `WAMessageAck` ERROR=-1, PENDING=0, SERVER=1, DEVICE=2, READ=3, PLAYED=4. It is a numeric ordered enum, so "forward only" is a comparison (`structures/enums.dto.ts:70`).
- **24h / dedupe / media (R):** none, unofficial protocol.

### Typebot (`oss2/typebot/packages/whatsapp/src`)
- **Auth and routing (V):** `api/handleProductionWebhookRequest.ts`.
  - The URL carries `workspaceId/credentialsId`, so the endpoint is per credential.
  - It verifies `x-hub-signature-256` with that credential's own `appSecret` (360dialog uses a secret header instead).
  - `resumeWhatsAppFlow.ts` throws if the payload `phone_number_id` differs from the credential's.
- **Fast ack (V):** it parses, then `after(async ...)` processes and returns `WEBHOOK_SUCCESS_MESSAGE` at once, with a comment that WhatsApp expects a reply under 3 s. `forwardWhatsAppWebhooks.ts` fans status events out to external URLs.
- **Grouping (V):** `groupIncomingWebhookEntriesPerUser.ts` groups by `(phoneNumberId, from)`. Session id is `prefix + phoneNumberId + "-" + from` (`from_user_id` fallback). Reactions are skipped.
- **Session resume (V):** `resumeWhatsAppFlow.ts`.
  - `MESSAGE_TOO_OLD` (3 min) drops stale messages.
  - An empty session older than 10 min is reset.
  - An `isReplying` flag prevents parallel handling.
  - `expiryTimeout` per session starts a fresh flow.
  - Parallel media are aggregated with a 3 s debounce (needs Redis); a newer message wins.
  - `getOrUploadMedia.ts` caches uploaded media ids. `sendWhatsAppTypingIndicator.ts` exists. A `template` case is in `sendChatReplyToWhatsApp.ts:171`.
- **Dedupe (R):** no wamid dedupe seen. It relies on session state.

## 3. Use-case catalogue (what the code shows)

| Scenario | Where implemented (evidence) |
|---|---|
| Shared support inbox, assign, reopen on reply | CW `models/message.rb#reopen_conversation`, `set_conversation`. Ticketz/Whaticket: tickets (Baileys / whatsapp-web.js), not Cloud API |
| Queues, greeting, out-of-hours auto-reply | Ticketz `oss/ticketz/backend/src/models/Queue.ts` (`greetingMessage`, `outOfHoursMessage`, `schedules` JSONB), `services/WbotServices/wbotMessageListener.ts:1246,1961,1272`. Whaticket `models/Queue.ts`. CW has `models/working_hour.rb` (WA wiring: R) |
| Quick answers / canned replies | Whaticket `models/QuickAnswer.ts`, Ticketz `models/QuickMessage.ts`, CW `models/canned_response.rb` |
| Campaigns / broadcast | CW `oneoff_campaign_service.rb`, `send_whatsapp_batch_job.rb`, dashboard `WhatsAppCampaign*` pages. Ticketz `models/Campaign.ts`, `CampaignShipping.ts`, `ContactList.ts`. frappe-whatsapp: bulk send is "P3 planned" |
| Chatbot with handoff | Typebot `resumeWhatsAppFlow.ts`. Evolution `integrations/chatbot/*`. CW: bot-active inbox sets `pending`, a human reply opens it (`message.rb`) |
| Template picker with variables | CW `WhatsAppTemplateParser.vue`, `send_on_whatsapp_service.rb`. frappe `get_sendable_templates` and named variables (`oss/frappe-whatsapp/DESIGN_DECISIONS.md`) |
| CSAT survey | CW `csat_template_service.rb` plus `models/csat_survey_response.rb` (template with a button). Ticketz `handleRating` (user replies 1-5, `wbotMessageListener.ts:1362`, `models/UserRating.ts`) |
| Event notifications (order, appointment, payment) | frappe-whatsapp: WhatsApp is a channel of Frappe Notification, template filled from a reference document, sent from a job after commit (`oss/frappe-whatsapp/README.md` "WhatsApp notifications"). Ticketz `Schedule` model (scheduled messages) |
| OTP / authentication | Only the guard and category are seen: CW `authentication_template_guard.rb`; pywa `ConversationCategory.AUTHENTICATION`. No product flow found |
| Ads referral (click-to-WhatsApp) | CW `referral_attributes` in `content_attributes`; Typebot passes `referral` into the flow |
| WhatsApp Flows replies | CW `whatsapp_flow_response`; frappe lists Flows as planned |
| Coexistence (agent also uses the WA Business app) | CW `smb_message_echoes` handler |
| Ask customer to share phone number | CW `contact_info_request_*` (BSUID era) |
| Voice calls | CW `useWhatsappCallSession.js`; Evolution `voiceCalls/` (Baileys) |
| Per-record automation | frappe "Append Actions" (create a linked document on in/out message), WA Log |

## 4. Pitfalls, ideas, avoid

### 4.1 Pitfalls (12)
1. **Dedupe lock taken before the transaction commits (V).** CW takes a Redis `SET NX` for 1 day before `set_contact` and the transaction (`message_dedup_lock.rb`, `incoming_message_base_service.rb#process_messages`). If the transaction then fails, Meta's retry hits the lock and the message is lost. `messages.source_id` is not unique (`db/schema.rb:1393`). Ours: unique `(channel_id, provider_message_id)` inserted in the same transaction (`ON CONFLICT DO NOTHING`).
2. **Status arrives before the outbound wamid is stored (V).** CW drops it (`process_statuses` returns if not found; id is saved after the API call). Courier keeps `sentExternalIDs` for this. Ours: write the wamid in the send step, and keep unmatched statuses in a small parking table that is replayed when the id attaches.
3. **Concurrent webhooks for one customer (albums) create split conversations (V).** CW uses a per-sender Redis mutex, a 30 s TTL and 20 retries (`whatsapp_events_job.rb`). Ours: ingest job `singletonKey = channelId:address`, plus a unique partial index on the open conversation.
4. **Phone-number variants (V).** BR 9th digit, AR `549`, MX `521`. Store the wa_id as delivered. Look up through a candidate list. Never synthesize an alias where it could be a different valid number (`argentina_phone_normalizer.rb` comment).
5. **Phone is no longer guaranteed (V).** BSUID/username, rotation events, alias rows, no auto-merge on conflict, auth templates need a phone, send uses `recipient` vs `to`. Design `CustomerChannelIdentity` as many addresses per customer with a `kind` (phone, bsuid, parent_bsuid) from day one.
6. **Webhook non-200 makes Meta retry and eventually disable the subscription (V, `courier handlers/meta/handlers.go RespondError`).** Poison payloads must get 200 plus an internal error log or dead-letter.
7. **Optional signature (V).** CW skips verification for a manual channel without a secret. Evolution has none. Always verify HMAC on the raw body, with constant-time compare, and keep the raw body in NestJS (`rawBody: true`).
8. **Routing by display number (V).** CW needs a normalizer to match `display_phone_number`. Route by `phone_number_id` with a unique index.
9. **Media download inside the ingest critical section (V).** CW downloads while holding the sender lock (hence the 30 s TTL). Bearer-auth URL, 401 means a dead token. Frappe never fetches incoming media (README "Planned"). Ours: persist the message with media `PENDING`, copy to S3 in a separate job, and flag the channel on 401.
10. **24h window computed from `created_at` and failed after the fact (V, `message_window_service.rb`).** Use Meta's webhook timestamp on the last inbound. Also map error 131047 (`pywa/pywa/errors.py:288`) as authoritative. Free-entry-point windows from ads are not modeled (R).
11. **No send retry classification (V).** CW fails every non-success immediately; courier splits Throttled/Retryable/Failed (`api.go:30,464`). pywa has a typed hierarchy by code (`errors.py`). Ours: map codes to retry, backoff or terminal.
12. **Silent drops and partial state (V).** Typebot drops messages older than 3 min (fine for a bot, wrong for an inbox after an outage). Frappe lists partial-state webhook failures with no recovery as P2 (`oss/frappe-whatsapp/README.md`). Ours: keep the raw payload in a webhook-event table before processing and let a sweeper re-queue stuck events.

### 4.2 Ideas worth adopting (12)
1. **Raw event table first.** Insert `(channel_id, payload, received_at)`, answer 200, then enqueue. Courier's batch-then-write and CW's `perform_later` are the same idea.
2. **Resolve channel by `phone_number_id`**; keep a per-channel verify token (CW generates it, `ensure_webhook_verify_token`) and optionally a per-channel app secret (Typebot, CW).
3. **Forward-only status with explicit failed exception**, under a row lock and a conditional update (`status_update_service.rb`). Our enum: QUEUED, SENDING (courier "Wired"), SENT, DELIVERED, READ, FAILED. Add `played` (pywa) and store the error as `{code,title}`.
4. **Identity ordering rule**: phone first, then BSUID. Conversations scoped to the exact `(channel, identity)` row. Alias rows are never merged automatically (`identity_source_id_orderer.rb`, `user_id_rotation_service.rb`).
5. **Persist unsupported/unknown inbound types as placeholders** with a flag (`create_unsupported_message`), and store `referral`, Flow replies, and `in_reply_to` as typed JSON.
6. **Echo ingestion for coexistence**: outgoing message, status already delivered, never queued for send.
7. **Channel health job**: store quality rating, messaging tier and status; a 190 error moves the channel into a reauthorization state that the UI shows (`health_service.rb`, `Reauthorizable`).
8. **Templates cached per channel** as rows (name, language, category, status, components, variable names). Scheduled cursor sync plus `message_template_status_update` events (frappe has approved/rejected notifications). Guard sends: unknown template, wrong category for BSUID recipient.
9. **Channel log per HTTP interaction** (courier `ChannelLog` types) with secret redaction. It is the support tool when a customer says "my WhatsApp does not work".
10. **Send media by uploaded media id** and cache the id for repeated header media (CW `media_upload_service.rb`, frappe README, Typebot `getOrUploadMedia.ts`).
11. **Typed payload layer**: generate Zod schemas from pywa/whatsapp-api-js types (`oss2/pywa/pywa/types/*.py`, `oss2/whatsapp-api-js/src/types.ts` with `ServerPricing`). Ignore unknown statuses with a log line (courier).
12. **Cursor-batched campaign job** (CW) with per-channel throttle, and a window/template precheck per recipient. Capture pricing `category` from status webhooks for cost reporting (pywa `ConversationCategory`).

### 4.3 Avoid (6)
1. **Unofficial engines** (Baileys, whatsapp-web.js: Ticketz, Whaticket, WAHA, Evolution-Baileys). Ban risk, QR sessions, off-scope for a Meta-Cloud-only product.
2. **Redis-only dedupe or a lock as the dedupe** (CW, courier). Our single source of truth is Postgres.
3. **In-process retry loops** (Evolution webhook sender sleeps in the request path). Use pg-boss retries.
4. **Instance-name or global-token routing without signatures** (Evolution).
5. **Plain credentials in a JSONB `provider_config`** (CW keeps `api_key` there, only one token uses `encrypts`). Use an encrypted column or secret store per Channel.
6. **Mixed hardcoded Graph versions** (CW uses v13, v14, v22, v24 in different files). Pin one configurable version.

## 5. Licence and last commit (`git log -1`, LICENSE file)

| Project | Last commit | Licence | Note |
|---|---|---|---|
| chatwoot | 2026-10-12 | MIT Expat, except `enterprise/` | ideas and code reusable under MIT |
| evolution-api | 2026-05-06 | Apache-2.0 plus custom conditions | logo/usage-notification conditions, commercial licence clause; read as non-standard |
| courier | 2026-10-06 | BSL 1.1 (Nyaruka) | no use as a "Hosted Messaging Platform"; change date 2028-10-06 to AGPLv3. Read patterns only, do not copy |
| mailroom / temba | 2026-10-12 | BSL 1.1 (same family) | not read |
| waha | 2026-10-02 | Apache-2.0 | commercial "Plus" edition is R |
| typebot | 2026-10-07 | FSL-1.1-Apache-2.0 | competing-use restriction for 2 years per release; patterns only |
| ticketz | 2026-09-28 | AGPL-3.0 | use cases only |
| whaticket-community | 2026-10-07 | MIT | use cases only |
| frappe-whatsapp (`oss/frappe-whatsapp`) | 2026-10-08 | MIT (`license.txt`) | `oss/frappe_whatsapp` is an older copy, last commit 2026-08-04 |
| pywa | 2026-09-30 | MIT | |
| whatsapp-api-js | 2026-09-26 | MIT | |

Not covered (budget): CW Twilio/360dialog providers, Evolution's Chatwoot bridge, mailroom/goflow 24h logic, Ticketz `WhatsappLidMap` (a LID-to-phone map, the Baileys analogue of BSUID).
