## Context

CHAT-2a built the generic public webhook (`/api/public/channels/:provider/:webhookKey`): the key finds the
account, the adapter verifies the signature over raw bytes, the body is stored in `channel_webhook_events`
and a worker ingests it. `MetaCloudAdapter` currently refuses every webhook (`webhooks_not_enabled`). The test
WABA is shared with legacy-dev, whose address is set at the WABA and application levels; the same number
(`120000000000001`) is used by both. A read of the live configuration on 2026-10-14 shows the number-level
object `webhook_configuration { whatsapp_business_account, application }` — a `phone_number` key appears when a
number-level override exists (confirmed live on 2026-10-14).

An export of legacy-dev's own `whatsapp_webhook_log` (310 rows, kept out of git) was analysed: 215 of 215 signed
Meta requests match HMAC-SHA256(app secret, raw body) with our app secret; our two live sends of 2026-10-14
are in it with `biz_opaque_callback_data` equal to our message ids; payloads carry `user_id`/`from_user_id`.

## Goals / Non-Goals

**Goals:** receive and keep every Meta webhook on a public address, exactly as sent; let an administrator
point one number at us and back by button; read the captured events through the API; deploy it.
**Non-Goals:** any interpretation (inbound, statuses, templates, account events), enforcing the signature,
WABA-level subscription, drift checks, retention of captured events.

## Decisions

### D1. Capture reuses the existing pipeline; interpretation is switched off by an empty parse
`MetaCloudAdapter.parseWebhook` returns `events: []` (and `error: 'invalid_json'` for a body that is not JSON).
The service stores the row as today and publishes the ingest command; ingest finds nothing to do and marks the
row `PROCESSED`. No new queue, no new state. Interpretation arrives by changing `parseWebhook` in the next
slice — captured rows already in the table stay as samples (they are not replayed).

### D2. Headers and the signature result are stored on the event
`channel_webhook_events` gains `headers jsonb` (lower-cased names, `cookie`, `authorization`,
`proxy-authorization` dropped) and `signature_valid boolean` (`null` — not checkable: no app secret). The
UNIQUE `(account_id, payload_hash)` stays: a byte-identical retry is one row.

### D3. Signature policy is a setting, not a per-provider special case
`ChannelAdapter.verifyWebhook` stays the single verifier; for Meta it is HMAC-SHA256 over the raw bytes with the
app secret against `X-Hub-Signature-256` (constant-time). The service always computes the result and then
applies `CHANNEL_WEBHOOK_SIGNATURE`: `enforce` (default — current behaviour for every provider, so the fake
suites are unchanged) refuses anything but a valid signature with 401; `record` stores and answers 200. The
Hetzner scripts default it to `record` for this slice, with a comment saying why and where to flip it.

### D4. Number-level subscription, explicit, takeover named
Meta resolves the destination as phone number → WABA → application. We set only the number level
(`POST /{phone-id}` `{ webhook_configuration: { override_callback_uri, verify_token } }`), so other numbers of a
shared WABA are untouched. Reading is `GET /{phone-id}?fields=webhook_configuration`. The state compares the
effective destination (first present of the three) with this account's address. A number whose events go
elsewhere is taken over only when the request carries `replaceHost` equal to that host. Unsubscribe clears the
number-level override (an empty `override_callback_uri` clears it — verified live on the stand) and does
not try to restore an earlier number-level value, because its verify token is unknown to us.

### D5. The subscription time lives on the channel; receipts stay off
`channels.webhook_subscribed_at` records our own action; it is a convenience, not truth — the live read is
truth. `deliveryReceipts` keeps depending on `messaging_accounts.webhook_subscribed_at`, which this change
never sets: a captured status does not become a tick until the next slice.

### D6. Provider refusals are 422, not 5xx
The error filter masks 5xx; the administrator needs Meta's reason (for example a failed handshake), so a Meta
refusal is `422` with the sanitised provider title, an unreachable provider `503`. This is a diagnostic for an
admin-only action, not customer copy.

### D6a. Webhook calls to Meta are logged like every other call
`channel_logs.operation` gains `webhook` (read, subscribe, unsubscribe); same redaction and 30-day purge.

### D7. Reading captured events
`GET /settings/messaging/accounts/:id/webhook-events?limit=&cursor=` (admin): newest first, keyset by
`(received_at, id)` with an opaque cursor (the same shape as the provider call log); `limit` 1–100 (default 30). The response
holds the raw body as stored — payloads contain customer phone numbers and names, which is why the route is
administrator-only and tenant-scoped by RLS like the table.

### D8. Public address on the stand
`CHANNEL_WEBHOOK_BASE_URL` reaches the API through `docker-compose.stack.yml` (`${CHANNEL_WEBHOOK_BASE_URL:-}`);
`scripts/hetzner/common.sh` defaults it to `APP_PUBLIC_URL` (the web nginx proxies `/api`, and the public path
is open) and `CHANNEL_WEBHOOK_SIGNATURE` to `record`. A server-side `/etc/saas/deploy.env` value still wins.

## Risks / Trade-offs

- **The shared number.** While our override is set, legacy-dev receives nothing for `120000000000001`.
  Unsubscribe returns it. Said in the UI confirmation and in the runbook.
- **Unsigned acceptance on a public URL** (`record`). Mitigated by the secret 32-hex key in the path, by
  storing only, and by the flag; the route does not act on anything it stores.
- **Unbounded growth** of `channel_webhook_events` (no retention). Accepted for a test stand; a purge belongs
  with processing.
- **Clearing the override is unverified.** If an empty value is refused the unsubscribe action reports Meta's
  message and the owner removes it in the Meta dashboard; the code path is probed live before release.
