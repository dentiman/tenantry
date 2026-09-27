# Tasks

Step **AI-1b** of `docs/ai-assistant.md` §10.1. No test touches the network or needs a key;
`FakeLlmProvider` stays the default.

Root gate at the end: `pnpm lint && pnpm typecheck && pnpm build`.
Unit tests: `pnpm --filter @saas-skeleton/shared test`, `pnpm --filter @saas-skeleton/worker test`,
`pnpm web:test`. Tenant e2e: `pnpm api:test:e2e` on this workspace's own slot (`pnpm ws:init`).

## 1. Corpus builder and generator

- [x] 1.1 `libs/shared/src/ai/knowledge/corpus-builder.ts` per design D1–D4: front-matter
      parser, validation (slug/title/audience/area, unique slug, non-empty body), canonical
      version (SHA-256, 16 hex), `totalChars`, `AI_KNOWLEDGE_CHAR_BUDGET = 100_000`,
      deterministic serialisation; Node built-ins only, erasable TS only. Verify with
      `corpus-builder.test.ts` (cases in D9) under `pnpm --filter @saas-skeleton/shared test`.
- [x] 1.2 `scripts/ai-knowledge.ts` (write / `--check`), root scripts `ai:knowledge` and
      `ai:knowledge:check` run with plain `node`; the root `lint` script runs the check first
      (design D4), so `pnpm lint` fails on a stale artifact; `scripts/tsconfig.json`
      `allowImportingTsExtensions`; artifact path in `.prettierignore`. Verify
      `pnpm ai:knowledge && pnpm ai:knowledge:check` exits 0 and a second `pnpm ai:knowledge`
      leaves `git status` clean.

## 2. Knowledge corpus

- [x] 2.1 Write the 13 files of `docs/ai-knowledge/` (§7.2, design D10), each with valid
      front-matter; content verified against `apps/web` / `apps/api` / `libs/contracts` /
      `libs/i18n` — no feature that does not exist. `04-users-and-roles` and
      `08-settings-organization` are `audience: admin`. Verify `pnpm ai:knowledge` succeeds and
      reports total ≤ 100 000 characters.
- [x] 2.2 Commit-ready artifact generated; demonstrate the check failing (a) after editing a
      doc without regenerating and (b) with the budget exceeded (temporarily padded doc), then
      restore. Verify by the recorded exit codes / messages.

- [x] 2.3 Label accuracy (design D10): a Vitest case parses `10-troubleshooting.md` and asserts
      every `ApiError.code` of the contract enum is listed with exactly the English message
      rendered by the frontend (i18n resource); all other quoted labels cross-checked manually
      against `libs/i18n` / components, with the source list recorded in
      `docs/ai-assistant-implementation.md`. Verify the test passes and fails on a changed
      message.

## 3. Knowledge source

- [x] 3.1 `KnowledgeSource`, `KnowledgeQuery`, `KnowledgeSelection`, `KNOWLEDGE_SOURCE` token,
      `StaticKnowledgeSource` over the bundled artifact (shape validated at construction,
      audience filter by role), `AiKnowledgeModule`; export from `libs/shared/src/ai/index.ts`
      (design D6). Verify with `static-knowledge-source.test.ts` (D9).
- [x] 3.2 `prompt-builder.test.ts`: order instruction → knowledge → user context → history →
      question asserted. Verify `pnpm --filter @saas-skeleton/shared test`.

## 4. Knowledge version on the reply

- [x] 4.1 Prisma `AiMessage.knowledgeVersion String? @map("knowledge_version")` + migration via
      `cd libs/database && pnpm exec prisma migrate dev --name ai_message_knowledge_version`
      on this slot; `pnpm db:generate`. Verify the migration's only structural change is one nullable
      `ADD COLUMN` (the rest is Prisma's recurring idempotent `tenant_id SET DEFAULT`
      re-assertion, identical to the previous migrations).
- [x] 4.2 `AiMessageStateService.claim()` accepts `knowledgeVersion` and writes it in the same
      conditional update (design D7); `restart()`/`finalize()` untouched. Verify with the
      tenant e2e `ai-state.e2e-spec.ts` case that a claimed row carries the version.
- [x] 4.3 Worker: inject `KNOWLEDGE_SOURCE`; `prepare()` selects knowledge by the user's role
      before `claim()`, passes documents to `buildPrompt` and the version to `claim()`;
      `WorkerModule` imports `AiKnowledgeModule`. Verify with subscriber tests: USER prompt has
      no admin doc, ADMIN prompt has it, stored `knowledgeVersion` equals the source's, a
      `__fail_once__` restart keeps it; all existing subscriber tests green.

## 5. CI

- [x] 5.1 `.gitlab-ci.yml`: `check` stage before `build`, job `ai_knowledge_check` running the
      check in `node:24-bookworm-slim` with a read-only bind mount (design D5). Verify the YAML
      parses (`node -e` / `python3 -c 'import yaml'`) and the exact job command succeeds
      locally via `docker run`.

## 6. Docs

- [x] 6.1 `docs/ai-assistant-implementation.md`: code map, data model (`knowledgeVersion`),
      prompt composition, knowledge section (artifact, version, budget, audience, how to edit
      the corpus, reproducing a prompt), config/tests tables, §13 status. Verify by reading.
- [x] 6.2 `docs/ai-assistant.md` §0/§10/§10.1 AI-1b status, §11.6 closed; `docs/roadmap.md`;
      `docs/commands.md` (`ai:knowledge`, `ai:knowledge:check`); `CLAUDE.md` commands and doc
      map. Verify by reading.

## 7. Verification

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm build` green.
- [x] 7.2 `pnpm --filter @saas-skeleton/shared test`, `pnpm --filter @saas-skeleton/worker test`,
      `pnpm web:test` green; `pnpm ai:knowledge:check` green.
- [x] 7.3 `pnpm api:test:e2e` green on this workspace's own slot; then `pnpm ws:down`.
- [x] 7.4 `openspec validate ai-1b-knowledge-corpus --strict` valid.
