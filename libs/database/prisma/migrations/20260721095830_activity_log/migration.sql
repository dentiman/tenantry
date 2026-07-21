-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_links" (
    "activity_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "activity_links_pkey" PRIMARY KEY ("activity_id","entity_type","entity_id")
);

-- CreateIndex
CREATE INDEX "activities_tenant_id_created_at_id_idx" ON "activities"("tenant_id", "created_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_tenant_id_id_key" ON "activities"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "activity_links_tenant_id_entity_type_entity_id_idx" ON "activity_links"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_activity_id_fkey" FOREIGN KEY ("tenant_id", "activity_id") REFERENCES "activities"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (MT-2 шаблон, docs/activity-log.md): ізоляція тенантів — enforcement БД.
-- ENABLE+FORCE на обидві таблиці; гранти для saas_app дає наявний ALTER DEFAULT
-- PRIVILEGES. Авточек pg_policies у rls.e2e-spec підхопить нові таблиці сам.
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activities"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "activity_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_links"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
