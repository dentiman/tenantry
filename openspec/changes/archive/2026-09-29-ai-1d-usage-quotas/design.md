# Design

## Context

See `proposal.md` — Why. The seams this change plugs into, as they exist today:

- `AiService.ask()` (`apps/api/src/ai/ai.service.ts`) runs entirely inside one
  `TenantTransactions.withTenantTx`: lock the conversation row → close abandoned replies →
  check "a reply is already in flight" → create question + reply rows → `publisher.publish()`
  the generation command. A user can never have two replies in flight at once — a second
  `ask()` while one is `PENDING`/`STREAMING` gets `409 CONFLICT` today.
- `AiMessageStateService.finalize()` (`libs/shared/src/ai/ai-message-state.service.ts`) is a
  single conditional `updateMany` fenced by `(messageId, attempt, status: 'STREAMING')`; it
  writes `promptTokens`/`completionTokens`/`model` when `usage` is present, and returns `false`
  when ownership was lost between the last write and finalization — the caller then does
  nothing further (no emission, and after this change, no deduction either).
  `AiGenerateReplySubscriber.finalize()` calls it inside its own `withTenantTx`.
- `LlmUsage` (`libs/shared/src/ai/llm/llm-provider.ts`) already carries `cachedPromptTokens?`,
  documented as "logged, not persisted — persisting it is `ai-1d`"; both
  `OpenAiCompatProvider` and `FakeLlmProvider` already populate it.
- `ApiErrorCodeSchema` (`libs/contracts/src/error/error.schema.ts`) is a closed nine-value HTTP
  envelope. `AiMessageErrorCodeSchema` (`libs/contracts/src/ai/ai.schema.ts`) is the sibling
  domain enum for *stored-row* failure reasons, and its own comment states the boundary this
  change must respect: "`ApiErrorCodeSchema` свідомо лишається закритим HTTP-рівневим набором
  ... і доменні коди в нього не додаються." A quota rejection is neither of these — it happens
  before any row exists to carry a domain code, and it is not a new HTTP-envelope concept.
- The established idiom for "a specific business rule blocks this otherwise well-formed
  request" is `BadRequestException({ message, fieldErrors: [{ field, message, code:
  '<business_code>' }] })` — used today in `apps/api/src/users/users.service.ts` for
  `self_status_change` and `invalid_file`, neither of which is a Zod validation failure.
  `FieldError.code` is documented for exactly this ("Zod issue code ... or business code
  `already_exists`"). `isGlobalApiError()` (`libs/ui/src/api/api-error.ts`) does **not**
  auto-toast a plain 400, so a caller that wants to render it specially already must inspect
  the parsed error itself — which `AiPanel`'s `ask.mutate` currently does not do at all.

## Goals / Non-Goals

**Goals:**
- One new table carries both per-user and per-tenant visibility for a period without a second,
  independently-written aggregate that could drift from the per-user rows.
- The check-before-publish / deduct-after-generation split stays inside the transaction
  boundaries that already exist (`ask()`'s tx, `finalize()`'s tx) — no new transaction, no
  cross-process coordination.
- Every new behaviour is exercised by `FakeLlmProvider`'s existing deterministic usage, no new
  network- or key-dependent path.
- The quota-exceeded outcome is reachable and renderable by the frontend as its own state.

**Non-Goals:**
- Billing, cost in money, or per-tenant billing plans (`ai-assistant.md` §11 open question 1 —
  left as-is: the counters this change adds are what a future billing phase would read).
- Counting or estimating tokens burned by an attempt that failed before reporting usage (D6).
- Any change to `claim()`/`prepare()`'s structural flow, retention, or cron — that territory
  belongs to the parallel `ai-1e-retention` change on the same base branch.
- Surfacing usage history/spend to the tenant admin (`/settings/ai`) — that's AI-3.
- A kill switch to disable quota enforcement independently of setting very high limits.

## Decisions

### D1. One row per `(tenantId, userId, periodStart)`; tenant totals are aggregated, not stored

`ai_usage_counters` has exactly one row per user per period. There is no separate
tenant-scoped row. The tenant's total for a period is `SUM` over its rows for that period,
computed at read time with Prisma's `aggregate({ _sum })`.

*Alternative considered:* a second row per `(tenantId, periodStart)` with `userId = null`,
updated alongside the per-user row in the same deduction. Rejected: it is a second write inside
the same transaction that must stay in lockstep with the first forever, for a number that is
trivially derivable from the rows that already exist — the second write buys nothing and adds
a drift class of bug (a crash or a future code path that touches one and not the other).
Aggregating at read time costs one indexed `SUM` per `ask()`, which is cheap at the row counts
a per-day-per-user table produces (one row per active user per day).

### D2. Period is the UTC calendar day

`periodStart` is midnight UTC of the day the counter belongs to. A day, not a month, because:
the existing "last resort" is already a *monthly* spend cap in the provider's own dashboard
(`.env.example`, `docs/ai-assistant.md` §8) — a second guardrail at the same monthly grain adds
no new protection over that cap arriving a bit later. A daily grain catches a runaway loop or a
single very heavy day within hours instead of leaving it to run for up to a month, and needs no
rollover job: the period key is derived from `now()` at check/deduction time, and a new day's
first turn simply creates a new row via `upsert`.

*Alternative considered:* a rolling 30-day window (`SUM` over the last 30 days of usage
instead of a period key). Rejected: it would require reading every message's usage in the
window on every `ask()` instead of one row per user, and `ai_messages` has no per-message
purpose-built index for that; calendar-day buckets are the cheap version of the same idea.

### D3. Rejection shape: `400 BAD_REQUEST` + `fieldErrors` business code, no new `ApiErrorCode`

Resolving the deferred decision from `ai-1a`/`ai-1c` (`ai-assistant.md` §10.1, §11 item 7): the
check in `AiService.ask()` throws

```ts
throw new BadRequestException({
  message: 'AI usage quota exceeded for the current period',
  fieldErrors: [{ field: 'text', message: 'AI usage quota exceeded for the current period', code: AI_QUOTA_EXCEEDED_CODE }],
});
```

where `AI_QUOTA_EXCEEDED_CODE = 'ai_quota_exceeded'` is exported once from
`libs/contracts/src/ai/ai.schema.ts` so the frontend never re-types the string. No member is
added to `ApiErrorCodeSchema`.

**Why not a new `ApiErrorCode`:** the enum's own call site in `ai.schema.ts` already states the
rule this change must not violate — it is a closed HTTP-envelope set, and domain reasons live
elsewhere. A quota rejection is a domain reason, exactly like `self_status_change` or
`invalid_file` already are.

**Why not `429 TOO_MANY_REQUESTS`:** that code is already the per-minute throttler's
(`AI_ASK_LIMIT_PER_MINUTE`, AUTH-0's `ThrottlerGuard`). Reusing it for a quota rejection would
make two semantically different outcomes ("wait a few seconds" vs. "wait until tomorrow's
period") indistinguishable at the top-level `code`, defeating the proposal's "distinct state"
requirement unless the frontend *also* inspects `fieldErrors` — at which point the top-level
code carries no information the frontend needs anyway, so there is nothing to gain from 429
over 400 here, and 400 keeps `isGlobalApiError()` from auto-toasting it (429 is always global).

**Why not `403 FORBIDDEN`:** already used by `AiService.assertEnabled()` for "the installation
has the assistant switched off entirely." Reusing it would make "the feature is off" and "you
are over quota" collide on the code a naive frontend check would look at first.

**Why not a domain code carried in the stored reply's row instead of an HTTP rejection:** the
proposal fixes this — the check runs *before* the question and reply rows are created, so
there is no row to carry a code on. Moving the check to *after* row creation (reject inside the
transaction after inserting, then roll back) would still end up as an HTTP rejection from the
same request, just with extra work in between; putting it there instead of before gives up
nothing and loses the "never even queue it" property the proposal wants.

### D4. Deduction: atomic upsert-increment inside `finalize()`'s existing transaction

`AiUsageQuotaService` (new, `libs/shared/src/ai/ai-usage-quota.service.ts`, registered and
exported by the existing `AiModule` alongside `AiMessageStateService`) gets two methods:

```ts
checkQuota(tx, tenantId, userId, now): Promise<{ scope: 'user' | 'tenant' } | null>
deduct(tx, tenantId, userId, now, usage: { promptTokens, cachedPromptTokens, completionTokens }): Promise<void>
```

`checkQuota` reads the caller's own row (`findUnique` on the unique key) and the tenant
aggregate (`aggregate({ _sum })`) for `periodStart = startOfUtcDay(now)`, and returns which
limit (if any) is already at or past its configured ceiling — `null` means proceed.
`AiService.ask()` calls it as the very first statement inside its existing `withTenantTx`,
before the conversation-row lock, and throws the `D3` exception if it returns non-null.

`deduct` is a raw `INSERT ... ON CONFLICT (tenant_id, user_id, period_start) DO UPDATE SET
prompt_tokens = ai_usage_counters.prompt_tokens + EXCLUDED.prompt_tokens, ...` via
`tx.$executeRaw`, run on the same `tx` that already carries `set_config('app.tenant_id', …)`
from `withTenantTx` (RLS's `FOR ALL … USING/WITH CHECK` applies to both the insert and the
conflict-update arm exactly as it would to any other statement on that connection — this is
not the raw-query-bypasses-RLS case CLAUDE.md rule 16 warns about, which is about a raw
statement issued *outside* a tenant transaction). `AiGenerateReplySubscriber`'s own
`finalize()` wrapper calls `deduct()` right after `AiMessageStateService.finalize()` reports
`count > 0` (ownership still held) and `usage` is non-null — mirroring the existing condition
that already guards writing `promptTokens`/`completionTokens`, inside the same transaction.

*What actually shipped here, and why it changed from the original plan:* the first
implementation used Prisma's `aiUsageCounter.upsert()` (a plain `INSERT … ON CONFLICT DO
UPDATE` in theory). A real-Postgres concurrency test — two `deduct()` calls racing for the
same `(tenantId, userId, periodStart)` before either had committed — reproducibly failed with
a `P2002` unique-constraint error on the losing call. Prisma's query engine does not always
compile `upsert()` on a *composite* unique key into a single atomic SQL statement; observed
behaviour here was effectively select-then-branch, which two truly concurrent callers can both
pass through before either writes, so both attempt the insert. Postgres's own `INSERT …
ON CONFLICT DO UPDATE` does not have this problem — it is genuinely one statement, one row
lock — so `deduct()` was rewritten to issue that SQL directly. The failing test is kept
(`apps/api/test/ai-usage-quota.e2e-spec.ts`) as the regression guard for this exact race; it
is also the "two concurrent turns don't double-charge" acceptance test, run against real
Postgres rather than a mocked client precisely because this class of bug is invisible to a
mock.

*Alternative considered:* a `SELECT ... FOR UPDATE` then a plain `UPDATE`. Rejected as strictly
worse even before the `upsert()` finding: two statements and an explicit lock instead of one,
for the same result.

**Overshoot bound, precisely stated:** a *user's own* quota can be exceeded by at most one turn,
because `AiService.ask()` already refuses a second question while the user's previous reply is
`PENDING`/`STREAMING` — there is structurally never a second in-flight turn to rack up further
overshoot. The *tenant aggregate* has no such structural lock across different users' requests:
if several distinct users in the same tenant each pass their own `checkQuota()` at
approximately the same moment, before any of their `deduct()` calls land, the tenant total can
overshoot by up to one turn *per user who raced through concurrently* — not a single global
"one turn" bound. This is the honest version of the "оптимістично ... рівно на один хід"
language in `ai-assistant.md` §8, which describes the single-actor case; the multi-actor tenant
case is documented here rather than silently narrowed. It is still bounded (by the number of
distinct users who can plausibly race within one generation's duration, itself bounded by
`AI_REQUEST_TIMEOUT_MS`), and accepted as the cost of not taking a lock across the whole
tenant's `ask()` calls, which would serialize every user in a tenant behind one one at a time.

### D5. `cachedPromptTokens` is a real column; quota arithmetic never double-counts it

`ai_messages.cached_prompt_tokens` (nullable `Int`, same convention as `prompt_tokens`/
`completion_tokens`) is written by `AiMessageStateService.finalize()` in the same conditional
block that already writes the other two usage columns, straight from `usage.cachedPromptTokens`
when the provider reports it.

`cached_tokens` (OpenAI/OpenRouter's `prompt_tokens_details.cached_tokens`) is a **subset** of
`prompt_tokens`, not additive — the backend does not bill cached and non-cached prompt tokens
as two separate pools. Quota arithmetic — both in `checkQuota`'s aggregate and in `deduct`'s
increment — therefore always totals as `promptTokens + completionTokens`; `cachedPromptTokens`
is stored and summed in its own column purely for the cache-hit-rate visibility the proposal
asks for (`ai-assistant.md` §8: "саме по них видно, чи працює кеш"), and is never added a
second time on top of `promptTokens`, and never separately budgeted against its own limit.

### D6. Failed/aborted mid-stream attempt tokens are not counted, and not estimated

Resolving the other deferred decision (`ai-assistant.md` §10.1, §7.1 "Відомий пропуск"): a
generation attempt that fails mid-stream (network error, 5xx, a stream that ends without
`finish_reason`/usage) never reaches the terminal usage frame — there is no reported number for
it, real or partial. This change makes no attempt to sum across attempts or to estimate the
failed attempt's cost (e.g. from prompt character count, the way `FakeLlmProvider` estimates
its own synthetic usage).

**Why:** `AiMessageStateService.finalize()` already encodes, as an explicit and tested
principle (not an oversight), "no usage → columns untouched... порожньо, а не оцінка" — the
existing `ai-generate-reply.subscriber.test.ts` case "після ретраю зберігається usage СПРОБИ,
ЩО ЗАВЕРШИЛАСЬ, а не сума чи перша" is exactly this rule under test today, for the display
columns. Estimating a failed attempt's tokens for the quota counters, while leaving
`ai_messages` itself un-estimated for the same attempt, would mean the two numbers the system
keeps for "how much did this turn cost" disagree by construction, and an estimate is exactly
the thing the codebase has already decided not to do here. Consistency with the existing,
tested principle outweighs closing the gap with a guess.

**Accepted, bounded gap:** the backend itself billed for the failed attempt's tokens even
though nothing in this system observes them. Bounded by `AI_PROVIDER_RETRIES` (default `1`): at
most one extra provider call's real spend per turn goes uncounted, on top of the turn that did
complete and was counted normally. This is the same bound `ai-1a`'s design.md already named in
its own Risks section ("Bounded by `AI_PROVIDER_RETRIES` (1). `ai-1d` decides whether to count
it") — this change's decision is: no.

### D7. Default limits and configuration

Two new `AiConfig` fields, following `loadAiConfig()`'s existing `intFromEnv` pattern
(`libs/shared/src/ai/ai.config.ts`):

| Env var | Default | Derivation |
| --- | --- | --- |
| `AI_QUOTA_USER_DAILY_TOKENS` | `1,000,000` | ≈11k prompt + ~100 completion ≈ 11.1k tokens/turn (§7.1 live run) → ~90 turns/day at the worst case (all cold, no cache hits) before a user is blocked; ~50 warm-ish turns/day (≈560k tokens) fits with headroom |
| `AI_QUOTA_TENANT_DAILY_TOKENS` | `10,000,000` | 10× the per-user default — bounds a multi-user runaway (many users each under their own limit, summing to an unbounded tenant total) without making a single normal-sized tenant (a handful of daily-active users) hit it under ordinary use |

Both are per-day, per-installation defaults an operator tunes for their own tenant sizes and
provider pricing; they are not derived from a dollar figure because the counters this change
adds are token counts, matching "квоти токенів" in the source doc, not a cost tracker (§11 item
7 — cost tracking is explicitly left for a future billing phase to build on these counters).

### D8. Test control over `FakeLlmProvider`'s usage numbers

`FakeLlmProvider` already reports deterministic, non-zero, input-proportional usage
(`ceil(chars / 4)` for both prompt and completion) with no directive needed. Quota tests that
need an exact boundary (e.g. "this turn's usage lands the counter exactly at the limit")
control it by choosing the question text's length, the same way existing tests already get
deterministic completion length via `FAKE_LLM_DIRECTIVES.long`. No new fake-provider directive
is introduced — the existing knob is sufficient and keeps the fake's surface area small.

### D9. Frontend: the panel distinguishes the rejection instead of relying on the global toast

`useAiAsk()`'s `ask.mutate` in `AiPanel` (`apps/web/src/components/ai/ai-panel.tsx`) gains an
`onError` that parses the error, checks for `fieldErrors` carrying `AI_QUOTA_EXCEEDED_CODE`, and
sets local state the panel renders as its own inline notice (e.g. disabling the composer with a
message, rather than a transient toast). Every other 4xx/5xx from `ask()` is left to the
existing global-toast path (`isGlobalApiError()`) — unchanged behaviour, addressed by the
`ai-assistant/panel` spec delta's second scenario.

## Risks / Trade-offs

- [Tenant aggregate overshoot is per-racing-user, not a flat one turn] → see D4. Mitigated by
  keeping the per-day tenant ceiling generous relative to plausible concurrent user counts; a
  future phase could add a coarser, locked pre-tenant-check if this proves insufficient, but
  that reintroduces the two-phase-reservation cost the optimistic design was chosen to avoid
  (`ai-assistant.md` §8).
- [Failed-attempt tokens are silently uncounted] → D6, bounded by `AI_PROVIDER_RETRIES`, and a
  deliberate, documented choice, not an oversight.
- [`ai_usage_counters` accumulates one row per active user per day indefinitely] → no pruning in
  this change (retention is `ai-1e`'s territory, explicitly out of scope here for this base
  branch's parallel work). Row count is bounded by (active users × days since deploy), which is
  small relative to `ai_messages`; a future retention pass can extend to this table without a
  schema change.
- [Aggregate `SUM` on every `ask()` adds a read] → indexed on `(tenant_id, period_start)`
  (needed for RLS + the aggregate's `WHERE` anyway), cheap at one row per active user per day.

## Migration Plan

Additive only: new table `ai_usage_counters` (RLS, composite FK to `users` mirroring
`ai_conversations`), new nullable column `ai_messages.cached_prompt_tokens`. No backfill — rows
accrue from the deploy moment forward; a message generated before this change simply has no
cached-token figure and never affected any counter, same as it has no `promptTokens` today if
it predates `ai-1a`. Rollback: revert the code (the table can be left in place, unused, or
dropped in a follow-up migration — no other table references it). Enabling quotas needs no flag
beyond `AI_ENABLED`: the two new env vars have working defaults (D7) and apply as soon as this
change deploys.
