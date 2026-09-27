# Tasks

Step **AI-1c** of `docs/ai-assistant.md` §10.1. No test touches the network or needs a key;
`FakeLlmProvider` stays the default.

Root gate at the end: `pnpm lint && pnpm typecheck && pnpm build`.
Unit tests: `pnpm --filter @saas-skeleton/shared test`, `pnpm --filter @saas-skeleton/worker test`,
`pnpm web:test`. Tenant e2e: `pnpm api:test:e2e` on this workspace's own slot (`pnpm ws:init`).

## 1. Contract

- [x] 1.1 `libs/contracts/src/settings/`: `AI_SETTINGS_LIMITS`, `AiSettingsSchema`
      (trim → max, design D1), `AI_SETTINGS_DEFAULTS`, `AiSettings` type, exports. Verify with
      `pnpm --filter @saas-skeleton/contracts typecheck` (or root typecheck).

## 2. Prompt builder

- [x] 2.1 `libs/shared/src/ai/prompt/organization-instructions.ts`: `readAiSettings()` (D5) and
      the fenced, sanitised organization block (D3); export from the shared index. Verify with
      a new `organization-instructions.test.ts` (missing key, valid, over-limit, wrong type,
      non-object, fence tags stripped).
- [x] 2.2 `prompt-builder.ts`: export `ASSISTANT_BOUNDARIES` (unchanged text, D2), optional
      `organization` input, insert the block after the boundaries (D4). Verify with
      `prompt-builder.test.ts`: byte-identical prompt for absent/empty/whitespace settings,
      boundaries always message 0 even with "ignore previous instructions" text, full
      six-part order, allowlist test still green.

## 3. Worker

- [x] 3.1 `ai-generate-reply.subscriber.ts` `prepare()`: read `tenant.settings` by the reply's
      tenant inside the existing transaction, `readAiSettings`, warn (no text) on invalid,
      pass `organization` to `buildPrompt` (D6). Verify with new cases in
      `ai-generate-reply.subscriber.test.ts` (persona reaches message 1 and knowledge moves to
      index 2; no settings → unchanged; malformed → boundaries only, COMPLETE) and
      `pnpm --filter @saas-skeleton/worker test`.

## 4. API

- [x] 4.1 `SettingsService.ai()` / `updateAi()` (read-modify-write, activity
      `{ section: 'ai' }` without text), DTOs, `GET`/`PUT /settings/ai`, both `@Roles(ADMIN)`. Verify with e2e cases in `apps/api/test/settings.e2e-spec.ts`: defaults empty, ADMIN
      round-trip with trim + activity, USER GET and PUT → 403, over-limit → 400 with the field in
      `fieldErrors`.
- [x] 4.2 `pnpm openapi:generate && pnpm web:codegen`; verify the new operations appear in
      `apps/api/openapi.json` and `apps/web/src/api/generated/api.ts`.

## 5. Web

- [x] 5.1 `apps/web/src/pages/settings/ai.tsx` (D7), route `/settings/ai` under the
      ADMIN-guarded settings route, `paths.ts`, sidebar item, `settings.json` keys including
      the provider notice. Verify with `pnpm --filter web typecheck`/`build` and a manual check
      on this slot: save, reload, over-limit error shown on the field, USER cannot open.

## 6. Docs and knowledge corpus

- [x] 6.1 `docs/ai-assistant-implementation.md` (prompt structure, where the persona lives,
      boundary guarantee), `docs/ai-assistant.md` §7.3 done + §10/§10.1 status,
      `docs/roadmap.md`, `docs/settings.md` (new `ai` section). Verify by reading the diffs.
- [x] 6.2 `docs/ai-knowledge/08-settings-organization.md` (new "AI assistant" section, labels
      copied from the English locale) and `12-assistant-policy.md` (organization instructions
      exist but cannot change its limits); `pnpm ai:knowledge`. Verify with
      `pnpm ai:knowledge:check`.

## 7. Gate

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm build`, unit suites, `pnpm api:test:e2e` on the
      own slot green (re-run known cross-file flakes and report them); `openspec validate
      ai-1c-assistant-settings --strict`; `pnpm ws:down`.
