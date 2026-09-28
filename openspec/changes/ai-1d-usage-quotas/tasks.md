# Tasks

## 1. Data model

- [x] 1.1 Add `AiUsageCounter` model to `libs/database/prisma/schema.prisma` (tenant RLS default,
      composite FK to `users` mirroring `AiConversation`'s `"AiConversationOwner"` pattern,
      `@@unique([tenantId, userId, periodStart])`, index on `(tenantId, periodStart)`) and add
      `cachedPromptTokens Int? @map("cached_prompt_tokens")` to `AiMessage`; add the back-relations
      to `Tenant`/`User`. Verify `pnpm db:generate` succeeds.
- [x] 1.2 Write the migration (`cd libs/database && pnpm exec prisma migrate dev --name
      ai_usage_counters`), then hand-edit it to add the `ENABLE/FORCE ROW LEVEL SECURITY` +
      `tenant_isolation` policy for `ai_usage_counters`, following
      `libs/database/prisma/migrations/20260920125729_ai_assistant_conversations/migration.sql`
      exactly. Verify `pnpm db:migrate:dev` (or `db:reset` in the workspace slot) applies cleanly.
- [x] 1.3 Add a migration-level RLS test (or extend an existing cross-tenant RLS test file under
      `apps/api/test`) proving a tenant context cannot read or write another tenant's
      `ai_usage_counters` rows. Verify the test fails against a build without the policy (sanity
      check by temporarily commenting out `FORCE ROW LEVEL SECURITY`, then restore it) and passes
      with it.

## 2. Shared quota service and config

- [x] 2.1 Add `AI_QUOTA_USER_DAILY_TOKENS` (default `1_000_000`) and
      `AI_QUOTA_TENANT_DAILY_TOKENS` (default `10_000_000`) to `AiEnvSchema`/`AiConfig`/
      `loadAiConfig()` in `libs/shared/src/ai/ai.config.ts`, documented like the neighboring
      fields. Verify `ai.config.test.ts` covers the default and an overridden value.
- [x] 2.2 Create `libs/shared/src/ai/ai-usage-quota.service.ts` (`AiUsageQuotaService`) with
      `checkQuota(tx, tenantId, userId, now)` (per-user `findUnique` + tenant `aggregate({
      _sum })` against `periodStart = startOfUtcDay(now)`, returns which scope is at/over its
      limit or `null`) and `deduct(tx, tenantId, userId, now, usage)` (atomic `upsert` with
      `increment`, total = `promptTokens + completionTokens`, `cachedPromptTokens` stored
      separately and never added to the total). Register and export it from `AiModule`
      (`libs/shared/src/ai/ai.module.ts`) alongside `AiMessageStateService`. Verify unit tests
      cover: under both limits → `null`; at/over user limit → `{ scope: 'user' }`; under user
      limit but tenant aggregate at/over its limit → `{ scope: 'tenant' }`; `deduct` on a fresh
      period creates the row, on an existing period increments it; two concurrent `deduct` calls
      for the same key (real Postgres, workspace slot) both land, sum is exact, neither lost.
- [x] 2.3 Export `AI_QUOTA_EXCEEDED_CODE = 'ai_quota_exceeded'` as a plain string constant from
      `libs/contracts/src/ai/ai.schema.ts` (or a neighboring file in `libs/contracts/src/ai/`) so
      backend and frontend share one literal. Verify it is imported (not re-typed) at both call
      sites added in tasks 3.1 and 5.1.

## 3. API: pre-publish check

- [x] 3.1 In `AiService.ask()` (`apps/api/src/ai/ai.service.ts`), call
      `AiUsageQuotaService.checkQuota()` as the first statement inside the existing
      `withTenantTx`, before the conversation-row lock; on a non-null result throw
      `BadRequestException({ message, fieldErrors: [{ field: 'text', message, code:
      AI_QUOTA_EXCEEDED_CODE }] })` (design.md D3). Verify an e2e in `apps/api/test/ai.e2e-spec.ts`
      (pg-boss mocked, matching that file's existing pattern): pre-seed an
      `ai_usage_counters` row at/over the user limit via `SystemPrismaService` → `POST
      /api/ai/conversation/messages` returns `400` with `fieldErrors[0].code ===
      'ai_quota_exceeded'`, and neither a question nor a reply row was created, and no job was
      published (`sentJobs`).
- [x] 3.2 Add the equivalent e2e case for the tenant-aggregate limit (seed several other users'
      counter rows in the same tenant/period summing at/over the tenant limit, this user's own
      row still under their personal limit) and verify the same rejection shape.
- [x] 3.3 Add an e2e case proving usage under both limits is accepted and behaves exactly as
      before this change (reuses the existing "ask" happy-path assertions).

## 4. Worker: cached tokens + deduction

- [x] 4.1 Extend `LlmUsage`-to-`ai_messages` write in `AiMessageStateService.finalize()`
      (`libs/shared/src/ai/ai-message-state.service.ts`) to also write `cachedPromptTokens` when
      `usage.cachedPromptTokens` is reported (same conditional block as `promptTokens`/
      `completionTokens`), and to call `AiUsageQuotaService.deduct()` with the reply's `tenantId`/
      `userId`/`usage` right after the `updateMany` reports `count > 0` and `usage` is non-null —
      within the same transaction. Verify `ai-generate-reply.subscriber.test.ts`'s existing
      usage-related cases still pass unmodified, plus a new case: a completed reply with
      `cachedPromptTokens` in the fake usage persists that column, and the counters row for that
      user/period reflects prompt+completion (not prompt+cached+completion).
- [x] 4.2 Verify (new test) a `FAILED` reply after exhausting `AI_PROVIDER_RETRIES` (no usage
      frame ever received) leaves the counters row untouched — matches design.md D6.
- [x] 4.3 Verify (new test) a `CANCELLED` reply with no usage leaves the counters row untouched;
      confirm this still matches the existing "zupynena vidpovid without usage" expectations
      already covered for `ai_messages` itself.
- [x] 4.4 Verify (new test, real Postgres via the workspace slot, not mocked) two concurrent
      deliveries finalizing two different completed replies for the *same* user in the same
      period each add their tokens exactly once — run both `handle()` calls concurrently
      (`Promise.all`) with distinct `messageId`s and assert the final counter row equals the sum
      of both, not one overwriting the other.
      **Adapted:** implemented as `apps/api/test/ai-usage-quota.e2e-spec.ts`, calling
      `AiUsageQuotaService.deduct()` directly (real Postgres, real concurrent transactions) rather
      than through the full worker pipeline — `apps/worker` has no real-Postgres e2e harness
      (`ai-generate-reply.subscriber.test.ts` is fully in-memory) and building one was out of
      scope. This test caught and drove the fix for a real bug: Prisma's `upsert()` on a
      composite unique key is NOT atomic under true concurrency (SELECT-then-write race → a
      spurious P2002 on the second caller) — `AiUsageQuotaService.deduct()` now uses a raw
      `INSERT ... ON CONFLICT DO UPDATE` instead (see the service's doc comment).

## 5. Frontend: distinct quota-exceeded state

- [x] 5.1 In `apps/web/src/components/ai/ai-panel.tsx`, add an `onError` to `ask.mutate` that
      parses the error (`parseApiError`/existing helpers in `libs/ui/src/api/api-error.ts`),
      checks for `fieldErrors` carrying `AI_QUOTA_EXCEEDED_CODE`, and sets local state the panel
      renders as its own inline notice (composer disabled, distinct copy) instead of falling
      through to the global toast. Add the copy to `libs/i18n`'s `ai` namespace.
- [ ] 5.2 **Not done — left for the coordinator/reviewer.** Attempted a live browser check via
      the workspace slot's dev stack; blocked by a missing root `.env` (`ENCRYPTION_KEY` and
      other required vars are absent — only `.env.local` exists, which `ws:init` generates for
      ports/slot secrets, not the base `.env.example`-derived file). This gap predates this
      change and is environment setup, not something ai-1d should fix as a side effect. No
      React Testing Library / component-test infra exists in `apps/web` yet (`pnpm web:test` is
      Vitest-only, currently calendar logic) — adding one from scratch for a single check was
      judged out of proportion for this task. The wiring itself (`onError` → `parseApiError` →
      match `AI_QUOTA_EXCEEDED_CODE` in `fieldErrors` → `quotaExceeded` state → banner + disabled
      composer) type-checks cleanly and directly mirrors the exact envelope shape the backend
      e2e tests (`ai.e2e-spec.ts` "usage quotas") prove the server sends, but it has not been
      visually confirmed in a browser. Flagging rather than claiming success per CLAUDE.md.

## 6. OpenSpec + docs

- [x] 6.1 Verify `openspec validate ai-1d-usage-quotas --strict` passes.
- [x] 6.2 Update `docs/ai-assistant.md` §10.1's `AI-1d` row/subsection to reflect what shipped
      (mirror how `ai-1a`/`ai-1c` rows were updated when archived) — do not archive the change
      itself; that is the coordinator's step.

## 7. Full verification

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm build` all pass.
- [x] 7.2 `pnpm api:test:e2e` and the worker subscriber test suite pass in the workspace slot
      (not against slot 0, and not alongside a live dev stack per `CLAUDE.md`).
- [x] 7.3 `pnpm web:test` passes (134/134; task 5.2 added no new Vitest test — see its note).
