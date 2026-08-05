-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_country" CHAR(2),
ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);
