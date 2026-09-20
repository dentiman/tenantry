-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AiMessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

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
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "status" "AiMessageStatus" NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "error_code" TEXT,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_user_id_status_idx" ON "ai_conversations"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_tenant_id_id_key" ON "ai_conversations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_tenant_id_conversation_id_seq_key" ON "ai_messages"("tenant_id", "conversation_id", "seq");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "ai_conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS (шаблон MT-2). Гранти тут НЕ потрібні: міграції йдуть під saas_migrator, а
-- `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator` (scripts/ensure-roles.ts) уже
-- роздає SELECT/INSERT/UPDATE/DELETE на КОЖНУ нову таблицю цієї ролі.
--
-- RLS тут — межа ТЕНАНТА. Межу людини (розмова особиста, ADMIN чужу не бачить)
-- тримає сервіс: те саме рішення, що для приватних каналів чату і приватних
-- подій календаря — «RLS — межа тенанта, а не учасника».
-- ============================================================================

ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_conversations"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_messages"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- ============================================================================
-- Частковий унікальний індекс — Prisma їх не вміє, тому руками (той самий прийом,
-- що для робочого набору scheduled_notifications).
--
-- «Рівно одна активна розмова на юзера» тут не угода, а обмеження БД. Заразом це
-- АРБІТР гонки: дві вкладки, які одночасно створюють першу розмову, дадуть
-- unique violation одній із них — вона просто перечитає наявну. Перевірка в коді
-- цю гонку не ловить.
-- ============================================================================

CREATE UNIQUE INDEX "ai_conversations_active_per_user_key"
  ON "ai_conversations" ("tenant_id", "user_id")
  WHERE "status" = 'ACTIVE';
