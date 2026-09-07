-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('MEETING', 'CALL', 'DEADLINE', 'OUT_OF_OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('DEFAULT', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CalendarAttendeeRole" AS ENUM ('REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "CalendarAttendeeResponse" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

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
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "time_zone" TEXT,
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "kind" "CalendarEventKind" NOT NULL DEFAULT 'MEETING',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'DEFAULT',
    "busy" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" TEXT,
    "customer_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_attendees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "CalendarAttendeeRole" NOT NULL DEFAULT 'REQUIRED',
    "response" "CalendarAttendeeResponse" NOT NULL DEFAULT 'NEEDS_ACTION',
    "responded_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_reminders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "minutes_before" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "fire_at" TIMESTAMP(3) NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "target_kind" TEXT,
    "target_id" TEXT,
    "group_key" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'system',
    "actor_id" TEXT,
    "actor_label" TEXT,
    "claimed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "skipped_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_starts_at_ends_at_idx" ON "calendar_events"("tenant_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_owner_id_starts_at_idx" ON "calendar_events"("tenant_id", "owner_id", "starts_at");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_customer_id_starts_at_idx" ON "calendar_events"("tenant_id", "customer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_tenant_id_id_key" ON "calendar_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "calendar_event_attendees_tenant_id_user_id_idx" ON "calendar_event_attendees"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_attendees_tenant_id_event_id_user_id_key" ON "calendar_event_attendees"("tenant_id", "event_id", "user_id");

-- CreateIndex
CREATE INDEX "calendar_reminders_tenant_id_event_id_idx" ON "calendar_reminders"("tenant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminders_tenant_id_event_id_user_id_minutes_befor_key" ON "calendar_reminders"("tenant_id", "event_id", "user_id", "minutes_before", "channel");

-- CreateIndex
CREATE INDEX "scheduled_notifications_tenant_id_recipient_id_fire_at_idx" ON "scheduled_notifications"("tenant_id", "recipient_id", "fire_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_notifications_tenant_id_dedupe_key_key" ON "scheduled_notifications"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "calendar_events"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "calendar_events"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_tenant_id_recipient_id_fkey" FOREIGN KEY ("tenant_id", "recipient_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS (docs/calendar.md §5). Шаблон дослівно той самий, що в
-- 20260716140000_enable_rls і 20260901102559_customers: current_setting(..., true)
-- → fail-closed без контексту; nullif(...,'') → після RESET setting порожній
-- рядок; (SELECT ...) → InitPlan, обчислюється раз на запит, а не на рядок.
-- Авточек pg_policies у rls.e2e-spec підхопить нові таблиці сам.
-- ============================================================================

ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_events"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "calendar_event_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_event_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_event_attendees"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "calendar_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_reminders"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- scheduled_notifications теж під RLS, хоча читає її крос-tenant сканер: він
-- ходить під saas_platform (BYPASSRLS), а доменний код — під saas_app, і йому
-- чужі нагадування недосяжні. Саме це й було головним аргументом проти
-- pg-boss startAfter: у pgboss.* такої політики немає і бути не може.
ALTER TABLE "scheduled_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scheduled_notifications"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- ============================================================================
-- Частковий індекс — Prisma їх не вміє, тому руками.
-- ============================================================================

-- Робочий набір сканера: рядки, які ще нікому не доставлені й ніким не
-- захоплені. tenant_id у ключі НЕ провідний свідомо — сканер шукає дозріле
-- ПО ВСІХ тенантах одним запитом (scope: 'system'), а не тенант за тенантом.
-- Індекс лишається крихітним: доставлені рядки з нього випадають.
CREATE INDEX "scheduled_notifications_pending_idx"
  ON "scheduled_notifications" ("fire_at")
  WHERE "delivered_at" IS NULL AND "claimed_at" IS NULL;
