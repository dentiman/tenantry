# Meta WhatsApp Cloud API — стиснутий довідник
> **Знімок дослідження 2026-10-13 (англійською, як згенеровано).** Це довідковий додаток до [whatsapp-channel.md](../whatsapp-channel.md): рішення й план — там, тут — докази. Не редагується руками; при зміні фактів дослідження повторюють і замінюють файл.
> Джерело: 222 сторінки офіційної документації Meta, скачані у вигляді .md (`developers.facebook.com/documentation/business-messaging/whatsapp/`). Розділ «Unverified» наприкінці — обов'язково звірити перед реалізацією.

# WhatsApp Business Cloud API - condensed developer reference (CRM chat design)

Compiled 2026-10-13 from local Meta docs. Source citation: file `X.md` = `https://developers.facebook.com/documentation/business-messaging/whatsapp/` + X with `__` -> `/` (e.g. `webhooks__reference__messages__status.md` -> `.../webhooks/reference/messages/status`). Graph version: examples use **v25.0** (templates pages v23.0); Graph changelog says latest is **v26.0**. Label **Recalled** = not in local docs. Some downloads were 404 pages (see Unverified).

---

## 1. Send API

| Item | Fact |
|---|---|
| Endpoint | `POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages` (version optional in doc table) |
| Auth | `Authorization: Bearer <token>`; system-user token (direct dev) or business-integration token (Tech Provider/partner); user tokens expire fast, dev-only. Perms: `whatsapp_business_messaging` (+ `whatsapp_business_management`, `business_management` to generate) |
| Base body | `messaging_product:"whatsapp"` (req), `recipient_type:"individual"\|"group"`, `to`, `type`, `context.message_id` (reply), type-named object |
| Phone format | `+ - ()` and spaces accepted. Without `+`+country code the business number's country code is prepended (misdelivery risk); Brazil/Mexico prefix may be altered |
| Response | `{messaging_product, contacts:[{input, wa_id}], messages:[{id:"wamid...", group_id?, message_status?}]}` |
| `message_status` | enum `accepted \| held_for_quality_assessment \| paused`; documented only for **paced templates** (send-messages.md); schema marks it optional |
| 200 meaning | Request accepted only, NOT delivered; delivery comes via `statuses` webhooks |
| `input` vs `wa_id` | May differ (e.g. `+1650...` vs `1650...`); `wa_id` is the canonical user id (pre-BSUID) |
| Media link cache | `link` assets cached 10 min by URL; append random query string to bust; `id` preferred |
| Ordering | Delivery order may differ from request order; wait for `delivered` before next if sequence matters |
| TTL | Undeliverable messages retried for **30 days** (auth templates 10 min); no `delivered` within TTL = dropped. Custom TTL: templates (`message_send_ttl_seconds`) or Direct Send (`ttl_seconds`) |
| Optional body fields seen | `biz_opaque_callback_data` (echoed in status webhook), `messaging_account_id` (new account model), `category`/`ttl_seconds` (Direct Send), `recipient` (BSUID) |

**Idempotency / dedupe on send: NO.** Evidence: grep "idempot" = 0 hits in all 222 local files (+ older copy); `MessageResponsePayload` / request schema in `reference__whatsapp-business-phone-number__message-api.md` has no client reference/dedupe key; the only caller-supplied correlation value is `biz_opaque_callback_data`, which is merely echoed back in status webhooks (`webhooks__reference__messages__status.md`) - it does not suppress duplicates. Its send-side placement is not documented in the message-api schema (**Recalled**: top-level string in the send body). Each accepted POST mints a new `wamid`. Consequence: a timed-out POST cannot be blindly retried; put your outbox id in `biz_opaque_callback_data` and reconcile via status webhooks first.

### Minimal JSON per outbound type (all include `messaging_product`, `recipient_type`, `to`)

```json
{"type":"text","text":{"preview_url":true,"body":"..."}}                      // body max 4096
{"type":"image","image":{"id":"MEDIA_ID","caption":"..."}}                   // or "link":"https://..." ; caption max 1024
{"type":"audio","audio":{"id":"MEDIA_ID","voice":true}}                      // voice needs Ogg/OPUS; no caption
{"type":"video","video":{"id":"MEDIA_ID","caption":"..."}}
{"type":"document","document":{"id":"MEDIA_ID","filename":"a.pdf","caption":"..."}}
{"type":"sticker","sticker":{"id":"MEDIA_ID"}}                               // webp only
{"type":"location","location":{"latitude":"37.4","longitude":"-122.1","name":"..","address":".."}}
{"type":"reaction","reaction":{"message_id":"wamid...","emoji":"😀"}}
```
Reaction fails `131009` if target >30 days old, deleted, or itself a reaction. Media: `id` or `link`; `id` recommended.

```json
// interactive reply buttons (max 3; id<=256, title<=20 unique, body<=1024, footer<=60; header text|image|video|document)
{"type":"interactive","interactive":{"type":"button","body":{"text":".."},
 "action":{"buttons":[{"type":"reply","reply":{"id":"yes","title":"Yes"}}]}}}
// list (<=10 sections, <=10 rows TOTAL; button<=20, row title<=24, row id<=200, row desc<=72, section title<=24, header text<=60, body<=4096)
{"type":"interactive","interactive":{"type":"list","body":{"text":".."},
 "action":{"button":"Options","sections":[{"title":"S1","rows":[{"id":"r1","title":"One","description":".."}]}]}}}
// cta_url (button label<=20, header text<=60)
{"type":"interactive","interactive":{"type":"cta_url","body":{"text":".."},
 "action":{"name":"cta_url","parameters":{"display_text":"Open","url":"https://.."}}}}
```
Other interactive types: `call_permission_request`, `catalog_message`, `product`, `product_list`, `flow`.

```json
// template; language.code required; components optional
{"type":"template","template":{"name":"order_confirmation","language":{"code":"en_US"},"components":[
 {"type":"header","parameters":[{"type":"image","image":{"id":"MEDIA_ID"}}]},          // or {"type":"text",...}, document, video, location
 {"type":"body","parameters":[{"type":"text","parameter_name":"first_name","text":"Jessica"}]},  // omit parameter_name for positional
 {"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"suffix"}]},
 {"type":"button","sub_type":"quick_reply","index":"1","parameters":[{"type":"payload","payload":"UNSUB"}]},
 {"type":"button","sub_type":"copy_code","index":"2","parameters":[{"type":"coupon_code","coupon_code":"X"}]}]}}
```
URL button values must be percent-encoded. Marketing templates may alternatively use `/{phone}/marketing_messages` (MM API).

```json
// contextual reply: add to ANY type; no bubble for templates, deleted/30-day-old targets, KaiOS media
{"context":{"message_id":"wamid..."}, "type":"text", "text":{"body":".."}}
// mark as read (also marks earlier msgs; only incoming, within 30 days; bad id -> 131009) -> {"success":true}
{"messaging_product":"whatsapp","status":"read","message_id":"wamid.INCOMING"}
// typing indicator = read + indicator; dismissed on reply or after 25 s
{"messaging_product":"whatsapp","status":"read","message_id":"wamid.INCOMING","typing_indicator":{"type":"text"}}
```

Sources: send-messages.md, reference__whatsapp-business-phone-number__message-api.md, messages__*.md (per type), typing-indicators.md, templates__overview.md, templates__components.md, templates__marketing-templates__{limited-time-offer,media-card-carousel}-templates.md, access-tokens.md, webhooks__reference__messages__status.md.

---

## 2. Customer service window (CSW)

| Rule | Fact |
|---|---|
| Opens | When a WhatsApp user **messages OR calls** the business: 24 h timer |
| Reset | Each new user message/call resets to full 24 h. Business messages do not extend it |
| Inside | Any non-template ("service") type: text, media, location, contacts, address, interactive (buttons/list/CTA/flow/location-request/call), sticker, reaction |
| Outside | Only approved **template** messages (marketing/utility/authentication) |
| Violation error | `131047` "More than 24 hours have passed since the recipient last replied to the sender number" -> send a template instead (error-codes.md). Sync vs webhook delivery unspecified |
| Opt-in | Required for templates (getting-opt-in.md) |
| Free-entry-point (CTWA ad / FB Page CTA button; Android/iOS only, not desktop/web) | Normal 24 h CSW opens; if business replies within 24 h with ANY message, a **72 h FEP window** starts at the reply: all message types free (billing). FEP is independent of CSW: after CSW closes only templates are allowed, even while FEP is open. Status webhook `conversation` object (v24+) appears only for FEP; `pricing.type:"free_entry_point"`, category `referral_conversion` |

Sources: send-messages.md, pricing.md, support__error-codes.md, templates__marketing-templates__per-user-limits.md, webhooks__reference__messages__status.md.

---

## 3. Webhooks

**GET verify:** `GET <cb>?hub.mode=subscribe&hub.challenge=N&hub.verify_token=T`; compare token, reply HTTP 200 with the challenge value; anything else = unverified. TLS cert must be valid (no self-signed); mTLS supported (per app, not per WABA/phone).

**POST:** headers `Content-Type: application/json`, `X-Hub-Signature-256: sha256=<hex>`; HMAC-SHA256 of the **payload body** keyed by **app secret**; compare to hex after `sha256=`; invalid -> non-200. Raw-bytes/escaping nuance not documented locally (**Recalled**: compute over raw request bytes; Meta payloads escape non-ASCII as `\uXXXX`, so never re-serialize parsed JSON). Respond **200** quickly.

| Policy | Fact |
|---|---|
| Retry | Non-200 or delivery failure -> immediate retry, then decreasing frequency for up to **7 days** (WhatsApp docs); generic Graph doc says 36 h - WhatsApp pages (7 d, throughput.md says "exponential backoff") are the specific ones |
| Timeout | ~**20 s** (calling FAQ, describing Meta's HTTPS request); no explicit messaging timeout stated |
| Duplicates | Yes: no exactly-once. Causes incl. timeout, queue recovery, and **retries go to all subscribed apps** |
| Ordering | Not guaranteed (calling FAQ; send-messages.md for delivery); use `timestamp`/status precedence |
| Batching | Up to **1000** updates per POST; payload up to **3 MB**; handle each entry/change independently |
| History | No API to fetch past webhooks; store payloads |
| Capacity | Handle 3x outbound rate (statuses) + 1x inbound; median latency <=250 ms, <1% >1 s |

**Subscribable fields (webhooks__overview.md):**
`account_alerts` limit/profile/OBA changes; `account_review_update` WABA policy review; `account_update` verification, violations, offboarding, volume-tier change; `automatic_events` CTWA purchase/lead; `business_capability_update` limits/phone caps; `history` Business-app chat history sync; `message_template_components_update` edited; `message_template_quality_update` quality change; `message_template_status_update` approval/pause/disable; `messages` inbound + statuses + errors; `partner_solutions` multi-partner status; `payment_configuration_update` India/Brazil; `phone_number_name_update` display-name outcome; `phone_number_quality_update` throughput level; `security` phone security settings; `smb_app_state_sync` Business-app contacts; `smb_message_echoes` Business-app sends; `template_category_update` category change; `user_preferences` marketing opt-out/in. Elsewhere referenced: `calls`, `message_echoes`, `consumer_profile`, `messaging_handovers`, `group_*`, `account_settings_update`, `user_id_update`, `business_username_updates`.

**Skeleton (all `messages` events):**
```json
{"object":"whatsapp_business_account","entry":[{"id":"WABA_ID","changes":[{"field":"messages","value":{
 "messaging_product":"whatsapp","metadata":{"display_phone_number":"15550783881","phone_number_id":"106540352242922"},
 "contacts":[{"profile":{"name":"Sheena Nelson"},"wa_id":"16505551234"}],       // incoming only (not system)
 "messages":[{"from":"16505551234","id":"wamid..","timestamp":"1749416383","type":"text","text":{"body":".."}}]
 // OR "statuses":[...]   OR "errors":[...]
}}]}]}
```
`timestamp` = unix seconds string. `contacts[]`: `profile.name`, `wa_id`, optional `identity_key_hash` (identity-change check), BSUID fields below. `wa_id` and `from` "may not match" the sent `input`.

**Inbound types (`messages[].type`):**

| type | Payload |
|---|---|
| text | `text.body` |
| image/video | `{caption?, mime_type, sha256, id, url}` (`url` rolling out from 2025-11-12) |
| audio | `{mime_type, sha256, id, url, voice:bool}` |
| document | `{caption?, filename, mime_type, sha256, id, url}` |
| sticker | `{mime_type:"image/webp", sha256, id, url, animated:bool}` |
| location | `{latitude, longitude, name?, address?, url?}` |
| contacts | `contacts:[{name{formatted_name,first_name..}, phones[{phone,wa_id,type}], emails, addresses, org, birthday, urls}]` (+`vcard`,`origin` under BSUID) |
| button (template quick-reply tap) | `button:{payload,text}` |
| interactive | `interactive:{type:"button_reply", button_reply:{id,title}}` or `{type:"list_reply", list_reply:{id,title,description}}`; `context.{from,id}` = original message |
| reaction | `reaction:{message_id, emoji}`; `emoji` omitted when user removes reaction |
| order | `order:{catalog_id,text,product_items[{product_retailer_id,quantity,item_price,currency}]}` |
| system | `system:{body, wa_id, type:"user_changed_number"}` (BSUID: `user_changed_user_id`, +`user_id`); **no `contacts` array** |
| edit | `edit:{original_message_id, message:{context.id, type, image/text..}}` - **currently NOT delivered**: edits arrive as `unsupported` with `unsupported.type:"edit"`; edit webhook only for Business-app (Coexistence) users, within 15 min |
| revoke | `revoke:{original_message_id}`; Coexistence users only; user deletes within 2 days |
| unsupported | `errors[{code,title,message,error_data.details}]` + `unsupported.type` in {button, edit, errors, gif, group_invite, hsm, image, interactive, keep_in_chat, link_preview, list, location, media_placeholder, order, pin, poll_creation, poll_update, product, reaction}. Codes `131051` (type unsupported) and `131060` (message unavailable; first message to Business-app-onboarded number, common after CTWA tap) |
| group | adds `group_id` (Groups API) |

Optional blocks on any inbound message:
- `context`: `{from,id}` when replying to/clicking a bot message; `{forwarded:true}` (<=5 forwards) / `{frequently_forwarded:true}`; `{from,id,referred_product:{catalog_id,product_retailer_id}}` for "Message business" button. User quote-reply context.id is **Recalled**.
- `referral` (CTWA ad): `source_url, source_id, source_type:"ad", body, headline, media_type, image_url|video_url, thumbnail_url, ctwa_clid` (absent for Status ad placement), `welcome_message.text`.
- `errors[]` per-message on unsupported.

**`statuses[]`:**
```json
{"id":"wamid..","status":"sent|delivered|read|failed|played","timestamp":"1750030073","recipient_id":"16505551234",
 "recipient_type":"group"?, "recipient_participant_id"?, "recipient_identity_key_hash"?, "biz_opaque_callback_data"?,
 "conversation":{"id":"..","expiration_timestamp":"..","origin":{"type":"service|marketing|utility|authentication|authentication_international|marketing_lite|referral_conversion"}},
 "pricing":{"billable":true,"pricing_model":"PMP","type":"regular|free_customer_service|free_entry_point","category":"marketing|utility|authentication|authentication-international|marketing_lite|referral_conversion|service"},
 "errors":[{"code":131050,"title":"..","message":"..","error_data":{"details":".."},"href":".."}]}
```
- Up to 3 webhooks per message (sent, delivered, read); if read while chat open, `delivered` is skipped. `played` = first voice-note play.
- `conversation`: omitted entirely in v24+ unless FEP; `expiration_timestamp` only on `sent`. `pricing` appears on sent/delivered/read per skeleton comment. `pricing_model` `CBP` only for pre-2025-07-01 conversations else `PMP`. `billable` to be deprecated.

**BSUID (business-scoped-user-ids.md):** Format `CC.` + up to 128 alnum (`US.13491208655302741918`); unique per business portfolio+user; regenerated on phone change; parent BSUID `US.ENT.<digits>` for enrolled multi-portfolio managed businesses. Appeared in webhooks since early April 2026 always; sending to BSUID documented "from July 2026" (changelog) though the send section still says "coming soon" - verify live.

| Where | Fields |
|---|---|
| contacts[] | `profile.username?`, `wa_id?` (omitted if unavailable), `user_id`, `parent_user_id?` |
| messages[] | `from?` (phone, omitted if unavailable), `from_user_id`, `from_parent_user_id?` |
| statuses[] | `recipient_id?` (phone), `recipient_user_id` (always; omitted on `failed` if sent to phone), `recipient_parent_user_id?`, `username?` on delivered/read |
| user_id_update webhook | `{wa_id?, detail, user_id{previous,current}, parent_user_id?, timestamp}` |

Phone is **absent** when user has adopted a username AND none of: business messaged/called that phone within 30 days, received message/call from it within 30 days (both evaluated per business phone number), or user is in Meta-hosted contact book. Send: `to`=phone and/or `recipient`=BSUID (`to` wins). Response: BSUID send returns `contacts[{input:BSUID,user_id}]` with no `wa_id`. Not allowed to BSUID: one-tap/zero-tap/copy-code auth templates, `bid_spec` marketing (error `131062`). `REQUEST_CONTACT_INFO` button (utility/marketing template or interactive `request_contact_info`) returns phone via contacts webhook. Key customers on `user_id`, not phone alone.

**Callback overrides (webhooks__override.md):** precedence **phone number > WABA > app default**. Set WABA: `POST /{WABA_ID}/subscribed_apps {override_callback_uri, verify_token}` (<=200 chars; re-subscribe without body removes). Set phone: `POST /{PHONE_ID} {"webhook_configuration":{"override_callback_uri","verify_token"}}`. Applies only to: messages, message_echoes, calls, consumer_profile, messaging_handovers, group_* (4), smb_message_echoes, smb_app_state_sync, history, account_settings_update. Template webhooks and account webhooks (`account_update`, `account_review_update`, `account_alerts`) **always** go to the app callback.

Sources: webhooks__overview.md, webhooks__create-webhook-endpoint.md, webhooks__override.md, webhooks__reference__messages*.md (+ per-type files), business-scoped-user-ids.md, throughput.md, calling__faq.md, developers.facebook.com__docs__graph-api__webhooks__getting-started.

---

## 4. Media

| Step | Fact |
|---|---|
| Upload | `POST /{PHONE_ID}/media` multipart: `messaging_product=whatsapp`, `file=@x;type=MIME`, (`type`) -> `{"id":"..."}`. Stored encrypted, persists **30 days** unless deleted |
| Retrieve URL | `GET /{MEDIA_ID}[?phone_number_id=]` -> `{messaging_product,url,mime_type,sha256,file_size,id}`; URL valid **5 min** |
| Download | `GET <url>` with `Authorization: Bearer` (no token = fail); 404 -> re-fetch URL, then renew token |
| Delete | `DELETE /{MEDIA_ID}[?phone_number_id=]` -> `{"success":true}` |
| ID lifetime | API-returned IDs expire after 30 days; **IDs in webhooks expire after 7 days** -> download inbound media immediately and store it |
| Inbound fields | `id, mime_type, sha256, caption?, filename?` (+ `url` rolling out since 2025-11-12; same 5-min/auth rules assumed) |
| Inbound cap | 100 MB; larger -> webhook error `131052` ("Media file size too big") - warn the user |

| Type | Formats / limit |
|---|---|
| Audio | aac, amr, mp3, m4a (audio/mp4), ogg **OPUS only, mono** - 16 MB |
| Document | txt, xls(x), doc(x), ppt(x), pdf - 100 MB (others may send but unsupported) |
| Image | jpeg, png 8-bit RGB/RGBA - 5 MB |
| Sticker | webp static 100 KB, animated 500 KB |
| Video | mp4, 3gp; H.264 + AAC only, one audio stream; Main/Baseline profile, no B-frames, faststart - 16 MB |

Common failure `131053` = MIME/extension mismatch or bad Ogg codec (check with `file -I`).

Sources: business-phone-numbers__media.md, reference__media__media-api.md, reference__media__media-download-api.md, messages__{audio,image,video,document,sticker}-messages.md, webhooks__reference__messages__{image,audio,video,document,sticker}.md.

---

## 5. Templates API

**Create:** `POST /{WABA_ID}/message_templates` (max **100 creations/hour**). Name: `^[a-z0-9_]+$`, <=512 chars, unique per language (dup -> `100`/subcode `2388024`). `parameter_format`: `positional` (default, `{{1}}`) or `named` (`{{first_name}}`, lowercase/underscore). Examples are mandatory for variables. Limits: 250 templates/WABA unverified portfolio, 6000 if verified + approved display name.
```json
{"name":"order_confirmation","language":"en_US","category":"UTILITY","parameter_format":"named",
 "message_send_ttl_seconds":600,
 "components":[
  {"type":"HEADER","format":"IMAGE","example":{"header_handle":["4::aW..."]}},          // handle from Resumable Upload API; formats IMAGE|VIDEO|DOCUMENT|(GIF MM-API only)|TEXT|location
  {"type":"BODY","text":"Hi {{first_name}}, order {{order_number}} confirmed.",
   "example":{"body_text_named_params":[{"param_name":"first_name","example":"Pablo"},{"param_name":"order_number","example":"860198"}]}},
  {"type":"FOOTER","text":"Lucky Shrub"},
  {"type":"BUTTONS","buttons":[{"type":"URL","text":"Track","url":"https://x.com/t?id={{1}}","example":["abc"]},
     {"type":"PHONE_NUMBER","text":"Call","phone_number":"15550051310"},{"type":"QUICK_REPLY","text":"Stop"}]}]}
```
Positional body example: `"example":{"body_text":[["Pablo","860198"]]}`; text header `header_text` / `header_text_named_params`. Limits: header text 60 (1 var), body 1024, footer 60, button text 25, URL 2000 chars (1 var, at end), <=10 buttons total, <=10 quick replies, 2 URL, 1 phone, 1 copy_code (<=20 chars); quick replies must be grouped contiguously (not QR,URL,QR); >3 buttons collapse into "See all options"; no leading/trailing variables; too many variables vs length rejected.

**Categories:** MARKETING (promo, mixed, unclear content), UTILITY (non-promotional + user-specific/essential), AUTHENTICATION (OTP; fixed formats; TTL default 10 min; no BSUID for one-tap/zero-tap/copy-code). Since **2025-04-09** a UTILITY template judged MARKETING is **approved as MARKETING** (no more `allow_category_change`); 60 days to request review/appeal. `template_category_update` webhook warns ~24 h before recategorization. Misuse of utility -> rate limit (>=7 d) or all utility recategorized to marketing (7/30 d). 

| Status (API enum) | Meaning / sendable |
|---|---|
| PENDING | in review (<=24 h); not sendable |
| APPROVED | sendable; WhatsApp Manager shows quality (pending/high/medium/low) |
| REJECTED | edit+resubmit or appeal (needs sample; decision <=24 h) |
| PAUSED | auto-paused for low quality (see below); not sendable |
| DISABLED | repeated low quality; not sendable; cannot be deleted |
| IN_APPEAL | appeal under review |
| LIMIT_EXCEEDED | WABA at template cap |
| PENDING_DELETION / DELETED | deleted; PENDING_DELETION if in-flight undelivered (delivery attempts continue 30 d) |
| ARCHIVED | inactive >=12 months; deleted after 28 days unless unarchived |
Webhook-only events: FLAGGED, REINSTATED, LOCKED, UNARCHIVED. Quality enum: GREEN / YELLOW / RED / UNKNOWN (new templates UNKNOWN).

**Pausing/pacing key numbers:** quality RED -> auto-pause: 1st **3 h**, 2nd **6 h**, 3rd **disabled**; auto-unpause (templates paused by pacing need manual `POST /{template_id}/unpause` or Manager). Failed send on paused template: `132015`; permanently disabled: `132016`. Pacing applies to marketing+utility templates that are new / just unpaused / not GREEN; messages sent normally until unspecified threshold, then held: send response `message_status:"held_for_quality_assessment"`; good signal releases them; bad signal drops them with `failed` status code `132015`. Utility pacing only for 7 days after a utility pause. Per-user marketing limit: adaptive, error `131049`, wait >=24 h; excessive retries extend block up to 24 h; **marketing templates to US (+1) numbers are not delivered** (since 2025-04-01); EEA/UK/Japan/S. Korea excluded from per-user limits. Template TTL ranges: auth 30 s-15 min, utility 30 s-12 h (`-1` = 30 d), marketing (MM API) 12 h-30 d.

**Edit/delete:** edit allowed in APPROVED/REJECTED/PAUSED; replaces ALL components; only category, components, TTL editable; approved: 10 edits/30 days and 1/24 h; cannot change category of approved. Delete by `name` (deletes all languages), by `hsm_id`+`name`, or `hsm_ids` (<=100 ids, all-or-nothing). Deleted approved template: **name unusable for 30 days**. Needs `whatsapp_business_management` (else error `200`).

**Rejection handling:** common reasons: bad parameter format/sequence/special chars, dangling variables, too many vars, policy/commerce violations, sensitive-identifier requests, abusive content, duplicate body+footer (not for AUTH). API `rejected_reason` enum: ABUSIVE_CONTENT, CATEGORY_NOT_AVAILABLE(dep.), INCORRECT_CATEGORY, INVALID_FORMAT, NONE, PROMOTIONAL, SCAM, TAG_CONTENT_MISMATCH; `INVALID_FORMAT` webhooks add `rejection_info{reason,recommendation}`.

**Webhooks:**
```json
// message_template_status_update
{"field":"message_template_status_update","value":{"event":"APPROVED","message_template_id":1689556908129832,"message_template_name":"order_confirmation",
 "message_template_language":"en-US","reason":"NONE","message_template_category":"UTILITY",
 "disable_info":{"disable_date":1751234563}?, "other_info":{"title":"FIRST_PAUSE|SECOND_PAUSE|RATE_LIMITING_PAUSE|UNPAUSE|DISABLED","description":".."}?, "rejection_info":{..}?}}
// message_template_quality_update: value{previous_quality_score,new_quality_score,message_template_id,name,language}
// template_category_update: value{message_template_id,name,language, correct_category,new_category,category_update_timestamp} (impending) | {previous_category,new_category} (done)
// message_template_components_update: value{id,name,language,message_template_element(body),message_template_title?,message_template_footer?,message_template_buttons[]?}
```
`event` values: APPROVED, ARCHIVED, UNARCHIVED, DELETED, DISABLED, FLAGGED, IN_APPEAL, LIMIT_EXCEEDED, LOCKED, PAUSED, PENDING, REINSTATED, PENDING_DELETION, REJECTED. Template webhooks cannot be overridden (always app URL).

Sources: templates__{overview,components,template-management,template-review,template-pausing,template-pacing,template-quality,template-categorization,template-archival,time-to-live}.md, templates__marketing-templates__per-user-limits.md, marketing-messages__get-started.md, reference__whatsapp-business-account__message-template-api.md, webhooks__reference__message_template_{status,quality,components}_update.md, webhooks__reference__template_category_update.md.

---

## 6. Error codes

Error envelope: `{"error":{"message":"(#130429) Rate limit hit","type":"OAuthException","code":130429,"error_data":{"messaging_product":"whatsapp","details":"..."},"fbtrace_id":".."}}`; `error_subcode` removed from v16+. Build logic on `code` + `details`, not titles/HTTP status. Errors arrive synchronously (HTTP) and/or in `statuses[].errors` / `value.errors` / `messages[].errors` webhooks. Graph generic: 1,2,4,17,341 transient/throttle; 190 token expired.

Classification legend: **R** retryable (backoff), **N** non-retryable (fix payload/state or never), **H** needs human/ops.

| Code | Meaning (docs) | Action | Class |
|---|---|---|---|
| 130429 | Cloud API throughput (80 mps default; 20 mps Business-app numbers; 1000 mps upgrade) reached | Back off, queue, smooth rate | R |
| 131056 | Pair rate limit: too many msgs same sender->recipient (1 per 6 s, burst 45) | Wait; retry after 4^X s (X=0,1,..); other recipients unaffected | R |
| 80007 / 4 / 17 / 341 | WABA / app / user rate limit | Back off | R |
| 131047 | >24 h since user's last reply (CSW closed) | Send a template; or wait for user message | N (switch path) |
| 131026 | Undeliverable: not WhatsApp, ToS not accepted, old client | Do not retry; mark invalid | N |
| 131048 | Spam-rate/quality restriction on this number | Check quality in WhatsApp Manager; reduce sends | H |
| 131049 | Not delivered "to maintain healthy ecosystem engagement" (per-user marketing cap, US marketing) | Wait >=24 h; excessive retry extends block | N (delay 24 h) |
| 131050 | User opted out of marketing from you | Never retry marketing; track `user_preferences` webhook | N |
| 131051 | Unsupported message type (inbound webhook `unsupported`) | Show placeholder in CRM | N |
| 131052 | Cannot download user media (incl. >100 MB) | Ask user to resend | N |
| 131053 | Cannot upload media (unsupported type/MIME) | Validate type/size/MIME before send | N |
| 131062 | BSUID recipient unsupported for message (auth templates, `bid_spec`) | Use phone number | N |
| 130403 | You blocked this user | Unblock via Block API | H |
| 131030 | Recipient not in allowed list (test numbers) | Add recipient | N |
| 131008 / 131009 | Missing / invalid parameter (131009 also invalid wamid to react/read) | Fix request | N |
| 131000 | Unknown send failure | Retry; if persistent open ticket | R |
| 131016 / 133004 / 1 / 2 | Service unavailable | Retry | R |
| 131057 | Account in maintenance (e.g. throughput upgrade, <=1 min) | Retry shortly | R |
| 131031 / 368 | WABA restricted/disabled, or bad 2-step PIN | Policy enforcement / health status | H |
| 131042 | Payment/billing problem | Fix credit line/billing | H |
| 131045 / 133010 / 131063 | Number not registered / marketing templates disabled on Cloud API config | Register number / use MM API | H |
| 131064 | Limit reached due to category-misclassification enforcement | Fix categories; auto-lifts | H |
| 132000 | Template var count mismatch | Fix components | N |
| 132001 | Template/language missing or not approved | Check name+lang+status | N |
| 132007 | Template content violates policy | Review | H |
| 132012 | Var format mismatch | Fix params | N |
| 132015 | Template paused (low quality / pacing) | Wait unpause / edit | R (after unpause) |
| 132016 | Template permanently disabled | New template | N |
| 132018 | Template parameter validation (v23+) | Fix params | N |
| 0, 190, 3, 10, 200-299 | Auth/permission/token | Refresh token / fix permissions | H |
| 100 | Invalid/unsupported parameter (also bad template name, bad `category`) | Fix request | N |

Sources: support__error-codes.md, webhooks__reference__messages__{errors,unsupported}.md, marketing-messages__send-marketing-messages.md, business-scoped-user-ids.md, calling__troubleshooting.md (131030), about-the-platform.md, throughput.md, templates__template-pacing.md, direct-send__api-reference.md, developers.facebook.com__docs__graph-api__guides__error-handling. Not found anywhere: 131058, 131065.

---

## 7. New items

**Direct Send API (beta).** Business-initiated utility/authentication messages via normal `/messages` by adding `"category":"utility"` (or `"authentication"`, access restricted) and no template; Meta matches to an auto-generated template (PII-redacted, language detected) else uses onboarding fallback templates and asynchronously creates one. Supported: utility text, CTA URL, reply buttons, mixed (<=10 buttons, <=2 CTA), custom `ttl_seconds` 30-43200, image/video/document headers (access-restricted); auth: text only; marketing unsupported (`100` sync error). Optional `direct_send_config.template_name` pins attribution (`^[a-z0-9_]+$`, <=512; conflict `132021`; creation failure -> 3 retries then `131000`). Billing follows utility-template session logic. Enforcement: `139200` (blocked), `131064` (limit); unused auto templates deleted after 24 h. Auth category needs a phone, not BSUID. Limits: body 1024, header/footer 60, button 20. Omitted `category` = normal service send (dropped without open CSW). Sources: direct-send*.md.

**AI-providers pricing restriction.** `pricing.md` only says a new policy for "AI Providers" leveraging the platform is effective **2026-02-16**, updated **2026-05-12**; the detail page (`pricing/ai-providers`) was NOT downloaded (404/absent) -> content **Unverified**. Related (verified, `pricing__non-template-messages.md`): third-party AI replies are "service" messages; Meta Business Agent (platform launched 2026-07-01) is charged per token ($2/1M tokens, ~4-5 cents/message) from 2026-08-01. Ask Meta whether a CRM with an embedded general-purpose AI assistant counts as an "AI Provider".

**Pricing model.** Per-message since **2025-07-01** (replaced conversation-based; `pricing_model` PMP vs CBP). Only delivered **templates** charged by category (marketing/utility/authentication/+auth-international; MM API "marketing_lite") x recipient country calling code; utility templates inside open CSW free; everything free in the 72 h FEP; volume tiers for utility+auth only, aggregated per business portfolio per market-category, reset monthly 12am WABA timezone; `account_update` `VOLUME_BASED_PRICING_TIER_UPDATE`. Rates change only on Jan/Apr/Jul/Oct 1 with 1-6 months' notice. **Conflict to resolve:** `pricing.md` still says all non-template messages free, but `pricing__non-template-messages.md` states **from 2026-10-01 service (non-template) messages are charged per message** (same rates as utility/auth, no tiers) and utility templates inside CSW also become charged; rates were to be published by 2026-09-01. Today is after that date: likely live, confirm with the current rate card. `webhooks__reference__pricing.md` (404) not available.

**Messaging limits & throughput.** Limit = unique recipients business can start conversations with outside CSW per rolling 24 h, set at **business portfolio** level since **2025-10-07**, shared by all numbers. Start 250; 2,000 via verification (business or partner-led) or 2,000 delivered messages in 30 days with high-quality templates; then 10K -> 100K -> unlimited by auto-scaling (high quality + used >=50% in 7 days; increase within 6 h). Flagged state no longer exists; quality drop doesn't downgrade. Read: `GET /{phone}?fields=whatsapp_business_manager_messaging_limit` (e.g. `TIER_250`); `messaging_limit_tier` deprecated; webhooks `business_capability_update`, denial via `account_alerts`. Throughput per number: 80 mps (inbound+outbound, all types), auto 1000 mps if unlimited portfolio limit + 100K unique recipients/24 h + quality >= Medium (upgrade <=1 min downtime -> `131057`; `phone_number_quality_update` `THROUGHPUT_UPGRADE`); 20 mps for Business-app (Coexistence) numbers. Graph management endpoints: 200/h per app per WABA (5000/h for active WABAs). Sources: messaging-limits.md, upcoming-messaging-limits-changes.md, throughput.md, about-the-platform.md.

**Account-model evolution (beta).** WABA splits into a **WhatsApp Business Account (WAAC)** (one phone number/username, profile, catalogs; client-owned, shareable with many partners) and a **Messaging Account** (templates, billing, webhook subscriptions; per partner; existing WABA id becomes Messaging Account id). Templates/quality/tier do not move between Messaging Accounts (migration API; 2-4 weeks re-ramp). Messages API gets `messaging_account_id` (alias `paid_messaging_account_id` deprecated, migrate by **2026-12-31**). Phases: **P1 GA H2 2026** (auto-migration, optional param, nothing breaks); **P2 H1 2027** (new Graph version requires `messaging_account_id` if app has >1 Messaging Account on a phone; WAAC IDs + new endpoints); **P3 H1 2028** (all versions; all phone-number-id URL paths must use WAAC id). Throughput stays per phone; messaging limit per portfolio, shared. Sources: account-model-evolution.md, account-model-evolution__messaging.md.

**Test/sandbox.** `get-started.md` was NOT downloaded -> most "test number" facts Unverified. Verified fragments: public test numbers (PTN) come from the Get Started flow; recipient not on the allowed list -> `131030`; a "test message rate limit" applies to unverified WABAs (about-the-platform.md); calling sandbox is Tech-Partner-only (calling.md); Meta provides a no-delivery load-test number via Direct Support (support__load-testing.md); an echo-bot test webhook endpoint exists; the App Dashboard Test button sends sample webhooks incl. BSUID/username scenarios.

---

## 8. Top 12 facts most likely wrong in a developer's mental model

1. **No send idempotency exists.** Retrying a timed-out `POST /messages` can double-send; only `biz_opaque_callback_data` (echoed in statuses) helps reconcile. (idempotency grep = 0 hits; status.md)
2. **200 OK = accepted, not sent.** Truth is in `statuses` webhooks; `delivered` may be skipped when `read` arrives; delivery order across messages is not guaranteed. (send-messages.md, status.md)
3. **Webhooks: at-least-once, unordered, up to 7 days of retries, retries go to every subscribed app, ~20 s timeout, 1000 updates/POST, no history API.** Dedupe by `wamid`+status, fold by timestamp. (webhooks__overview.md, create-webhook-endpoint.md, calling__faq.md)
4. **The 24 h window is opened by a user message OR call, resets on each, and the 72 h free-entry-point window is billing-only** - after the CSW closes you can send only templates even during FEP. (send-messages.md, pricing.md)
5. **Default TTL is 30 days**: a "failed to deliver right now" message can still arrive weeks later; set TTL on utility/auth templates. Auth default 10 min. (send-messages.md, time-to-live.md)
6. **Phone number may be missing from webhooks.** With usernames, identify by BSUID (`user_id` / `from_user_id` / `recipient_user_id`); phone only if interacted within 30 days per business number. BSUIDs are portfolio-scoped and regenerate on number change (`user_id_update`). (business-scoped-user-ids.md)
7. **Inbound media IDs die in 7 days and download URLs in 5 minutes**; downloads need the Bearer token. Outbound uploaded IDs live 30 days. Persist media on receipt. (business-phone-numbers__media.md)
8. **Edits are not delivered as edits today** (arrive as `unsupported` type `edit`); edit/revoke webhooks exist only for Coexistence/Business-app users; revoke within 2 days. (webhooks__reference__messages__edit.md, revoke.md)
9. **Pricing flipped**: per-message since 2025-07-01 for templates; non-template service messages free until **2026-10-01**, charged thereafter per the non-template pricing page (not yet reflected in pricing.md) - cost model must include service replies. (pricing__non-template-messages.md, pricing.md)
10. **Messaging limit is portfolio-wide unique recipients per rolling 24 h, counted only for business-initiated (outside CSW) sends**, starts at 250; per-number rate limits are separate (80 mps; pair 1 msg/6 s -> 131056). (messaging-limits.md, throughput.md, about-the-platform.md)
11. **Template category is Meta's call**: UTILITY judged marketing is auto-approved as MARKETING (since 2025-04-09); paused at RED quality for 3 h/6 h/then disabled; deleting an approved template locks the name 30 days; approved templates editable only 1/24 h, 10/30 d; US (+1) numbers receive no marketing templates (`131049`). (template-categorization.md, template-pausing.md, template-management.md, per-user-limits.md)
12. **`message_status`/quality holds change what "sent" means**: paced templates return `held_for_quality_assessment` and may later fail `132015`; `131047`, `131049`, `131026` are non-retryable by blind retry; `131056` and `130429` are the retryable throttles. (template-pacing.md, error-codes.md)

---

## Unverified (not in local docs / could not read)

- 404 pages saved instead of content: `overview`, `get-started` (never fetched), `pricing/ai-providers`, `webhooks/reference/pricing`, `webhooks/message_echoes`, `messages/message-with-link`, `messages/payload-encryption`, `direct-send/get-started`, `direct-send/send-sample-payloads`, `business-phone-numbers/ai-enabled-numbers`, `calling/video-calling`, `catalogs/whats-new-in-shopping`, two utility template pages (booking-appointment, location-request).
- AI-provider restriction rules; PTN recipient cap / test-number limits; sandbox details for messaging.
- Exact HMAC raw-byte/escaping behaviour (**Recalled**); explicit messaging webhook timeout (only ~20 s inferred from calling FAQ).
- Exact send-side location of `biz_opaque_callback_data` (**Recalled** top-level); user quote-reply `context.id` on inbound text (**Recalled**).
- HTTP status/`Retry-After` per error code; whether `131047` is sync or webhook-only.
- Whether BSUID send is live today (changelog: July 2026; section says "coming soon").
- Status of non-template charging after 2026-10-01 in the live rate card; Meta Business Agent webhook/analytics details ("forthcoming").
- Flows `nfm_reply` inbound payload.
