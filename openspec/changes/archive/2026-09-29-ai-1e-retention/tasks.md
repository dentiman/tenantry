# Tasks

## 1. Config

- [x] 1.1 Add `AI_RETENTION_DAYS` (default 90) to `libs/shared/src/ai/ai.config.ts`
  (`AiEnvSchema`, `AiConfig`, `loadAiConfig()`) and verify `ai.config.test.ts` covers the
  default and an overridden value
- [x] 1.2 Document `AI_RETENTION_DAYS` in `.env.example` next to the other `AI_*` vars

## 2. Generation-pipeline fix (retired-conversation early cancel)

- [x] 2.1 Add `AiMessageStateService.cancelRetired(tx, messageId)` per design.md D1 and verify
  a unit/behavioral test (or the existing e2e-real-Postgres style used for the other
  transitions) shows it cancels a claimable `PENDING`/abandoned-`STREAMING` row and is a no-op
  on a terminal row
- [x] 2.2 Add the early-cancel check to `AiGenerateReplySubscriber.prepare()` (design.md D1):
  right after the existing `reply` read, before `claim()` and before history/knowledge
  lookups, and verify a unit test in `ai-generate-reply.subscriber.test.ts` proves the reply
  ends `CANCELLED` and the `LlmProvider.generate()` spy is never called
- [x] 2.3 Verify a reply for a still-`ACTIVE` conversation is unaffected — existing tests in
  `ai-generate-reply.subscriber.test.ts` already cover this path; confirm none regress

## 3. Purge cron

- [x] 3.1 Add `purgeAiConversationsCommand` (`ai.purge-conversations`, `scope: 'system'`) to
  `libs/shared/src/messaging/definitions/ai.messages.ts`
- [x] 3.2 Add the topology entry (consumer `ai-conversation-purger`, `retryLimit: 1`, `cron:
  '45 3 * * *'`) in `libs/shared/src/messaging/topology.ts` and verify the topology
  self-checks (duplicate/queue-name asserts) still pass at import time
- [x] 3.3 Implement `apps/worker/src/subscribers/ai-purge-conversations.subscriber.ts` per
  design.md D2/D3 (`lastMessageAt ?? createdAt` cutoff, single `deleteMany`, cascade removes
  messages, logs the removed count) and register it in `apps/worker/src/worker.module.ts`
- [x] 3.4 Add a real-Postgres e2e spec (pattern: `apps/api/test/ai-state.e2e-spec.ts` —
  `AppModule`, `SystemPrismaService`, construct the subscriber directly since it only needs
  that one dependency) proving: a conversation past the retention window is purged with its
  messages; a recently active one is not; conversations in a second tenant are purged too
  (system-scope, not an RLS bypass bug)

## 4. Delete-my-conversations

- [x] 4.1 Add `'deleted'` to `AiConversationChangedSchema`'s `reason` enum in
  `libs/contracts/src/realtime/realtime.schema.ts`
- [x] 4.2 Add `AiService.deleteAllConversations(actor)` (design.md D5:
  `tenantTx` + `userId: actor.sub` filter, emits `ai.conversation-changed.v1` with reason
  `'deleted'` on commit) in `apps/api/src/ai/ai.service.ts`
- [x] 4.3 Add `DELETE /ai/conversations` (204, no body) to `apps/api/src/ai/ai.controller.ts`
- [x] 4.4 Run `pnpm openapi:generate && pnpm web:codegen` and commit the regenerated
  OpenAPI/orval artifacts
- [x] 4.5 e2e in `apps/api/test/ai.e2e-spec.ts`: deleting removes the caller's conversations
  and messages; a second call (or a call with nothing to delete) is a harmless no-op; verify
  the RLS/ownership acceptance criterion explicitly — seed a second user in the same tenant
  and a user in a second tenant, call delete as the first user, assert both others' rows are
  untouched

## 5. UI

- [x] 5.1 Add a "delete my conversations" icon button to `AiPanel`'s header
  (`apps/web/src/components/ai/ai-panel.tsx`), confirmed via `AlertDialog` copied from
  `user-settings/security.tsx`'s "sign out of all devices" pattern
- [x] 5.2 Add the new i18n keys to `apps/web/src/locales/en/ai.json`
- [x] 5.3 Manually verify in the browser (dev stack, `FakeLlmProvider`): ask a question, delete
  all conversations, confirm the panel returns to its empty state and a new question starts a
  fresh conversation

## 6. Verification

- [x] 6.1 `openspec validate ai-1e-retention --strict` passes
- [x] 6.2 `pnpm lint && pnpm typecheck && pnpm build` all pass
- [x] 6.3 `pnpm api:test:e2e` passes (includes the new retention/delete-all/RLS specs)
- [x] 6.4 `apps/worker` unit tests (`pnpm --filter @saas-skeleton/worker test` or the repo's
  worker test command) pass, including the new early-cancel test
