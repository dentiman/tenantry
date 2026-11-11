## Why
Model, number of excerpts and output limit are changed blind: retrieval eval (`ai:docs:eval`)
measures search, not the answer, and nothing ties an answer's quality to its price. The owner
needs a repeatable way to compare configurations on the same questions — quality next to the
average cost per answer — before changing what production uses (docs/ai-platform-controls.md §4, §8).

## What Changes
- A local CLI `pnpm ai:answers:eval`: a question set and a configuration matrix (both files) →
  every question answered through the production pipeline (retrieval → prompt → model) for every
  configuration, without writing conversations.
- Deterministic checks per answer: citations resolve to sent excerpts, cite an expected page,
  no numbers absent from excerpts and question, refusal on unanswerable questions, answer language,
  truncation by the output limit.
- An optional LLM judge (fixed model, temperature 0) scoring groundedness and whether the answer
  addresses the question.
- Cost per answer from provider-reported usage; every call recorded in the cost ledger as `eval`.
- A budget guard and a report: summary table (quality × average cost per answer) plus a JSON file
  with every answer for inspection.
- The question-set format gains optional prior turns, so history depth can be measured.

## Capabilities
### New Capabilities
- `ai-assistant/answer-eval`: offline answer-quality evaluation with cost.

### Modified Capabilities
None.

## Impact
New script and shared eval module, a small refactor extracting the worker's prompt preparation
into a reusable function (so eval measures exactly what production runs), question-set schema
extension. No migrations, no API or UI changes, no tenant-facing change. Runs only locally
against a slot with an ingested index.
