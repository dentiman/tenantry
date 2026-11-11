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

## Implementation refinement (2026-10-04, confirmed by the coordinator)

These refine D1–D6 for implementation; deviations from the original text are marked.

R1. **Ledger columns** (`ai_usage_events`): `id`, `tenant_id` (default from context, FK → tenants
`ON DELETE CASCADE` like every tenant table — there is no tenant-deletion route; MT-4 tenant
deletion must decide the fate of the ledger, export/archive, because the cascade silently erases
it), `occurred_at`, `kind` (`generation` | `query_embedding` | `ingest_embedding` | `eval`),
`user_id?`, `message_id?`, `source_id?`, `attempt?`, `outcome`, `provider` (billing key:
`openrouter` | `fake` | host of the base URL), `model` (as the provider named it, falling back to
the requested one), tokens `input` / `cached_read` / `cache_write` / `output` / `reasoning`
(NULL = unknown), `reported_cost NUMERIC(18,10)?`, `provider_request_id?`,
`estimated_cost NUMERIC(18,10)?` (NULL when no tariff, never 0), `price_id?`, `cost_status`
(`reported` | `estimated` | `pending` | `unknown`), `reconcile_attempts`, `reconcile_after?`.
Indexes: `(tenant_id, occurred_at)`, `(occurred_at)`, `(tenant_id, message_id)`, partial
`(reconcile_after) WHERE cost_status = 'pending'`. No FK to users, conversations or messages.
Grants: `saas_app` SELECT + INSERT, `saas_platform` all (reconciliation UPDATE);
`ensure-roles.ts` gains a `select-insert` mode so `db:roles` keeps the REVOKE.

R2. **Deviation from §3.2:** no `generation_retry` kind. Every attempt is `kind = generation` with
`attempt` and `outcome` (`complete` | `failed` | `cancelled` | `timeout` | `retried` |
`superseded` | `abandoned`; embeddings are `complete`). Spend on failed replies = rows of messages
whose last attempt is not `complete`.

R3. **Where rows are written** (never a provider call inside a transaction):
- an attempt that goes to retry — in the `restart()` transaction;
- the final attempt — in the `finalize()` transaction;
- lost ownership (`persistPartial`/`restart`/`finalize` lose the fence) — its own short transaction;
- the question embedding — in the `claim()` transaction **always**, also when `claim()` loses
  (the money is spent); that transaction commits, it is not rolled back. Usage travels in
  `KnowledgeSelection.usage`;
- worker crash mid-stream: **option B** — `ai_messages.provider_request_id` is written together
  with the partial text (`persistPartial`; it is not a cost column); when a later delivery reclaims
  the abandoned `STREAMING` row, the claim transaction writes the dead attempt as
  `outcome = abandoned`, `cost_status = pending` (or `unknown` without an id) and reconciliation
  fetches the real cost. Known limit, documented and not fixed: if the API closes the abandoned
  reply on read before any redelivery, that attempt gets no row.

R4. **Request id and status.** The provider yields the request id (`gen-…`, the stream frame `id`)
on the first frame, so Stop/timeout/superseded attempts still carry it. `usage.cost` present →
`reported`; usage without cost → `estimated` (non-OpenRouter); OpenRouter without usage → `pending`;
otherwise `unknown`. The estimate is computed whenever a tariff exists. JSON numbers become
`Decimal` through `String(n)` at the parsing boundary and are never used in float arithmetic.
`FakeLlmProvider` reports `cost: 0` (it is free), so CI needs no network.

R5. **Reconciliation:** cron `*/5 * * * *`, command `ai.reconcile-usage-costs` (system scope); up to
100 `pending` rows of provider `openrouter` with `reconcile_after ≤ now` (first one minute after the
call). `GET /api/v1/generation?id=` outside any transaction with the platform key; a 404 or error
backs off 1 / 5 / 15 / 60 min / 6 h, after 5 attempts → `unknown`. Success → native token counts,
`total_cost`, and the estimate from the tariff valid at `occurred_at` **only if it is still NULL**
(a frozen estimate is never rewritten). UPDATE only `WHERE cost_status = 'pending'`.

R6. **Deviation from D2:** tariffs have **no `valid_to`**. The tariff at T is the latest row with
`valid_from ≤ T`; the table is fully append-only. Unique `(provider, model, valid_from)`.

R7. **Price sync:** one shared function in `libs/shared` (both lists fetched outside a transaction,
each with a timeout; a failure of one list does not fail the other). The worker cron (daily
`15 4 * * *`, system scope) and platform-api `POST /ai/prices/sync` (synchronous; the lists are
public and keyless) call it. All models are synced. For provider `openrouter` the comparison is
against the latest row of that model from **any** source, so a manual tariff on an OpenRouter
model is superseded by the next sync if the price differs — the UI says so.

R8. **Model activation check:** `PUT /ai/settings` with `openai-compat` on a host other than
`openrouter.ai` and no tariff for (host, model) → 400 with `fieldErrors` on `model`. OpenRouter
(reports cost) and `fake` are not checked.

R9. **Deviation from D3 for CLIs:** a `RecordingEmbeddingProvider` decorator records one row per
successful HTTP batch in its own short tenant transaction (`saas_app` via `withKnowledgeTenant`),
for ingest (`ingest_embedding`, `source_id` = `product/sourceKey` of the knowledge source — known
before the run starts and readable in reports), eval and search (`eval`, `source_id` = the command).
Recording inside `write()` would lose a paid batch when the write fails, and `write()` runs per
slice. The worker runtime path never uses the decorator (the question embedding is recorded once,
in the claim transaction) — guarded by a test.

R10. **Reporting:** `GET /ai/costs/summary?from&to`, `GET /ai/costs/breakdown?from&to&by=
tenant|model|kind|day`, `GET /ai/prices`, `POST /ai/prices`, `POST /ai/prices/sync`. Money on the
wire is a decimal string (`z.string()` + regex), never a number. "Who hits the quota" (§3.5) is
deferred beyond AI-5b.
