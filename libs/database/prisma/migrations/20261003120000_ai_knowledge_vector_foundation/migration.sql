-- Installed by privileged bootstrap (db:roles / docker init), not the migrator.
-- template1 carries it into automatically created Prisma shadow databases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public'
      AND string_to_array(e.extversion, '.')::int[] >= ARRAY[0, 8, 6]
  ) THEN
    RAISE EXCEPTION 'pgvector >= 0.8.6 in public is required; run pnpm db:roles as administrator before migrations';
  END IF;
END $$;

CREATE TABLE "ai_knowledge_sources" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
  "key" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT false,
  "active_revision" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_knowledge_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_knowledge_sources_tenant_id_id_key" ON "ai_knowledge_sources"("tenant_id", "id");
CREATE UNIQUE INDEX "ai_knowledge_sources_tenant_id_product_key_key" ON "ai_knowledge_sources"("tenant_id", "product", "key");
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_knowledge_documents" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
  "source_id" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "canonical_id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "audience" "Role"[] NOT NULL DEFAULT ARRAY[]::"Role"[],
  "content_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_knowledge_documents_tenant_id_id_key" ON "ai_knowledge_documents"("tenant_id", "id");
CREATE UNIQUE INDEX "ai_knowledge_documents_identity_key"
  ON "ai_knowledge_documents"("tenant_id", "source_id", "revision", "canonical_id", "language");
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_tenant_id_source_id_fkey"
  FOREIGN KEY ("tenant_id", "source_id") REFERENCES "ai_knowledge_sources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_knowledge_chunks" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
  "document_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "heading" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "token_count" INTEGER NOT NULL,
  "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  "embedding" vector(1536) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_knowledge_chunks_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "ai_knowledge_chunks_token_count_check" CHECK ("token_count" > 0),
  CONSTRAINT "ai_knowledge_chunks_model_check" CHECK ("embedding_model" = 'text-embedding-3-small'),
  -- Zero vectors have no cosine distance; do not admit unsearchable rows.
  CONSTRAINT "ai_knowledge_chunks_embedding_check" CHECK (vector_norm("embedding") > 0)
);
CREATE UNIQUE INDEX "ai_knowledge_chunks_tenant_id_document_id_ordinal_key"
  ON "ai_knowledge_chunks"("tenant_id", "document_id", "ordinal");
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "ai_knowledge_documents"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exact cosine search first. FTS/GIN and HNSW are separate measured increments.

ALTER TABLE "ai_knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_knowledge_sources"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "ai_knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_knowledge_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_knowledge_documents"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "ai_knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_knowledge_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_knowledge_chunks"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
