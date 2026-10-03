## Decisions

D1. FTS lives on the chunk row. `fts_config regconfig` is chosen at ingest from the document
language (`en`→`english`, `ru`→`russian`, otherwise `simple` — Postgres ships no Ukrainian
stemmer). `search_vector` is a STORED generated column `to_tsvector(fts_config, heading || ' ' ||
content)`: computed by Postgres for every row, including the backfill in the migration, which
cannot UPDATE through FORCE RLS as the migrator. Existing rows get `english` (the whole indexed
corpus is English); the column default afterwards is `simple`.

D2. The FTS query is an OR of the question's lexemes per configuration (`plainto_tsquery` with
`&` turned into `|`), ranked with `ts_rank_cd` normalized by length. AND semantics would return
nothing for most natural-language questions; ranking rewards documents covering more terms.

D3. Hybrid = Reciprocal Rank Fusion (k = 60) of the vector top-N and FTS top-N. RRF uses ranks,
so cosine distance and text rank never need a common scale. Excerpt selection (dedup, budget) is
unchanged and runs on the fused order.

D4. Threshold only on the vector branch (`AI_DOCS_MAX_DISTANCE`, unset = none). Distance is the
only score with a stable meaning across questions; text rank depends on query length. An FTS hit
needs at least one shared lexeme, which off-topic questions rarely have.

D5. Failure policy: `vector` — embedding failure fails the reply (unchanged); `hybrid` — falls
back to FTS and logs `degraded: true`; `fts` — never calls the embedding API.

D6. Eval is retrieval-only (no generation, no LLM judge): deterministic and almost free. The
question set is versioned in the repo with expected document paths and categories (exact,
paraphrase, cross-lingual, multi-document, unanswerable). Metrics: Recall@k over answerable
questions, MRR, abstention rate on unanswerable questions, p50/p95 latency, embedding tokens.
The question set is a draft until reviewed by the product owner.
