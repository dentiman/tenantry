# Proposal

## Why

AI conversations and their messages currently live forever — there is no retention limit and
no way for a user to erase their own history. `docs/ai-assistant.md` §9.2 already fixes the
answer (`AI_RETENTION_DAYS = 90`, a system-scope cron purge, and an immediate self-service
delete), and §10.1 assigns it to this step, `ai-1e`. Separately, a live run of `ai-1a` found a
real defect in the generation pipeline: a reply queued just before its conversation was retired
("new conversation") gets generated anyway after nobody can ever see it, burning a paid model
call for nothing. Both belong to the same conversation lifecycle, so both ship together here.

## What Changes

- Add `AI_RETENTION_DAYS` (default 90) to the shared AI config.
- Add a system-scope cron command `ai.purge-conversations` (pattern: `files.cleanup-orphans`)
  that hard-deletes conversations (and, by cascade, their messages) whose last activity is
  older than the configured retention window. No soft-delete column — deletion is destructive
  by design, matching `docs/ai-assistant.md` §9.2.
- Add `DELETE /ai/conversations`: an immediate, synchronous hard delete of the calling user's
  own conversations (all of them, not just the active one), scoped by both RLS (tenant) and an
  explicit `userId` filter (person) — no queue involved.
- Add a "delete my conversations" affordance to the `AiPanel` header, confirmed the same way
  the existing "sign out all devices" action is (`AlertDialog`), not a new confirmation pattern.
- Fix a generation-pipeline defect: `claim()`/`prepare()` in `AiGenerateReplySubscriber` must
  recognize a reply that still belongs to a `RETIRED` conversation and close it as `CANCELLED`
  before ever building a prompt or calling the LLM provider.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ai-assistant/conversation`: adds retention (env-configured purge window, system cron) and a
  user-initiated "delete all my conversations" action, both hard deletes, both scoped so one
  user/tenant can never affect another's conversations.
- `ai-assistant/generation-pipeline`: adds the requirement that a reply belonging to a retired
  conversation is cancelled without consulting the model backend, instead of being generated
  and discarded.

## Impact

- `libs/shared/src/ai/ai.config.ts` — new `AI_RETENTION_DAYS` env var / `AiConfig` field.
- `libs/shared/src/ai/ai-message-state.service.ts` — new state transition for the early-cancel
  fix.
- `libs/shared/src/messaging/definitions/ai.messages.ts`, `libs/shared/src/messaging/topology.ts`
  — new `ai.purge-conversations` command + cron entry.
- `apps/worker/src/subscribers/` — new `ai-purge-conversations.subscriber.ts`;
  `ai-generate-reply.subscriber.ts` — early-cancel check in `prepare()`.
- `apps/worker/src/worker.module.ts` — register the new subscriber.
- `apps/api/src/ai/` — new `DELETE /ai/conversations` route, service method, no new contract
  types needed (204, no body).
- `libs/contracts/src/realtime/realtime.schema.ts` — new `AiConversationChanged.reason` value
  for the delete-all action.
- `apps/web/src/components/ai/ai-panel.tsx` + `apps/web/src/locales/en/ai.json` — delete-my-
  conversations affordance and confirm dialog.
- `.env.example` — document `AI_RETENTION_DAYS`.
- e2e: `apps/api/test/ai.e2e-spec.ts` (delete-all + cross-user/cross-tenant RLS),
  `apps/api/test/ai-state.e2e-spec.ts`-style new spec for the cron purge against real Postgres;
  worker unit test in `ai-generate-reply.subscriber.test.ts` for the early-cancel fix.
