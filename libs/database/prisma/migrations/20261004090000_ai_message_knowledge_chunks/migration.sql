-- AI-2a.3: retrieval excerpts actually given to the model for this reply
-- (metadata only — n, chunk/document ids, source key, revision, title, path, heading).
ALTER TABLE "ai_messages" ADD COLUMN "knowledge_chunks" JSONB;
