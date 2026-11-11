## 0. Before implementing
- [x] 0.1 Confirm design.md open questions and decisions D1–D6 with the owner.
- [x] 0.2 Verify whether OpenRouter exposes embedding model prices (models list or a separate endpoint).

## 1. Provider usage
- [x] 1.1 `LlmUsage`: reported cost, request id, cache-write and reasoning tokens (OpenRouter parsing, defensive).
- [x] 1.2 `EmbeddingBatch`: reported cost and request id.

## 2. Tariffs and estimate
- [x] 2.1 Migration `ai_model_prices` (+ `CONTROL_PLANE_TABLES`), decimal estimate function with cache pricing.
- [x] 2.2 Price sync cron + platform endpoint; manual price entry; model activation check.

## 3. Ledger
- [x] 3.1 Migration `ai_usage_events` (RLS, append-only for `saas_app`).
- [x] 3.2 Worker: entries for every attempt (success, retry, cancel, lost ownership) and the question embedding.
- [x] 3.3 Ingest store and CLIs: ingest (and eval, if confirmed) entries.
- [x] 3.4 Reconciliation cron for `pending` entries.

## 4. Reporting
- [x] 4.1 platform-api summary endpoints (period × tenant/model/kind/day, reply average, failed spend, cache savings).
- [x] 4.2 platform-web `Costs` and `Prices` pages in the AI area.

## 5. Verification
- [x] 5.1 Unit: usage parsing, estimate formula, entries per attempt.
- [x] 5.2 E2E: RLS, append-only, tariff by date, survives conversation deletion, platform summary.
- [x] 5.3 Live: ledger total for a `gen-…` equals OpenRouter activity; docs; lint/typecheck/build.
