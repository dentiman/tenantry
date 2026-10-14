-- CHAT-3b1: захоплення вебхуків Meta. Лише адитивні колонки.
ALTER TABLE "channel_webhook_events" ADD COLUMN "headers" JSONB;
ALTER TABLE "channel_webhook_events" ADD COLUMN "signature_valid" BOOLEAN;
ALTER TABLE "channels" ADD COLUMN "webhook_subscribed_at" TIMESTAMP(3);
