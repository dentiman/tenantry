## 0. Before implementing
- [ ] 0.1 Confirm design.md open questions and decisions D1–D6 with the owner.
- [ ] 0.2 Verify whether OpenRouter exposes embedding model prices (models list or a separate endpoint).

## 1. Provider usage
- [ ] 1.1 `LlmUsage`: reported cost, request id, cache-write and reasoning tokens (OpenRouter parsing, defensive).
- [ ] 1.2 `EmbeddingBatch`: reported cost and request id.

## 2. Tariffs and estimate
- [ ] 2.1 Migration `ai_model_prices` (+ `CONTROL_PLANE_TABLES`), decimal estimate function with cache pricing.
- [ ] 2.2 Price sync cron + platform endpoint; manual price entry; model activation check.

## 3. Ledger
- [ ] 3.1 Migration `ai_usage_events` (RLS, append-only for `saas_app`).
- [ ] 3.2 Worker: entries for every attempt (success, retry, cancel, lost ownership) and the question embedding.
- [ ] 3.3 Ingest store and CLIs: ingest (and eval, if confirmed) entries.
- [ ] 3.4 Reconciliation cron for `pending` entries.

## 4. Reporting
- [ ] 4.1 platform-api summary endpoints (period × tenant/model/kind/day, reply average, failed spend, cache savings).
- [ ] 4.2 platform-web `Costs` and `Prices` pages in the AI area.

## 5. Verification
- [ ] 5.1 Unit: usage parsing, estimate formula, entries per attempt.
- [ ] 5.2 E2E: RLS, append-only, tariff by date, survives conversation deletion, platform summary.
- [ ] 5.3 Live: ledger total for a `gen-…` equals OpenRouter activity; docs; lint/typecheck/build.
