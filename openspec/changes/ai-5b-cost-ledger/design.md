## Context
Starter facts with exact code locations: docs/ai-platform-controls.md §6.1. Cost model and
provider switching: §3. Owner decisions: keep the full ledger, reporting for the superadmin only,
one model for the platform.

## Proposed decisions (confirm with the owner before implementing)

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

D3. Rows are written inside transactions that already exist: all attempts of a reply in
`finalize()`; the question embedding in the same `claim()`/`finalize()` transaction; ingest
batches in the ingest store's `write()`. The lost-ownership path writes its attempts in its own
short transaction. No provider call inside any transaction.

D4. Reconciliation: a system-scope cron fetches `GET /api/v1/generation?id=` for `pending` rows
with an OpenRouter request id, retries a few times, then marks `unknown` and keeps the estimate.

D5. Tariff sync: daily cron plus a superadmin button; only changed prices create rows. Embedding
prices may need manual entry if OpenRouter's model list does not include them (verify first).

D6. Reporting computed on the fly from the ledger with indexes on (tenant_id, occurred_at) and
(occurred_at); a daily rollup table only if measured queries get slow.

## Open questions for the owner
1. Daily rollup now or only when needed (D6)? Recommendation: only when needed.
2. Should eval runs (`pnpm ai:docs:eval`) and CLI ingest be recorded in the ledger as platform
   spending (kind `eval` / `ingest_embedding`)? Recommendation: yes, under the tenant they run in.
3. Per-reply cost visible anywhere besides the superadmin console (e.g. a column in
   `ai_messages`)? Recommendation: ledger only; the console sums by message id.
4. Currency: provider cost is in USD (OpenRouter credits); show only USD? Recommendation: yes.
