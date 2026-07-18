-- MT-1: фундамент мультитенантності (docs/multi-tenancy-migration.md).
-- Порядок критичний: expand (nullable) → backfill (дефолтний tenant) → contract (NOT NULL).
-- DB-default nullif(current_setting(...)) — щоб доменний код НЕ передавав tenant_id:
-- extension виставляє app.tenant_id першим стейтментом кожної транзакції (MT-1),
-- INSERT без контексту падає на NOT NULL — fail-closed, а не тихий запис "у нікуди".

-- 1. Сам tenant (+ дефолтний рядок: single-tenant = N=1 цієї ж схеми)
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

INSERT INTO "tenants" ("id", "slug", "name", "updated_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'Default Tenant', CURRENT_TIMESTAMP);

-- 2. expand: nullable-колонки
ALTER TABLE "users" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "files" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "attachments" ADD COLUMN "tenant_id" TEXT;

-- 3. backfill: усі наявні рядки — у дефолтний tenant
UPDATE "users" SET "tenant_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "refresh_tokens" SET "tenant_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "files" SET "tenant_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "attachments" SET "tenant_id" = '00000000-0000-4000-8000-000000000001';

-- 4. contract: NOT NULL + DB-default із tenant-контексту сесії
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL,
    ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '');
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET NOT NULL,
    ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '');
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET NOT NULL,
    ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '');
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET NOT NULL,
    ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '');

-- 5. Старі глобальні unique/індекси/FK → tenant-scoped
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_file_id_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

DROP INDEX "attachments_entity_type_entity_id_idx";
DROP INDEX "attachments_file_id_entity_type_entity_id_key";
DROP INDEX "refresh_tokens_user_id_idx";
DROP INDEX "users_email_key";

CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");
CREATE INDEX "users_tenant_id_created_at_idx" ON "users"("tenant_id", "created_at");

CREATE INDEX "refresh_tokens_tenant_id_user_id_idx" ON "refresh_tokens"("tenant_id", "user_id");

CREATE UNIQUE INDEX "files_tenant_id_id_key" ON "files"("tenant_id", "id");
CREATE INDEX "files_tenant_id_status_created_at_idx" ON "files"("tenant_id", "status", "created_at");
-- files_status_created_at_idx лишається (системний cron cleanup-orphans шукає по всіх тенантах)

CREATE UNIQUE INDEX "attachments_tenant_id_file_id_entity_type_entity_id_key"
    ON "attachments"("tenant_id", "file_id", "entity_type", "entity_id");
CREATE INDEX "attachments_tenant_id_entity_type_entity_id_idx"
    ON "attachments"("tenant_id", "entity_type", "entity_id");

-- 6. FK: на tenants + композитні (FK-перевірки обходять RLS — композит не дає
--    послатися на рядок чужого tenant-а). avatar_file_id/uploaded_by_id — НЕ композитні
--    (onDelete SET NULL занулив би і tenant_id), захист — RLS обох таблиць.
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey"
    FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_file_id_fkey"
    FOREIGN KEY ("tenant_id", "file_id") REFERENCES "files"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
