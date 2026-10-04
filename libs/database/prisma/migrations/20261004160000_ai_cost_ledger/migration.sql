-- AI-5b: cost ledger and model tariffs (docs/ai-platform-controls.md §3, design.md R1–R6).

-- The provider request id of the attempt that owns the reply row (`gen-…`), written with the
-- partial text, so a reclaimed attempt of a crashed worker can be reconciled. Not a cost column.
ALTER TABLE "ai_messages" ADD COLUMN "provider_request_id" TEXT;

-- CreateTable
CREATE TABLE "ai_model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_per_million" DECIMAL(18,10) NOT NULL,
    "cache_read_per_million" DECIMAL(18,10),
    "cache_write_per_million" DECIMAL(18,10),
    "output_per_million" DECIMAL(18,10) NOT NULL,
    "request_price" DECIMAL(18,10) NOT NULL DEFAULT 0,
    "tiers" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "valid_from" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "user_id" TEXT,
    "message_id" TEXT,
    "source_id" TEXT,
    "attempt" INTEGER,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "cached_read_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "reported_cost" DECIMAL(18,10),
    "provider_request_id" TEXT,
    "estimated_cost" DECIMAL(18,10),
    "price_id" TEXT,
    "cost_status" TEXT NOT NULL,
    "reconcile_attempts" INTEGER NOT NULL DEFAULT 0,
    "reconcile_after" TIMESTAMP(3),

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_prices_provider_model_valid_from_key" ON "ai_model_prices"("provider", "model", "valid_from");

-- CreateIndex
CREATE INDEX "ai_usage_events_tenant_id_occurred_at_idx" ON "ai_usage_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_occurred_at_idx" ON "ai_usage_events"("occurred_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_tenant_id_message_id_idx" ON "ai_usage_events"("tenant_id", "message_id");

-- CreateIndex
CREATE INDEX "ai_usage_events_cost_status_reconcile_after_idx" ON "ai_usage_events"("cost_status", "reconcile_after");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed vocabularies (strings in Prisma, enforced here like platform_ai_settings).
ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_source_check"
  CHECK ("source" IN ('openrouter-sync', 'manual'));
ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_currency_check"
  CHECK ("currency" = 'USD');
ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_nonnegative_check"
  CHECK ("input_per_million" >= 0 AND "output_per_million" >= 0 AND "request_price" >= 0
    AND coalesce("cache_read_per_million", 0) >= 0 AND coalesce("cache_write_per_million", 0) >= 0);

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_kind_check"
  CHECK ("kind" IN ('generation', 'query_embedding', 'ingest_embedding', 'eval'));
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_outcome_check"
  CHECK ("outcome" IN ('complete', 'failed', 'cancelled', 'timeout', 'retried', 'superseded', 'abandoned'));
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_cost_status_check"
  CHECK ("cost_status" IN ('reported', 'estimated', 'pending', 'unknown'));

-- ============================================================================
-- Privileges. Default privileges grant DML on every new table to both runtime roles; take
-- it back explicitly. ensure-roles.ts (CONTROL_PLANE_TABLES) re-applies the same restriction
-- after its broad GRANT, otherwise `db:roles` would silently undo this.
--  - ai_model_prices: control plane; saas_app reads tariffs to freeze the estimate.
--  - ai_usage_events: append-only for the tenant runtime (SELECT + INSERT, own tenant only);
--    reconciliation UPDATEs run as saas_platform (BYPASSRLS).
-- ============================================================================
REVOKE ALL ON "ai_model_prices" FROM saas_app;
GRANT SELECT ON "ai_model_prices" TO saas_app;
REVOKE ALL ON "ai_usage_events" FROM saas_app;
GRANT SELECT, INSERT ON "ai_usage_events" TO saas_app;

-- RLS (MT-2 template): the tenant boundary for the ledger.
ALTER TABLE "ai_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage_events"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
