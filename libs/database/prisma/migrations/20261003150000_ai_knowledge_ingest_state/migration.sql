-- Existing table already has FORCE RLS and tenant-isolation USING/WITH CHECK.
ALTER TABLE ai_knowledge_sources
  ADD COLUMN ingest_run_id TEXT,
  ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN ingest_started_at TIMESTAMP(3),
  ADD COLUMN manifest_hash CHAR(64),
  ADD CONSTRAINT ai_knowledge_sources_ingest_status_check
    CHECK (ingest_status IN ('idle', 'running', 'complete', 'failed'));
CREATE INDEX ai_knowledge_chunks_tenant_hash_idx
  ON ai_knowledge_chunks(tenant_id, content_hash, embedding_model);
