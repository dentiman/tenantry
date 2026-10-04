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
