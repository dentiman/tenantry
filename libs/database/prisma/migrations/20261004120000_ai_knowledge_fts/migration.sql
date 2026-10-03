-- AI-2a.4: full-text search over knowledge chunks.
-- The text-search configuration follows the document language and is set by ingest.
-- ADD COLUMN ... DEFAULT fills existing rows without an UPDATE: the migrator cannot
-- UPDATE through FORCE RLS, and the whole corpus indexed so far is English.
ALTER TABLE "ai_knowledge_chunks"
  ADD COLUMN "fts_config" regconfig NOT NULL DEFAULT 'english'::regconfig;
-- Postgres ships no Ukrainian stemmer: unknown languages get plain lexemes.
ALTER TABLE "ai_knowledge_chunks" ALTER COLUMN "fts_config" SET DEFAULT 'simple'::regconfig;

-- Generated, so Postgres computes it for every existing and future row itself.
ALTER TABLE "ai_knowledge_chunks"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector("fts_config", "heading" || ' ' || "content")) STORED;

CREATE INDEX "ai_knowledge_chunks_search_vector_idx"
  ON "ai_knowledge_chunks" USING GIN ("search_vector");
