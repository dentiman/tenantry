-- CHAT-2b: доставка вихідного. Нові колонки доставки у chat_messages і таблиця квитанцій,
-- що випередили запис external_id. Лише адитивне: наявні рядки (вхідні, SENT) лишаються як є.

-- AlterTable
ALTER TABLE "chat_messages"
  ADD COLUMN "failure" JSONB,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sending_started_at" TIMESTAMP(3),
  ADD COLUMN "sent_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "read_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "channel_pending_statuses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "account_id" TEXT NOT NULL,
    "channel_external_id" TEXT NOT NULL,
    "external_id" TEXT,
    "opaque_id" TEXT,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "failure" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_pending_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_pending_statuses_tenant_id_account_id_external_id_idx" ON "channel_pending_statuses"("tenant_id", "account_id", "external_id");

-- CreateIndex
CREATE INDEX "channel_pending_statuses_tenant_id_opaque_id_idx" ON "channel_pending_statuses"("tenant_id", "opaque_id");

-- CreateIndex
CREATE INDEX "channel_pending_statuses_created_at_idx" ON "channel_pending_statuses"("created_at");

-- AddForeignKey
ALTER TABLE "channel_pending_statuses" ADD CONSTRAINT "channel_pending_statuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_pending_statuses" ADD CONSTRAINT "channel_pending_statuses_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "messaging_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: межа тенанта, як у решти таблиць каналів
ALTER TABLE "channel_pending_statuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_pending_statuses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_pending_statuses"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
