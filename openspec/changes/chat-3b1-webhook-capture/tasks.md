## 1. Schema

- [x] 1.1 Prisma + migration: `channel_webhook_events.headers jsonb`, `.signature_valid boolean`; `channels.webhook_subscribed_at timestamptz`. Verify with `prisma migrate` on the dev DB and the existing rls suite. *(Migration `20261014140000_chat_webhook_capture`, applied to the dev DB; rls suite unchanged (2 known local-only failures).)*

## 2. Capture

- [x] 2.1 `MetaCloudAdapter`: `handshake` (mode + verify token → challenge), `verifyWebhook` (HMAC-SHA256 over raw bytes, constant-time, `X-Hub-Signature-256` only), `parseWebhook` (`events: []`, `invalid_json`). Unit tests, including the algorithm against a fixed real-shape sample. *(`MetaCloudAdapter` handshake/signature/parse with unit tests (HMAC checked against the real-shape sample).)*
- [x] 2.2 `ChannelWebhookService`: compute the signature result (`null` without an app secret), apply `CHANNEL_WEBHOOK_SIGNATURE` (`enforce` default / `record`), store sanitised headers and `signatureValid`. The existing fake e2e suites pass unchanged. *(`ChannelWebhookService` stores sanitised headers and `signatureValid`; `CHANNEL_WEBHOOK_SIGNATURE`. Fake suites unchanged.)*
- [x] 2.3 e2e for Meta capture: handshake ok/wrong token/unknown key, POST stored with exact bytes/headers/signature result, repeat is one row, non-JSON stored FAILED with 200, `record` vs `enforce`, no conversation/message change. *(`chat-webhook-capture.e2e-spec.ts` (9 tests) incl. ingest marking the row processed without touching conversations.)*

## 3. Subscription

- [x] 3.1 Contracts: webhook status, subscribe request (`replaceHost?`), events list/query; `channel_logs` operation `webhook`. *(Contracts `WebhookStatus`, `SubscribeWebhook`, `WebhookEvent*`; log operation `webhook`.)*
- [x] 3.2 `WebhookSubscriptionService`: `status` (live read, hosts only), `subscribe` (public base required, takeover rule, set, read back, record time, log), `unsubscribe` (clear, read back, clear time, log). Calls outside transactions. *(`WebhookSubscriptionService`; Meta refusals are 422 with Meta's title (5xx are masked by the filter), unreachable provider 503.)*
- [x] 3.3 Controller routes under `/settings/messaging/channels/:id/webhook*` (admin, `messaging-connect` limit on writes). e2e against the Graph stub: states, takeover refused/allowed, handshake-failure mapping, read-back mismatch, 403 for non-admin, other tenant 404. *(`chat-webhook-subscription.e2e-spec.ts` (13 tests): states with hosts only, takeover rule, handshake failure, read-back mismatch, unsubscribe, 403/404/409.)*
- [x] 3.4 `WebhookEventsService` + `GET /settings/messaging/accounts/:id/webhook-events` (cursor, limit, admin). e2e: order, paging, headers/body/signature, tenant isolation, 403. *(`WebhookEventsService`, cursor paging, covered in the same suite.)*

## 4. Web

- [x] 4.1 Regenerate OpenAPI and clients. Number rows in the account card get a webhook line (state, host, Subscribe/Unsubscribe with a takeover confirmation naming the host) and the account gets a captured-events list (time, state, signature, kind of change, expand to raw body). Texts in `chat.json`; Vitest on the pure helpers. *(`NumberWebhook` and `CapturedEvents` in `webhook-panels.tsx`, helpers `webhookAction`/`summarizeWebhookBody` with Vitest; texts in `chat.json`; the live look in Orca happens with 6.3.)*

## 5. Deploy plumbing

- [x] 5.1 `docker-compose.stack.yml` api env `CHANNEL_WEBHOOK_BASE_URL`, `CHANNEL_WEBHOOK_SIGNATURE`; `scripts/hetzner/common.sh` defaults; `.env.example`; `docs/deploy-hetzner.md`. *(Compose api env, `common.sh` defaults, `.env.example`, `docs/deploy-hetzner.md`.)*

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck`, the new and the existing chat suites, then `bash scripts/ci-verify.sh`. *(Done 2026-10-14: `pnpm lint`, `pnpm typecheck`, `bash scripts/ci-verify.sh` exit 0 — tenant e2e 46 suites / 644 tests, platform 5 / 53.)*
- [ ] 6.2 *(Partly done: the live READ of `webhook_configuration` and `subscribed_apps` matches the shapes in design.md — `whatsapp_business_account`/`application` keys, hosts only. Setting and clearing the number-level override cannot be probed from a laptop: Meta calls our address during the POST. Moves to 6.3 on the stand.)* Local live probe of the Graph calls (read; the clearing call on a throwaway override) and record the findings in the design's (R) items.
- [ ] 6.3 After the owner's go: release to the Hetzner stand, connect the account there, press Subscribe on the number, send from the stand and from the phone, read the captured events through the API.

## 7. Documentation

- [x] 7.1 `whatsapp-channel.md` (§4.3, §4.13 step 4, §6, §8.1), `whatsapp-feature-flows.md` F3, a research note from the fms-api sample (payload shapes, 215/215 signature check), `chat.md`, `roadmap.md`; promote design before archiving. *(Done: `whatsapp-channel.md` §4.3/§4.13/§6, `whatsapp-feature-flows.md` F3, `whatsapp-research/fms-webhook-sample-2026-10-14.md`, `chat.md`, `roadmap.md`, `AGENTS.md`, ai-knowledge (Messaging section) + `pnpm ai:knowledge`.)*
