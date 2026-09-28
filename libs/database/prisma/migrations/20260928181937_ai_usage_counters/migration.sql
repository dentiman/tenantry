-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_conversations" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "cached_prompt_tokens" INTEGER,
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_event_attendees" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_events" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_reminders" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "chat_messages" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "conversation_participants" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "customer_contacts" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "number_sequences" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "number_series" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "scheduled_notifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "verification_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- CreateTable
CREATE TABLE "ai_usage_counters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_counters_tenant_id_period_start_idx" ON "ai_usage_counters"("tenant_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_counters_tenant_id_user_id_period_start_key" ON "ai_usage_counters"("tenant_id", "user_id", "period_start");

-- AddForeignKey
ALTER TABLE "ai_usage_counters" ADD CONSTRAINT "ai_usage_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_counters" ADD CONSTRAINT "ai_usage_counters_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS (шаблон MT-2, той самий що ai_conversations). Гранти тут НЕ потрібні:
-- ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator (scripts/ensure-roles.ts) уже
-- роздає SELECT/INSERT/UPDATE/DELETE на КОЖНУ нову таблицю цієї ролі.
--
-- RLS тут — межа ТЕНАНТА (ai-1d, design.md). Композитний FK на users є, як і в
-- ai_conversations, тому що лічильник належить конкретній людині, а не лише
-- тенанту.
-- ============================================================================

ALTER TABLE "ai_usage_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage_counters"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
