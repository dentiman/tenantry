## Context

Owner decisions (2026-10-04): answer eval is a **CLI only**, no button or results storage in the
admin; it is run **locally** with a specific configuration and question set passed as files. It asks
new questions from a fixed test set; it never reads users' conversations (tenant data, retention,
"delete my conversations"). Background, cost model and what AI-5b recorded: docs/ai-platform-controls.md
§3, §7, §8. Retrieval eval for comparison: docs/ai-sources/README.md.

## Decisions

D1. **Same pipeline as production.** The worker's prompt assembly (knowledge selection →
`buildPrompt` with boundaries, organization instructions, user context, history) is extracted into a
pure shared function used by both the worker and the eval; the eval differs only in where the
question comes from and that nothing is persisted. Temperature and every other request parameter
stay exactly as in production — no eval-only sampling settings.

D2. **Inputs are files.**

- Question set: the existing `fms-eval.json` schema plus optional `turns` (prior user/assistant
  messages) and optional `mustMention` (strings the answer should contain). Any file with that
  schema can be passed (`--questions`).
- Configuration matrix (`--configs`): named entries with `model`, `maxOutputTokens`, `finalChunks`,
  `maxContextTokens`, `historyTurns`, and optionally `searchMode` / `maxDistance` (local only, so search
  parameters may vary too). Unset fields fall back to the effective settings (platform settings over
  env, the same merge as the worker). Provider, base URL and key come from the effective settings.
  A committed example lives next to the question set.

D3. **Deterministic checks** per answer, no network:

- `citations_valid` — every `[n]` resolves to a sent excerpt;
- `citation_hit` — a cited excerpt belongs to an expected page (`expectAll` → all of them);
- `numbers_grounded` — every number in the answer (excluding citation markers and list numbering)
  occurs in the sent excerpts or the question;
- `refusal_ok` — for questions with no expected pages: no citations (proxy), judge confirms if enabled;
- `language_ok` — script of the answer matches the question's `language`;
- `truncated` — the provider stopped on the output limit;
- `mentions_ok` — all `mustMention` strings present (only when given).

D4. **Optional LLM judge** (`--judge <model>`): one fixed model for the whole run, temperature 0,
strict JSON output (`grounded` 1–5, `answers_question` 1–5, `refusal_correct`, short `note`), given
question, sent excerpts, answer and whether the question is answerable. A warning when the judge is
one of the candidate models. Invalid judge output is recorded as `judge_error`, not retried endlessly.

D5. **Cost.** Per answer: provider-reported cost of the generation plus the question embedding (the
embedding is cached across configurations with the same retrieval parameters, like `ai:docs:eval`,
and its cost is reported once). Judge cost is reported separately and never mixed into answer cost.
Every provider call goes to `ai_usage_events` with kind `eval` under `--tenant`, `source_id =
answers-eval:<runId>:<config>`.

D6. **Budget guard.** `--max-cost <USD>` (required when not `fake`): before the run, an estimate from
tariffs (questions × configs × repeats × expected tokens); abort if over. During the run, stop when
the reported total crosses the limit, and still write the partial report.

D7. **Output.** Terminal summary table per configuration: answered / refused correctly / citation
hit / numbers grounded / language / truncated / judge means, average and p90 cost per answer, average
latency and output tokens. `--output <dir>` writes `summary.md` and `answers.json` (every answer
with checks and judge result). Raw outputs are local artefacts and are not committed; a chosen run's
summary table may be copied into docs, like the retrieval eval table.

D8. **Repeats.** `--repeat N` (default 1) to see variance; the summary reports the mean and the spread.

D9. **No DB writes besides the ledger.** No `ai_messages`, no conversations, no quota deduction (quota
protects tenant runtime, not operator tooling).

## Owner answers (2026-10-04)

1. Judge — **off by default**, enabled with `--judge <model>`; the README recommends a judge model.
2. Moving quality parameters (`AI_MAX_OUTPUT_TOKENS`, `AI_HISTORY_TURNS`, `AI_DOCS_FINAL_CHUNKS`,
   `AI_DOCS_MAX_CONTEXT_TOKENS`) into the superadmin settings is **a separate later change**
   (`ai-5c2-quality-settings`), after the first eval run shows which ones matter. Not in this change.
3. Question set — the coordinator prepares a review page (questions, expected pages, what retrieval
   actually returns, proposed dialogue cases); the owner's verdicts are applied to `fms-eval.json`
   separately from this change. The eval code must not depend on the review outcome.

## Implementation details (refined before coding)

I1. **Shared function.** `buildGenerationRequest(input): LlmRequest` in
`libs/shared/src/ai/prompt/generation-request.ts` (runtime barrel). Input: `question`,
`historyRows` (`AiHistoryRow[]` in `seq` order), `historyTurns`, `user` (`AiUserContext`),
`organization`, `knowledge` (`Pick<KnowledgeSelection, 'documents' | 'excerpts'>`), `model`,
`maxOutputTokens`. It applies `selectHistoryPairs(historyRows, historyTurns)` → `buildPrompt` →
`{ messages, model, maxOutputTokens }`. The worker's `readContext()` keeps the DB read (including the
`HISTORY_SLACK_TURNS` over-read) and returns the rows; `prepare()` calls the function instead of
assembling the request inline. No other worker change. `PostgresKnowledgeSource.select()` maps its
retrieval through an exported `selectionFromRetrieval(product, retrieval)` so the eval gets the
same selection plus retrieval diagnostics from `retrieve()`.

I2. **Eval context.** Knowledge: `PostgresKnowledgeSource` only (product from the question set),
`vectorCandidates`/`textCandidates` from `AiConfig`, the rest per configuration. Organization:
the `--tenant`'s `settings.ai` through `readAiSettings` (same as the worker; tenant configuration,
not conversation data). User context: `role` from the question, `locale` = `--locale` (default `en`,
the column default every user has today). Prior turns: `turns` → rows (`seq` 1…, `COMPLETE`) →
the same `historyTurns` window. Availability switches are not checked (operator tool).

I3. **Provider.** Effective settings exactly as the worker: platform row (read under `saas_app`, no
RLS) over env, `resolveGenerationSettings` + `createLlmProvider` + `billingProviderFor`; the
configuration may change only `model`. Embeddings: `RuntimeEmbeddingProvider` (dedicated env pair,
else generation URL/key), cached by question text across configurations and repeats and wrapped in
`RecordingEmbeddingProvider`. Retries as in production: up to `AI_PROVIDER_RETRIES` extra attempts on
retryable errors after `AI_RETRY_DELAY_MS`, abort at `AI_REQUEST_TIMEOUT_MS`.

I4. **Ledger rows** (`kind = 'eval'`, `user_id`/`message_id` NULL), each written in its own short
tenant transaction AFTER the provider call: generation — `source_id = answers-eval:<runId>:<config>`,
`attempt`, `outcome` `complete` / `retried` / `failed` / `timeout`, model as named by the provider
with the requested one as tariff fallback; question embedding — `answers-eval:<runId>:embedding`
(only real, uncached calls); judge — `answers-eval:<runId>:judge`. `runId` =
`<UTC yyyymmddThhmmss>-<4 hex>`. The run's ledger total is
`sum(coalesce(reported_cost, estimated_cost)) where source_id like 'answers-eval:<runId>:%'`; the runner
reads it back at the end and prints it next to its own total.

I5. **Cost in the report.** Answer cost = generation (all attempts) + the question embedding, the
embedding counted for every answer even when cached (what the answer costs in production). Run total =
actual spend (embedding once) + judge, shown separately. Per call: `reported` if the provider gave a
cost, else tariff estimate, else unknown (counted and shown, never 0).

I6. **Checks.**

- Citations: `citedNumbers` (the production regex). `citations_valid` — every cited number is a sent
  `n`. `answered` (answerable questions) — non-empty answer with ≥1 valid citation. `citation_hit` —
  cited excerpts' paths contain an expected page (`expectAll` → all). `retrieval_hit` (diagnostic) —
  same over sent excerpts, to tell a search miss from a generation miss.
- `numbers_grounded`: tokens `\d+(?:[.,]\d+)*` after removing citation markers, line-leading list
  numbering (`1.`, `2)`, also after `#`/`-`/`*`), Markdown link targets and URLs. A token is grounded if
  its canonical form is in the set built the same way from excerpts + question + prior turns.
  Canonical: `1,000`/`1 000` thousands → `1000`; `0,5` → `0.5`; leading zeros stripped. Single-digit
  integers are ignored (counts, steps, ordinals). The ungrounded tokens are listed in `answers.json`.
- `refusal_ok` (no expected pages): no valid citations; with the judge also `refusal_correct`.
- `language_ok`: letters after removing code, URLs and citations; Cyrillic share ≥ 0.5 → Cyrillic
  answer. `en` expects Latin; `uk` expects Cyrillic and not Russian-only letters (`ы э ъ ё` without any of
  `і ї є ґ`); other languages → not checked.
- `truncated`: provider `finish_reason = length`; providers without it (fake) — `completionTokens ≥
maxOutputTokens`.
- `mentions_ok`: every `mustMention` as a case-insensitive substring (whitespace collapsed).

I7. **Judge.** `--judge <model>` on the same effective provider/URL/key, `temperature: 0`,
`maxOutputTokens: 400`. System message: grader role, scales, JSON-only output. User message: the
question (and prior turns), whether the documentation is expected to answer it, the sent excerpts in
the same `<excerpt n=…>` fences, the answer. Expected
`{"grounded":1-5,"answers_question":1-5,"refusal_correct":bool,"note":string≤300}`. Parsing: strip a
` ```json ` fence, take the outermost `{…}`, `JSON.parse`, Zod. Failure → `judge_error`
(`provider` / `invalid-json` / `schema`), no re-ask. Warning when the judge model is a candidate.

I8. **Budget.** `--max-cost` required unless every call is `fake`. Estimate per call from the tariff
at now (`estimateCost`, upper bound): generation input = tokens of the boundaries/organization/user
context + `maxContextTokens` + question + prior turns (cl100k), output = `maxOutputTokens`; judge input =
that + `maxOutputTokens` + 600, output 400; embedding — question tokens, once. Total =
Σ questions × configs × repeats. A candidate model without a tariff → abort (no estimate possible),
`fake` → 0. Live: after every call the running total (reported, else estimated, else the call's
pre-run estimate) is compared with the limit; crossing it stops the run and the partial report is
written with `stopped: budget`. Order is interleaved — repeat → question → configuration — so a stop
leaves comparable partial data for every configuration.

I9. **Report.** Terminal and `summary.md`: per configuration answered, refused correctly, citations
valid, citation hit, retrieval hit, numbers grounded, language, truncated, mentions, judge means,
average/p90 answer cost, average latency, average output tokens, errors; rates as mean (min–max over
repeats) when `--repeat > 1`. `answers.json`: run meta (runId, question-set path + status, resolved
configurations, judge, totals, ledger total), and every answer with excerpt refs (n, path, heading),
checks, judge, usage, cost, latency, finish reason, error.

I10. **Layout.** CLI-only code in `libs/shared/src/ai/eval/` (not in the runtime barrel, like
`knowledge/ingest/`): `question-set.ts` (the schema, now shared with `ai:docs:eval`),
`eval-config.ts`, `checks.ts`, `judge.ts`, `budget.ts`, `runner.ts` (dependencies injected — a unit
test runs it with fakes, no DB or network), `report.ts`. Script `scripts/ai-answers-eval.ts`,
`pnpm ai:answers:eval`. Example configuration file `docs/ai-sources/answer-eval-configs.json`.

## Coordinator answers (2026-10-04, before coding)

All recommendations accepted: `finish_reason` on the terminal usage frame (fallback
`completionTokens ≥ maxOutputTokens`), `--locale` default `en` + the tenant's organization
instructions, `--fake`, answer cost including the cached embedding, abort on a missing tariff,
single-digit integers ignored, interleaved order, plus `--only q01,q02`. Clarifications:

- `temperature` is optional on `LlmRequest` and ABSENT from the production request body (no
  `undefined` key, no `null`); a unit test pins the production body unchanged.
- `--fake` lifts the `--max-cost` requirement only when both generation and judge are fake.
  Embeddings stay real — a key and network are still needed unless every configuration uses
  `searchMode: fts`; the README says so.
- The missing-tariff abort names the model and points at price sync (platform-web → AI → Prices →
  Sync, or the `ai.sync-model-prices` cron); `fake` needs no tariff.
- `numbers_grounded` also ignores numbers present in the question or the prior turns (the grounding
  set already includes them).
- The report separates "answer cost as in production" from "actually spent by this run".
- Dialogue cases: `turns = [{role, content}]` (prior pairs), `question` is the last question.
