## Context
Starter facts with exact code locations: docs/ai-platform-controls.md §6.1. Cost model and
provider switching: §3. Owner decisions: keep the full ledger, reporting for the superadmin only,
one model for the platform.

## Decisions (D1–D6 confirmed by the owner 2026-10-04)

D1. Ledger table `ai_usage_events`, tenant-scoped (`tenant_id` default from context, standard
`tenant_isolation` RLS). `saas_app` may INSERT and SELECT its tenant's rows, never UPDATE or
DELETE (append-only for tenant runtime); reconciliation updates run as a system-scope job.
Columns: user id, message id and source id (plain text, no FK — survives deletion), kind,
provider, reported model, input / cached-read / cache-write / output / reasoning tokens,
reported cost + provider request id, estimated cost + tariff id, cost status
(`reported` | `estimated` | `pending` | `unknown`), occurred at. Money as `NUMERIC(18,10)`.

D2. Tariffs `ai_model_prices` (control plane; `saas_app` SELECT to estimate at write time):
provider, model, prices per 1M tokens (input, cached read, cache write, output) and per request,
currency USD, `valid_from` / `valid_to`, source `openrouter-sync` | `manual`. A price change is a
new row; history is never rewritten. Estimated cost is frozen in the ledger row at write time.
Tiered prices are stored and applied: base prices in columns, OpenRouter `pricing.overrides`
(`[{min_prompt_tokens, prompt, completion, input_cache_read, input_cache_write}]`) as a JSON
`tiers` column; the estimate picks the highest tier whose `min_prompt_tokens` ≤ input tokens of
that call, so reported-vs-estimated reconciliation does not flag false mismatches on long
prompts. `input_cache_write_1h` is not stored (we never request the 1-hour cache).

D3. Rows are written inside transactions that already exist: all attempts of a reply in
`finalize()`; the question embedding in the same `claim()`/`finalize()` transaction; ingest
batches in the ingest store's `write()`. The lost-ownership path writes its attempts in its own
short transaction. No provider call inside any transaction.

D4. Reconciliation: a system-scope cron fetches `GET /api/v1/generation?id=` for `pending` rows
with an OpenRouter request id, retries a few times, then marks `unknown` and keeps the estimate.

D5. Tariff sync: daily cron plus a superadmin button; only changed prices create rows (a change in
`tiers` counts). Two public, keyless lists (verified 2026-10-04, task 0.2): chat models from
`GET /api/v1/models` (466 models, no embeddings among them) and embedding models from
`GET /api/v1/embeddings/models` (33 models, e.g. `openai/text-embedding-3-small` →
`prompt: "0.00000002"`, `completion: "0"`). Prices are USD per token as strings → convert to per
1M with `Decimal`, never float. No model currently has `pricing.request`; keep the column for
manual tariffs. Manual entry stays for non-OpenRouter providers.

D6. Reporting computed on the fly from the ledger with indexes on (tenant_id, occurred_at) and
(occurred_at); a daily rollup table only if measured queries get slow.

## Owner answers (2026-10-04)
1. Daily rollup — **only when needed** (D6 as written; no rollup table in AI-5b).
2. Eval runs and CLI ingest — **recorded**, under the tenant they run in, kinds `eval` /
   `ingest_embedding`, no user id.
3. Per-reply cost — **ledger only**; no column in `ai_messages`, the console sums by message id.
4. Currency — **USD only**, as the provider bills.
