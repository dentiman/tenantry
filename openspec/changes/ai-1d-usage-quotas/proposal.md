# Proposal

## Why

The AI assistant has two budget guardrails today (structural ceilings on one turn's size, and a
per-minute rate limiter) plus an operational last resort (a hard monthly spend cap on the
provider's own key). Nothing bounds *cumulative* token spend across many turns over time — a
buggy client loop or a chatty user can run up an unbounded bill until the provider-side cap (a
whole month's budget) finally trips. `docs/ai-assistant.md` §8 names this the third, still-missing
rubric ("Квоти токенів — доменна таблиця") and §10.1 schedules it as step `ai-1d`, dependent on
`ai-1a` (already shipped) for real usage numbers to size defaults from.

## What Changes

- Add `ai_usage_counters`: one row per `(tenantId, userId, periodStart)` under tenant RLS,
  tracking prompt, cached-prompt and completion tokens for that user's current UTC-day period.
  Tenant-level totals are computed by aggregating a tenant's rows for the period at check time,
  not stored as a second, independently-written counter — one write path, no drift.
- `AiService.ask()` checks the caller's and the tenant's current-period totals against configured
  limits **before** creating the question/reply rows or publishing the generation command —
  rejecting with a `400 BAD_REQUEST` carrying a `fieldErrors` business code
  (`ai_quota_exceeded`), the same idiom already used elsewhere in this API for a business rule
  blocking an otherwise well-formed request (`apps/api/src/users/users.service.ts`). No new
  `ApiErrorCode` member — that enum is a closed HTTP envelope and is documented as staying that
  way (`libs/contracts/src/ai/ai.schema.ts`, `docs/error-handling.md` §1).
- `AiMessageStateService.finalize()` deducts the completed turn's tokens from the caller's counter
  row in the same transaction that already records `promptTokens`/`completionTokens`/`model`
  (`ai-1a`), via an atomic increment-on-conflict write. Optimistic model: check happens before
  publish, deduction after generation, so a single user can exceed their own quota by at most one
  turn (a second `ask()` from the same user is already rejected with 409 while the first reply is
  in flight); the tenant-aggregate check can be exceeded by one turn per distinct user who reads
  the aggregate concurrently, since the aggregate isn't locked across different users' requests.
- `ai_messages.cachedPromptTokens` becomes a real, persisted column (today the number only reaches
  a worker log line) — recorded by the same `finalize()` write and rolled into the counters.
  **BREAKING (internal only):** none — additive nullable column, no existing reader affected.
- Two new `AiConfig` env vars, `AI_QUOTA_USER_DAILY_TOKENS` and `AI_QUOTA_TENANT_DAILY_TOKENS`,
  sized from the `ai-1a` live-run figures in `docs/ai-assistant-implementation.md` §7.1.
- `AiPanel` (tenant web) distinguishes a quota-exceeded rejection from any other error and shows
  it as its own inline state instead of the generic toast path.
- Decided and documented, not just implemented: tokens burned by a failed/aborted mid-stream
  attempt within a delivery are **not** counted (and not estimated) toward the quota — the
  existing, tested behaviour of `AiMessageStateService.finalize()` already keeps only the
  completing attempt's usage, and estimating would contradict the codebase's explicit "empty
  rather than estimated" principle for missing usage. Documented as a bounded, accepted gap
  (`AI_PROVIDER_RETRIES`, default 1).

## Capabilities

### New Capabilities

- `ai-assistant/usage-quotas`: per-user and per-tenant token quotas for a period, the
  pre-publish check, the post-generation deduction, and the distinct quota-exceeded outcome.

### Modified Capabilities

- `ai-assistant/generation-pipeline`: the existing usage-recording requirement ("record... the
  number of input and output tokens... Usage SHALL be taken from the attempt that produced the
  stored content only... left empty rather than estimated") extends to also record cached prompt
  tokens, under the same "attempt that produced the stored content only, never estimated" rule.
- `ai-assistant/panel`: adds a requirement that a question rejected for exceeding a usage quota
  is shown as its own distinguishable state, not folded into the panel's generic error handling.

## Impact

- **Database**: new table `ai_usage_counters` (migration, RLS policy, composite FK to `users`
  matching the `ai_conversations` pattern); new column `ai_messages.cached_prompt_tokens`.
- **Contracts** (`libs/contracts`): `AskAiResponseSchema`'s error surface gains the
  `ai_quota_exceeded` field-error business code (documented, not a schema enum change); no new
  `ApiErrorCode`.
- **`apps/api`**: `AiService.ask()` gains the pre-publish quota check; new read path for the
  current period's counters.
- **`libs/shared`**: `AiMessageStateService.finalize()` gains the deduction write and
  `cachedPromptTokens` persistence; `AiConfig`/`loadAiConfig()` gain the two quota env vars.
- **`apps/worker`**: `AiGenerateReplySubscriber` passes `cachedPromptTokens` through to
  `finalize()` alongside the existing usage fields — no change to `claim()`/`prepare()`'s
  structural flow (out of scope, shared territory with the parallel `ai-1e-retention` change).
- **`apps/web`**: `AiPanel` and its ask-mutation error handling gain the quota-exceeded state;
  `libs/i18n` gains its copy.
- **Tests**: e2e coverage for the rejection path, correct post-turn deduction, and that two
  concurrent turns near the boundary neither double-charge nor silently overshoot beyond the
  documented one-turn window; a dedicated RLS test proving one tenant cannot read or write
  another tenant's counters.
