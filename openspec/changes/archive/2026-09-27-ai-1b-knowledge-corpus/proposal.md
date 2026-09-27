# Proposal

## Why

After AI-1a the assistant can talk to a real model, but it knows nothing about the product: the
prompt builder's `knowledge` argument is always empty, so most questions end in "the
documentation does not cover this". This is step **AI-1b** of `docs/ai-assistant.md` §10.1 —
the second half of the "working version" (`ai-1a` + `ai-1b`) — and it also closes the AI-0
design gap of §7.4 (no `KnowledgeSource` seam) and open question §11.6 (how to reproduce the
prompt of a past reply without storing it).

## What Changes

- **A level-1 knowledge corpus.** `docs/ai-knowledge/` gets thirteen end-user documents
  (`00-getting-started` … `12-assistant-policy`, §7.2), each with front-matter `slug`, `title`,
  `audience` (`all` | `admin`) and `area`. They describe the tenant product as it is today
  (navigation, customers, calendar, users and roles, account security, notifications, files,
  organization settings, user settings, troubleshooting by error code, glossary, the
  assistant's own limits) — written for a CRM user, not a developer, and only for features
  that exist.
- **A generated, committed artifact.** `pnpm ai:knowledge` turns the folder into one JSON
  artifact inside `libs/shared`, carrying a content hash that is the **knowledge version**.
  The runtime never reads Markdown from disk (same pattern as `openapi.json`/orval).
- **A check, locally and in CI.** `pnpm ai:knowledge:check` fails when the artifact is stale
  against the folder, when a document's front-matter is invalid, or when the corpus exceeds
  the level-1 budget of **100 000 characters** (§10.1: characters, not tokens — exact token
  counting is deferred and no tokenizer dependency is added). `.gitlab-ci.yml` runs it before
  any image is built.
- **A `KnowledgeSource` seam.** The worker obtains the knowledge for a reply through a
  knowledge-source interface; the first implementation serves the static artifact and
  withholds `audience: admin` documents from non-administrators. Level 2 (AI-2) and
  retrieval (AI-4) become new implementations, not edits to the subscriber. The prompt order
  stays instruction → knowledge → user context → history → question (§7.4, prefix caching).
- **Reproducible prompts (§11.6 closed).** `ai_messages.knowledge_version` (nullable, additive
  migration) records the knowledge version each reply was generated with, written by the
  worker when it claims the reply, inside the existing attempt-fenced transition. The full
  prompt is still not stored.

Out of scope: the persona / instruction as tenant data and `/settings/ai` (`ai-1c` — the
hard-coded system instruction stays), quotas (`ai-1d`), retention (`ai-1e`), level-2
knowledge and retrieval (AI-2, AI-4), exact token counting. The delta protocol, the AI-0.1
ownership lifecycle, AI-1a's provider and error mapping, the API surface and the panel do not
change.

## Capabilities

### New Capabilities

- `ai-assistant/knowledge`: what product documentation the assistant answers from — its
  audience filtering by role, its versioning and the record of which version answered a reply,
  the size budget and the guarantee that the shipped knowledge matches its source.

### Modified Capabilities

None. The existing `ai-assistant/generation-pipeline` requirement on conversation context
(history then the question, exactly once) still holds as written; knowledge is additional,
static context placed before it and is specified in the new capability.

## Impact

- **Content:** new `docs/ai-knowledge/*.md` (13 files).
- **Shared (`libs/shared/src/ai/knowledge/`):** corpus builder (parse, validate, hash, budget —
  pure, Node built-ins only), generated artifact `generated/knowledge-corpus.json`,
  `KnowledgeSource` interface, `StaticKnowledgeSource`, an `AiKnowledgeModule` for the worker.
- **Scripts / tooling:** `scripts/ai-knowledge.ts`, root `package.json` scripts
  `ai:knowledge` and `ai:knowledge:check`, `.prettierignore` entry for the artifact, a
  `check` stage in `.gitlab-ci.yml`.
- **Worker:** `ai-generate-reply.subscriber.ts` `prepare()` asks the knowledge source and
  passes the version to `claim()`; `worker.module.ts` imports `AiKnowledgeModule`.
- **State service:** `AiMessageStateService.claim()` writes `knowledgeVersion`.
- **Database:** additive nullable column `ai_messages.knowledge_version`.
- **Contracts / OpenAPI / web:** none — the version is internal and not exposed.
- **Docs:** `docs/ai-assistant-implementation.md`, `docs/ai-assistant.md` §10/§10.1/§11.6,
  `docs/roadmap.md`, `docs/commands.md`, `CLAUDE.md` (commands).
