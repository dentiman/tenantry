## Why

FMS documentation is indexed in PostgreSQL (AI-2a.2), but the assistant still answers from
the static corpus. The pilot needs answers grounded in retrieved FMS excerpts, with sources the
user can open.

## What Changes

- `PostgresKnowledgeSource`: embeds the question, searches the published index of one configured
  product for the user's role, selects at most 5 excerpts / 2 500 tokens.
- `AI_KNOWLEDGE_BACKEND=static|postgres` (+ product and budget settings); postgres mode never
  mixes in the static SaaS Skeleton corpus.
- Worker: the question embedding happens outside any DB transaction; an embedding failure
  fails the reply explicitly instead of answering without sources.
- Prompt: retrieved excerpts as numbered, untrusted data after the organization instructions;
  an explicit "nothing found" block when retrieval is empty.
- `ai_messages.knowledge_chunks` records the excerpts actually given to the model.
- Contract: `citations` on assistant messages (only numbers the answer actually cites) and
  `GET /ai/conversation/messages/:id/citations/:n` that re-checks access before returning text.
- AiPanel: source list under the answer; a click opens the excerpt.

## Capabilities

### New Capabilities

- `ai-assistant/knowledge-citations`: retrieval-grounded answers with verified, re-authorized
  citations.

### Modified Capabilities

None.

## Impact

Migration on `ai_messages`; tenant OpenAPI + orval regeneration; worker and web changes.
Static mode (the default) keeps today's prompt byte-for-byte.
