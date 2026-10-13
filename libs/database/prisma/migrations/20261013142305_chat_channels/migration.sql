-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "MessagingAccountStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookEventState" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'UNROUTABLE');

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_conversations" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_knowledge_chunks" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_knowledge_documents" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_knowledge_sources" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_messages" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_usage_counters" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_usage_events" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

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
ALTER TABLE "chat_messages" ADD COLUMN     "channel_id" TEXT,
ADD COLUMN     "direction" TEXT,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "provider_meta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "provider_sent_at" TIMESTAMP(3),
ADD COLUMN     "sender_contact_id" TEXT,
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "conversation_participants" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "assignee_id" TEXT,
ADD COLUMN     "channel_id" TEXT,
ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "customer_last_message_at" TIMESTAMP(3),
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

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
CREATE TABLE "messaging_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "credentials" TEXT,
    "app_secret" TEXT,
    "verify_token" TEXT NOT NULL,
    "webhook_key" TEXT NOT NULL,
    "token_kind" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "token_checked_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "MessagingAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "webhook_subscribed_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "account_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "quality_rating" TEXT,
    "account_mode" TEXT,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "provider_missing_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "channel_id" TEXT NOT NULL,
    "display_name" TEXT,
    "customer_id" TEXT,
    "opt_in_at" TIMESTAMP(3),
    "opt_in_source" TEXT,
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_contact_addresses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "contact_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_contact_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_webhook_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "account_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "body" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "state" "WebhookEventState" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,

    CONSTRAINT "channel_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_unroutable_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ip" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_unroutable_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "messaging_accounts_webhook_key_key" ON "messaging_accounts"("webhook_key");

-- CreateIndex
CREATE INDEX "messaging_accounts_provider_external_id_idx" ON "messaging_accounts"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_accounts_tenant_id_provider_key" ON "messaging_accounts"("tenant_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_accounts_tenant_id_id_key" ON "messaging_accounts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "channels_tenant_id_account_id_idx" ON "channels"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_tenant_id_id_key" ON "channels"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "channel_contacts_tenant_id_customer_id_idx" ON "channel_contacts"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_contacts_tenant_id_id_key" ON "channel_contacts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "channel_contact_addresses_tenant_id_channel_id_kind_normali_idx" ON "channel_contact_addresses"("tenant_id", "channel_id", "kind", "normalized");

-- CreateIndex
CREATE INDEX "channel_contact_addresses_contact_id_idx" ON "channel_contact_addresses"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_contact_addresses_channel_id_kind_value_key" ON "channel_contact_addresses"("channel_id", "kind", "value");

-- CreateIndex
CREATE INDEX "channel_webhook_events_tenant_id_account_id_received_at_idx" ON "channel_webhook_events"("tenant_id", "account_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "channel_webhook_events_account_id_payload_hash_key" ON "channel_webhook_events"("account_id", "payload_hash");

-- CreateIndex
CREATE INDEX "channel_unroutable_events_received_at_idx" ON "channel_unroutable_events"("received_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_kind_assignee_id_last_message_at_idx" ON "conversations"("tenant_id", "kind", "assignee_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- AddForeignKey
ALTER TABLE "messaging_accounts" ADD CONSTRAINT "messaging_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "messaging_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_tenant_id_channel_id_fkey" FOREIGN KEY ("tenant_id", "channel_id") REFERENCES "channels"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_contact_addresses" ADD CONSTRAINT "channel_contact_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_contact_addresses" ADD CONSTRAINT "channel_contact_addresses_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "channel_contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "messaging_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "channel_contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_contact_id_fkey" FOREIGN KEY ("sender_contact_id") REFERENCES "channel_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Далі — рукописна частина (Prisma її не виражає). Рішення і причини:
-- docs/whatsapp-channel.md §4.1, §4.3; openspec/changes/chat-2a-channel-inbound/design.md D2.
-- ============================================================================

-- RLS (шаблон MT-2): межа ТЕНАНТА. Гранти не потрібні — ALTER DEFAULT PRIVILEGES
-- (scripts/ensure-roles.ts) уже роздає CRUD на кожну нову таблицю saas_migrator.
ALTER TABLE "messaging_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messaging_accounts"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- Другий SELECT-шлях для публічного вебхука: тенант ще невідомий (його як раз треба
-- знайти за ключем з адреси). Видимість відкриває лише resolve_account_by_key() —
-- вона на час запиту виставляє app.webhook_lookup_key. Хто знає ключ, і так може
-- говорити від імені провайдера, тож ця політика нічого не віддає понад ключ.
CREATE POLICY webhook_key_lookup ON "messaging_accounts"
  FOR SELECT
  USING ("webhook_key" = (SELECT nullif(current_setting('app.webhook_lookup_key', true), '')));

ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channels"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "channel_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_contacts"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "channel_contact_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_contact_addresses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_contact_addresses"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "channel_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_webhook_events"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- Часткові UNIQUE — арбітри інваріантів (перевірка в коді програє гонці):
-- одна ВІДКРИТА розмова на контакт
CREATE UNIQUE INDEX "conversations_contact_open_key"
  ON "conversations" ("contact_id")
  WHERE "contact_id" IS NOT NULL AND "status" <> 'RESOLVED';

-- одне повідомлення провайдера — один рядок (дедуп вхідних; внутрішні репліки external_id не мають)
CREATE UNIQUE INDEX "chat_messages_channel_external_id_key"
  ON "chat_messages" ("tenant_id", "channel_id", "external_id")
  WHERE "external_id" IS NOT NULL;

-- один номер провайдера — один канал (серед тих, що ще існують у провайдера):
-- не може отримувати для двох тенантів
CREATE UNIQUE INDEX "channels_provider_external_id_key"
  ON "channels" ("provider", "external_id")
  WHERE "provider_missing_at" IS NULL;

-- Пошук акаунта за ключем публічного вебхука ДО автентифікації: тенант невідомий, тож
-- без політики webhook_key_lookup таблицю (FORCE RLS) не прочитати. Повертає лише
-- ідентифікатори; вимкнений акаунт і неактивний тенант невидимі (те саме, що невідомий ключ).
CREATE FUNCTION resolve_account_by_key(p_provider text, p_key text)
RETURNS TABLE (tenant_id text, account_id text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.webhook_lookup_key', p_key, true);
  RETURN QUERY
    SELECT a.tenant_id, a.id
      FROM messaging_accounts a
      JOIN tenants t ON t.id = a.tenant_id
     WHERE a.provider = p_provider
       AND a.webhook_key = p_key
       AND a.status <> 'DISABLED'
       AND t.is_active;
  PERFORM set_config('app.webhook_lookup_key', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_account_by_key(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_account_by_key(text, text) TO saas_app;

-- channel_unroutable_events: без RLS і без tenant_id. saas_app не читає і не пише напряму —
-- лише через функцію; platform-api читає (і чистить за retention у CHAT-2c).
REVOKE ALL ON "channel_unroutable_events" FROM saas_app;
REVOKE INSERT, UPDATE ON "channel_unroutable_events" FROM saas_platform;

CREATE FUNCTION record_unroutable_event(p_provider text, p_key_hash text, p_reason text, p_ip text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO channel_unroutable_events (id, provider, key_hash, reason, ip)
  VALUES (gen_random_uuid()::text, p_provider, p_key_hash, p_reason, p_ip)
$$;

REVOKE EXECUTE ON FUNCTION record_unroutable_event(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_unroutable_event(text, text, text, text) TO saas_app;
