## 1. Contracts and classification

- [x] 1.1 `NormalizedMessageEvent.content.unsupportedType?: string`; ingest stores `payload.unsupported` and keeps the body placeholder. `hasDeliveryReceipts` takes the channel's `webhookSubscribedAt`; both mappers pass it. Typecheck and existing ingest/mapper suites green. *(`unsupportedType` on the message content; ingest stores `payload.unsupported`; `hasDeliveryReceipts` uses the channel's `webhookSubscribedAt` (both selects and mappers).)*
- [x] 1.2 `errors.ts`: `classifyWebhookFailure(code, title, details)` from the same table (unknown → `PERMANENT`), unit test per class and the 131049 sample. *(`classifyWebhookFailure` in `errors.ts`; unit tests in `webhook-parser.test.ts`.)*

## 2. Parser

- [x] 2.1 `MetaCloudAdapter.parseWebhook` per D1–D4. Unit tests on real-shape fixtures: text, image, document, reaction, unknown type, `sent`/`delivered`/`read`, `failed` 131049 with details, mixed batch, template update and account update (unsupported), malformed branches, missing phone id, non-JSON, BSUID in providerMeta, contact name matched by `wa_id`. *(`webhook-parser.ts` (pure) + 16 unit tests on real-shape fixtures in `testing/webhook-fixtures.ts`; `MetaCloudAdapter.parseWebhook` delegates to it.)*

## 3. End to end

- [x] 3.1 `chat-meta-webhook.e2e-spec.ts`: a signed Meta POST through the public URL, then the ingest service: first text creates contact/conversation/message and opens the window (reply accepted); redelivery and a repeat in another webhook store nothing new; image → placeholder with payload and preview; delivered/read fold forward-only; `sent` after `delivered` is ignored; a status carrying our id before the id is recorded is parked then applied by the sweeper path; `failed` 131049 → FAILED, POLICY, code and details; template/account update stored, no change; unknown phone id → unroutable. *(`chat-meta-webhook.e2e-spec.ts` (10 tests) through the public URL and the ingest service. The sweeper path is already covered by `chat-delivery`; here a status finds a message without an `external_id` by our id directly.)*
- [x] 3.2 `deliveryReceipts` follows subscribe/unsubscribe (subscription e2e extended, conversation card and channel list). *(Covered in the same suite (flag follows `webhookSubscribedAt`).)*

## 4. Web

- [x] 4.1 Transcript: placeholder rendered from `payload.unsupported`; locale text; the composer/settings notices already follow `deliveryReceipts`. Vitest on the pure text helper. *(`unsupportedText`/`templateText` moved to `whatsapp-helpers.ts` with Vitest; locale `message.unsupported`; settings notices reworded.)*

## 5. Deploy

- [x] 5.1 `common.sh` no longer defaults to `record`; `docs/deploy-hetzner.md` updated. *(`common.sh` no longer defaults to `record`; `docs/deploy-hetzner.md`.)*

## 6. Verification

- [ ] 6.1 `pnpm lint && pnpm typecheck`, the chat suites, `bash scripts/ci-verify.sh`.
- [ ] 6.2 After the owner's go: release; on the stand send a text from the phone (a conversation appears with the text), reply from the stand (ticks appear: sent, delivered, read), send an image from the phone (placeholder), confirm an unsigned POST is refused.

## 7. Documentation

- [x] 7.1 `whatsapp-channel.md` (§4.3/§4.4/§6/§8.1), `whatsapp-feature-flows.md` F4/F5/F11, `chat.md`, `roadmap.md`, ai-knowledge (Chat: inbound, ticks, unsupported), research note update; promote design before archiving. *(`whatsapp-channel.md`, `whatsapp-feature-flows.md` F4/F5/F11, `chat.md`, `roadmap.md`, ai-knowledge (08, 13) regenerated.)*
