-- AI-5a: assistant settings managed by the platform operator (docs/ai-platform-controls.md).

-- One row: the platform's AI settings. NULL columns fall back to the environment.
CREATE TABLE "platform_ai_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "provider" TEXT,
  "base_url" TEXT,
  "model" TEXT,
  -- v1:<iv>:<tag>:<ciphertext>, AES-256-GCM under AI_SECRETS_KEY; never plaintext
  "api_key_encrypted" TEXT,
  -- last characters for masking without decryption
  "api_key_hint" TEXT,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_ai_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_ai_settings_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "platform_ai_settings_provider_check" CHECK ("provider" IS NULL OR "provider" IN ('fake', 'openai-compat')),
  CONSTRAINT "platform_ai_settings_key_pair" CHECK (("api_key_encrypted" IS NULL) = ("api_key_hint" IS NULL))
);

-- Append-only journal: who changed what, and every key reveal. No key material.
CREATE TABLE "platform_ai_settings_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_label" TEXT,
  "changes" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_ai_settings_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_ai_settings_events_type_check" CHECK ("type" IN ('updated', 'key_revealed'))
);
CREATE INDEX "platform_ai_settings_events_created_at_idx" ON "platform_ai_settings_events"("created_at");

-- The platform's permission for one tenant. No row = allowed (installs keep working).
-- Not part of tenants.settings: the tenant writes that JSON itself.
CREATE TABLE "tenant_ai_access" (
  "tenant_id" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_ai_access_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "tenant_ai_access" ADD CONSTRAINT "tenant_ai_access_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Privileges: tenant processes (saas_app) may read settings and their own permission only.
-- Default privileges granted DML to every runtime role — take it back explicitly.
REVOKE ALL ON "platform_ai_settings" FROM saas_app;
GRANT SELECT ON "platform_ai_settings" TO saas_app;
REVOKE ALL ON "platform_ai_settings_events" FROM saas_app;
REVOKE ALL ON "tenant_ai_access" FROM saas_app;
GRANT SELECT ON "tenant_ai_access" TO saas_app;

-- saas_platform has BYPASSRLS; saas_app sees only its own tenant's row.
ALTER TABLE "tenant_ai_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_ai_access"
  FOR SELECT
  USING ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
