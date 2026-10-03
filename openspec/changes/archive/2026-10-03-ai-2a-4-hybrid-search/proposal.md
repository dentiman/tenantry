## Why

AI-2a.3 answers from vector search only. Live runs showed no relevance cut-off (an off-topic
question still gets five excerpts), weaker Ukrainian queries and no guarantee for exact terms.
The search mode and threshold must be chosen from measurements, not guessed.

## What Changes

- Postgres full-text search over chunks: `fts_config` per chunk (from document language) and a
  generated `search_vector` with a GIN index.
- Search modes `vector` / `fts` / `hybrid` (`AI_DOCS_SEARCH_MODE`); hybrid merges both candidate
  lists with Reciprocal Rank Fusion. `fts` needs no embedding call; `hybrid` degrades to FTS
  when embeddings fail.
- Optional relevance threshold `AI_DOCS_MAX_DISTANCE` on the vector branch.
- `pnpm ai:docs:eval`: retrieval-only evaluation over a versioned question set (Recall@k, MRR,
  abstention on unanswerable questions, latency), comparing modes and thresholds.
- Default mode and threshold chosen from the eval result.

## Capabilities

### New Capabilities

- `ai-assistant/hybrid-search`: full-text and hybrid retrieval, relevance threshold, eval.

### Modified Capabilities

None.

## Impact

Migration on `ai_knowledge_chunks`; ingest writes `fts_config`; worker config. No HTTP/UI
contract change.
