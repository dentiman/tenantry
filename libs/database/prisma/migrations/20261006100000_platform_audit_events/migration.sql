-- Operator actions on tenant data (docs/multi-tenancy-architecture.md). Append-only, no FKs:
-- the trail must outlive both the tenant and the user. No secret material in "details".
CREATE TABLE "platform_audit_events" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "target_label" TEXT,
  "actor_id" TEXT,
  "actor_label" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_events_tenant_id_created_at_idx" ON "platform_audit_events"("tenant_id", "created_at");

-- Default privileges granted DML to every runtime role — tenant processes get nothing.
REVOKE ALL ON "platform_audit_events" FROM saas_app;
