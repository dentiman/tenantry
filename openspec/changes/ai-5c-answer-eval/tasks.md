## 0. Before implementing
- [x] 0.1 Confirm design.md open questions with the owner.

## 1. Shared pipeline
- [ ] 1.1 Extract the worker's prompt preparation (knowledge selection → `buildPrompt` inputs) into a pure shared function; the worker uses it with no behaviour change (existing worker tests stay green).

## 2. Inputs
- [ ] 2.1 Question-set schema: optional `turns` and `mustMention`; existing files stay valid.
- [ ] 2.2 Configuration-file schema with fallback to effective settings; committed example.

## 3. Evaluation
- [ ] 3.1 Deterministic checks (citations valid/hit, numbers grounded, refusal, language, truncation, mentions) as pure functions.
- [ ] 3.2 Optional LLM judge with strict JSON and `judge_error`.
- [ ] 3.3 Runner: embedding cache per retrieval parameters, repeats, ledger rows (`eval`), budget guard (estimate + live stop).
- [ ] 3.4 Report: terminal table, `summary.md`, `answers.json`.
- [ ] 3.5 `pnpm ai:answers:eval` script entry.

## 4. Verification
- [ ] 4.1 Unit: every check, judge parsing, budget guard, config fallback.
- [ ] 4.2 Run with `fake` (no network) end to end in a slot.
- [ ] 4.3 Live run: two configurations on `fms-eval.json` via OpenRouter; ledger `eval` total equals the report's total.
- [ ] 4.4 Docs: README section next to the retrieval eval; docs/ai-platform-controls.md "AI-5c: як реалізовано"; lint/typecheck/build.
