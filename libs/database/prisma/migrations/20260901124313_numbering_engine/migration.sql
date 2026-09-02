-- Нумераційний двигун (docs/customers.md §5): номер сутності стає ЦІЛИМ числом,
-- формат (префікс/нулі) переїжджає в конфіг тенанта `number_series`, лічильник
-- отримує бакет скидання `scope` під майбутні документи з річною нумерацією.
--
-- УВАГА: згенерований Prisma варіант робив DROP COLUMN + ADD COLUMN на
-- customers.number — тобто МОВЧКИ втрачав дані. Замінено на ALTER TYPE ... USING:
-- 'C-000123' → 123. Разом із колонкою переживає й унікальний індекс, тому
-- згенерований CREATE UNIQUE INDEX прибраний (він упав би на «already exists»).
-- CreateEnum
CREATE TYPE "NumberResetPeriod" AS ENUM ('NONE', 'YEARLY', 'MONTHLY');

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

-- Текстовий номер → ціле: лишаємо самі цифри ('C-000123' → 123)
ALTER TABLE "customers"
  ALTER COLUMN "number" TYPE INTEGER
  USING NULLIF(regexp_replace("number", '\D', '', 'g'), '')::integer;

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "number_sequences" DROP CONSTRAINT "number_sequences_pkey",
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
ADD CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("tenant_id", "name", "scope");

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- CreateTable
CREATE TABLE "number_series" (
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 0,
    "start_value" INTEGER NOT NULL DEFAULT 1,
    "reset_period" "NumberResetPeriod" NOT NULL DEFAULT 'NONE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("tenant_id","name")
);

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS для number_series — той самий шаблон, що в 20260716140000_enable_rls.
-- Конфіг нумерації належить тенанту так само, як його дані: без політики
-- сусід прочитав би чужий префікс і, головне, чужий поточний номер (а це
-- обсяг бізнесу).
-- ============================================================================

ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "number_series"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
