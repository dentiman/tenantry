## Decisions

D1. Backend switch per installation. `AI_KNOWLEDGE_BACKEND=static` (default) keeps
`StaticKnowledgeSource`. `postgres` requires `AI_KNOWLEDGE_PRODUCT` and embedding credentials
(`AI_EMBEDDING_*` pair or `AI_BASE_URL`/`AI_API_KEY`); missing values fail worker boot. No
runtime fallback to the static corpus: an empty search must not pull SaaS Skeleton docs into an
FMS answer.

D2. Selection. Top `AI_DOCS_VECTOR_CANDIDATES` (12) by cosine distance under RLS, filtered by
product, publication and role. Identical texts are deduplicated. Excerpts are taken in distance
order up to `AI_DOCS_FINAL_CHUNKS` (5) while the stored `token_count` plus a fixed label
allowance fits `AI_DOCS_MAX_CONTEXT_TOKENS` (2 500); one that does not fit is skipped. No
distance threshold yet: distance is uncalibrated, AI-2a.4 eval decides.

D3. No transaction across the embedding call. `prepare()` becomes: short read transaction →
`knowledgeSource.select()` (embedding over HTTP, its own short search transaction) → short
transaction with `claim()`. A terminal reply is skipped before the embedding call. `claim()`
stays the only ownership authority.

D4. Embedding failure is an explicit failure. The reply is claimed and finalized `FAILED` with
`PROVIDER_UNAVAILABLE` (embedding HTTP/timeout) or `INTERNAL`; no generation without sources.

D5. Prompt. Static mode: unchanged messages. Postgres mode: boundaries → organization →
retrieved excerpts → user context → history → question. Excerpts change per question, so they
go after the cache-stable prefix. They are fenced as untrusted reference data with numbered
labels `[n]` and an instruction to cite them and to say plainly when they do not cover the
question. `ASSISTANT_BOUNDARIES` text is unchanged.

D6. Reproducibility. `knowledge_version` = `postgres:<product>:<sourceKey@revision,…>` of the
selected excerpts (`postgres:<product>:none` when empty). `knowledge_chunks` (JSONB) stores, per
excerpt, `n`, chunk/document ids, source key, revision, title, path, heading. Metadata only: the
text stays in the index and disappears with it.

D7. Citations are verified server-side. The API exposes `citations` = stored excerpts whose `[n]`
appears in the answer; a number the model invents matches nothing and is not shown. Computed at
read time, so streaming and retries need no extra writes.

D8. Opening a citation re-authorizes. `GET /ai/conversation/messages/:id/citations/:n`: the reply
must belong to the caller; the chunk is read under RLS and must still be published, enabled and
visible to the caller's current role. Otherwise 404. The reply id is the only id in the path,
as with `cancel`.
