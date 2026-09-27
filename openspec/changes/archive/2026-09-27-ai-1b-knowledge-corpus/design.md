# Design

## Context

See `proposal.md` — Why. The seams this change plugs into, as they are today:

- `buildPrompt({ question, history, knowledge, user })` (`libs/shared/src/ai/prompt/
  prompt-builder.ts`) already renders a non-empty `knowledge: AiKnowledgeDocument[]` as one
  system message after the instruction and before the user context; the worker always passes
  `[]`. `AiUserContext = { role, locale }` is the closed allowlist of §9.1.
- `AiGenerateReplySubscriber.prepare()` reads the question, history and the user's
  `role`/`locale` in one short `withTenantTx`, then calls `AiMessageStateService.claim()` as
  the last step; `claim()` is one conditional `updateMany` that bumps `attempt`, sets the
  lease and writes `model` from config. `restart()` re-uses the same prompt. `finalize()` is
  the only final write.
- `Dockerfile.node` copies only `dist` into the runtime image; the worker is a webpack bundle
  that resolves `libs/shared` through aliases and bundles JSON natively.
- `.gitlab-ci.yml` has only build and deploy stages, on a **shell executor** runner (`image:`
  is ignored; the host has Docker, not necessarily Node). There is no lint/test job in CI.
- ESLint ignores `**/generated/`; lint-staged runs Prettier on staged `*.json`.
- Node ≥ 24 (engines) runs `.ts` files directly with type stripping (verified with 24.6).

## Goals / Non-Goals

**Goals:**
- The check runs with **zero installed dependencies** — just Node — so CI can run it in a
  stock `node:24` container without `pnpm install`.
- One deterministic version string per corpus content; regenerate-and-diff proves staleness.
- The knowledge seam is an interface the worker depends on, so AI-2/AI-4 swap implementations.
- Everything testable with no network, no key, no database for the unit tier.

**Non-Goals:**
- Token counting, tokenizer dependencies, per-vendor accounting (deferred, §10.1).
- Chunking, retrieval, FTS, a `AiKnowledgeChunk` table (AI-4).
- Exposing the version through the API or the panel.
- Moving `SYSTEM_INSTRUCTION` (ai-1c) — only its wording about "documentation below" is
  already correct and stays.

## Decisions

### D1. Artifact: one JSON file in `libs/shared/src/ai/knowledge/generated/`

`knowledge-corpus.json`:

```json
{
  "version": "<16 hex chars>",
  "totalChars": 81234,
  "documents": [
    { "slug": "getting-started", "title": "…", "audience": "all", "area": "general", "body": "…" }
  ]
}
```

Documents are ordered by file name (`00-…` … `12-…`), so the rendered prefix is stable across
regenerations. No timestamp, no absolute path — the file is a pure function of the folder.
Written as `JSON.stringify(corpus, null, 2) + '\n'`.

JSON rather than a generated `.ts` module: it is what the artifact *is* (like `openapi.json`),
the TS side imports it with `resolveJsonModule` (already on in `tsconfig.base.json`), webpack and
Vitest load it natively. It sits under `generated/` (ESLint ignores it) and is added to
`.prettierignore`, so lint-staged cannot reformat it and make the byte-for-byte check lie. The
source folder `docs/ai-knowledge/` is Prettier-ignored too (found during implementation):
Prettier pads Markdown tables with alignment spaces, which added ~8 % characters that would go
into every prompt and the budget; the corpus keeps compact tables.

*Alternatives:* a `.ts` module (`export const CORPUS = …`) — needs the same Prettier/ESLint
exclusions and gains nothing; reading `docs/ai-knowledge/*.md` at runtime — rejected by §7.2
(runtime image has only `dist`, an extra `COPY` is one more coordinated edit to forget).

### D2. Version = first 16 hex chars of SHA-256 over the canonical document list

`sha256(JSON.stringify(documents))` where each document is `{slug, title, audience, area,
body}` in that key order and bodies are normalised (CRLF → LF, trailing whitespace of the file
trimmed, one final newline removed). Hashing the *parsed* documents, not the raw files, means a
cosmetic change the prompt never sees (front-matter key order) does not bump the version,
while any byte that reaches the model does. 16 hex chars (64 bits) is ample to identify a corpus
among the few hundred it will ever have and stays readable in logs and SQL.

Reproducing a past prompt (§11.6): `git log -S '"version": "<v>"' -- libs/shared/src/ai/
knowledge/generated/knowledge-corpus.json` finds the commit; the instruction is in code at that
commit; history and question are the stored rows. **Known limit:** the user's `role`/`locale`
at generation time are not stored on the reply — the audience filter is a function of the role,
so "which documents" is recoverable given the role, which for the normal case is the user's
current role. Recording role per reply is out of scope; if incident analysis needs it, it is a
second additive column, not a change to the version.

### D3. Budget in characters, counted on what reaches the prompt

`totalChars = Σ (title.length + body.length)` over all documents (the ADMIN view is the
maximum), budget `AI_KNOWLEDGE_CHAR_BUDGET = 100_000` exported from the corpus builder.
Front-matter is not counted — it never reaches the model except `slug`/`title`, and `slug` is
tiny. The generator refuses to write an over-budget artifact; the check fails with
`size / budget`. No tokenizer (§10.1).

### D4. Generator and check: `scripts/ai-knowledge.ts` over a pure builder

- `libs/shared/src/ai/knowledge/corpus-builder.ts` — pure functions, **Node built-ins only**
  (`node:crypto`), erasable TypeScript only, no relative imports: `parseKnowledgeFile(name,
  text)` (minimal `key: value` front-matter parser between `---` fences, strict key set,
  `audience ∈ {all, admin}`, slug kebab-case and unique, non-empty title/area/body),
  `buildKnowledgeCorpus(files)`, `serializeKnowledgeCorpus(corpus)`. Errors name the file and
  the field. Unit-tested with Vitest in `libs/shared`.
- `scripts/ai-knowledge.ts` — the only file doing I/O: reads `docs/ai-knowledge/*.md`, builds,
  and either writes the artifact (`pnpm ai:knowledge`) or, with `--check`, compares the
  serialised result byte-for-byte to the committed file and exits 1 on any difference or
  error (`pnpm ai:knowledge:check`). It imports the builder with an explicit `.ts` extension,
  so both `node scripts/ai-knowledge.ts` and `tsx` run it; `scripts/tsconfig.json` gains
  `allowImportingTsExtensions` (it is already `noEmit`).

The root `lint` script runs the check first (`node scripts/ai-knowledge.ts --check && eslint …`):
it is dependency-free and takes milliseconds, so the documented local gate
`pnpm lint && pnpm typecheck && pnpm build` catches a forgotten `pnpm ai:knowledge` before CI
does. The standalone `pnpm ai:knowledge:check` and the CI job stay.

Root scripts run it with plain `node`, not `tsx`: the same command works in CI without
`pnpm install`. A YAML library is not used — front-matter here is four flat keys, and a
dependency would break the zero-install property.

### D5. CI: a `check` stage before `build`, in a stock Node container

```yaml
ai_knowledge_check:
  stage: check
  tags: [deploy_dev]
  rules: [{ if: $CI_COMMIT_BRANCH }]
  script:
    - docker run --rm -v "$CI_PROJECT_DIR:/repo:ro" -w /repo node:24-bookworm-slim
        node scripts/ai-knowledge.ts --check
```

The runner is a shell executor with a local Docker daemon, so a bind mount of the checkout
works, and `node:24-bookworm-slim` is the base `Dockerfile.node` already pulls. Being a stage
before `build`, a stale or over-budget corpus stops the pipeline before any image is built or
deployed. Read-only mount: the check cannot "fix" anything by writing.

*Alternative:* `image: node:24` on the job — ignored by a shell executor.

### D6. `KnowledgeSource` + `StaticKnowledgeSource`

```ts
interface KnowledgeQuery { readonly role: AiUserContext['role']; readonly question: string }
interface KnowledgeSelection {
  readonly version: string;
  readonly documents: readonly AiKnowledgeDocument[];
}
interface KnowledgeSource { select(query: KnowledgeQuery): Promise<KnowledgeSelection> }
const KNOWLEDGE_SOURCE = Symbol('KNOWLEDGE_SOURCE');
```

- Async and given the question although the static source ignores it: FTS (AI-4) needs the
  question, level 2 (AI-2) needs the database. The query takes only `role` and the question —
  no tenant id (level 2 will read tenant context from CLS/RLS like any domain code, §2), no
  user identity, so §9.1's allowlist is not widened.
- `StaticKnowledgeSource(corpus = bundled artifact)`: validates the artifact shape once at
  construction (fail fast at worker boot, not per reply), `ADMIN` → all documents, anything
  else → only `audience: 'all'`; the returned order is the artifact order; `version` is the
  artifact's version for both roles.
- `AiKnowledgeModule` (libs/shared) provides `KNOWLEDGE_SOURCE`; only `WorkerModule` imports it
  — the API never builds prompts, same reasoning as `AiLlmModule` (ai-1a D5).
- `AiKnowledgeDocument` keeps `{slug, title, body}` (what the builder renders); `audience` and
  `area` stay in the artifact for filtering and future retrieval, not in the prompt.

### D7. `knowledgeVersion` written by `claim()`

`prepare()` calls `knowledgeSource.select({ role, question })` inside its transaction, after the
question/history reads and **before** `claim()`, then passes `knowledgeVersion` to `claim()`
alongside `model`. `claim()` writes it in the same conditional `updateMany` that bumps `attempt`
— so the version belongs to exactly the attempt that owns the row, like `model`. `restart()`
re-uses the same prompt, so it neither needs nor touches the version; `finalize()` is unchanged.
A re-claimed abandoned reply is re-prepared from scratch and overwrites the version with what
that attempt actually sent.

Schema: `knowledgeVersion String? @map("knowledge_version")` on `AiMessage`, additive nullable
migration (`cd libs/database && pnpm exec prisma migrate dev --name ai_message_knowledge_version`).
Existing rows stay `NULL` = generated before AI-1b. User questions never get a version.

### D8. Prompt order and the fake

Unchanged builder order: instruction → knowledge → user context → history → question. The user
context comes after knowledge because it varies by role/locale while the corpus prefix is shared
(caching). `FakeLlmProvider` reads only the last user message, so a large knowledge message
changes nothing for its directives; its synthetic `usage` grows with the prompt, which is the
honest signal.

### D9. Tests

- `corpus-builder.test.ts`: parse valid file; each missing/invalid field named (incl. bad
  audience, duplicate slug, empty body); deterministic version; version changes on body change
  and not on front-matter key reorder; budget exceeded → error with numbers; serialisation
  stable.
- `static-knowledge-source.test.ts`: USER gets no admin docs, ADMIN gets all, order preserved,
  version identical for both; malformed artifact rejected at construction; the bundled
  artifact loads and is within budget and has no admin doc in the USER view.
- `prompt-builder.test.ts`: knowledge before user context before history before question.
- Worker subscriber tests: the prompt sent to the provider contains the knowledge message for
  the user's role (USER: no admin doc; ADMIN: admin doc present), and the stored reply's
  `knowledgeVersion` equals the source's version; a restarted attempt keeps it.
- Tenant e2e `ai-state.e2e-spec.ts`: `claim()` writes `knowledge_version` against real Postgres.
- Check script: demonstrated failing on a stale artifact and on an over-budget corpus (manual
  run recorded in tasks; the logic itself is covered by the builder tests).

### D10. The corpus

Thirteen files, English, second person, task-oriented ("To add a contact…"), exact UI labels in
quotes, and an explicit "not available" line where users commonly expect a feature that does
not exist (password recovery, self-registration, 2FA, bulk operations, recurring events…), so
the model can say "no" instead of inventing. `audience: admin` for `04-users-and-roles` and
`08-settings-organization`; the everyone-audience docs say "ask your administrator" where an
action is admin-only. `12-assistant-policy` restates the assistant's limits for the model
(no data access, no actions, answer from documentation, same language as the question).

**Label accuracy.** Every quoted UI label, menu path and error text is copied from the English
i18n resources (`libs/i18n`) or the rendering component, never paraphrased. For errors this is
enforced by a test: `10-troubleshooting.md` lists each `ApiError.code` with the exact English
message the frontend renders for it, and a Vitest case in `libs/shared` parses that document
and compares every code/message pair with the i18n resource (and that every code of the
contract enum is covered). The remaining labels are cross-checked manually against the sources
listed in the task, recorded in `docs/ai-assistant-implementation.md`.

## Risks / Trade-offs

- [Docs drift from the product as features change] → the corpus lives next to code and PRs
  touching a feature should touch its doc; the check guarantees only artifact ↔ source, not
  source ↔ product. Recorded in `docs/ai-assistant-implementation.md` as an authoring rule.
- [Character budget ≠ token budget] → 100 000 chars ≈ 25 000 tokens for English with margin;
  exact counting deferred by decision until the corpus approaches the limit or level 2 arrives.
- [Committed artifact duplicates the Markdown in the diff] → accepted, same as `openapi.json`;
  reviewers read the Markdown, CI proves the JSON.
- [Role not stored per reply] → see D2; additive later if needed.
- [Admin docs interleaved with everyone docs] → the USER and ADMIN prefixes diverge at the first
  admin doc; each role still has a stable prefix of its own, which is what caching needs.

## Migration Plan

Additive nullable column; deploy runs `prisma migrate deploy` in the api entrypoint as today.
Rollback: the old worker ignores the column. No data backfill.
