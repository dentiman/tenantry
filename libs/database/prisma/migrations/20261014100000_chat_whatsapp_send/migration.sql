-- CHAT-3a: WhatsApp без вебхуків. Колонки акаунта/каналу, журнал викликів до провайдера і гарантія
-- «один default на акаунт». Лише адитивне.

-- Перед унікальним індексом: у жодному акаунті не має бути двох default-каналів. Якщо є — падаємо
-- голосно, а не лишаємо індекс, який не створиться, або мовчки знімаємо чийсь default.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "channels"
    WHERE "is_default" AND "provider_missing_at" IS NULL
    GROUP BY "account_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'chat_whatsapp_send: an account has more than one default channel; fix the data first';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "messaging_accounts" ADD COLUMN "app_id" TEXT;
ALTER TABLE "channels" ADD COLUMN "provider_meta" JSONB NOT NULL DEFAULT '{}';

-- Один default-номер на акаунт; змінюється під SELECT … FOR UPDATE на рядку акаунта (design.md D3)
CREATE UNIQUE INDEX "channels_account_default_key"
  ON "channels" ("account_id")
  WHERE "is_default" AND "provider_missing_at" IS NULL;

-- CreateTable
CREATE TABLE "channel_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "account_id" TEXT NOT NULL,
    "message_id" TEXT,
    "operation" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "error_code" TEXT,
    "error_title" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_logs_tenant_id_account_id_created_at_idx" ON "channel_logs"("tenant_id", "account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "channel_logs_created_at_idx" ON "channel_logs"("created_at");

-- AddForeignKey
ALTER TABLE "channel_logs" ADD CONSTRAINT "channel_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_logs" ADD CONSTRAINT "channel_logs_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "messaging_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: межа тенанта
ALTER TABLE "channel_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_logs"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
