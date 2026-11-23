-- Ключі ідемпотентності REST-мутацій (docs/idempotency.md): рядок вставляється в транзакції
-- ефекту, відповідь дописується одразу після коміту. Tenant-таблиця під стандартним RLS.
-- (Згенеровані Prisma `ALTER COLUMN "tenant_id" SET DEFAULT` для решти таблиць прибрано:
-- це шум нормалізації виразу, не зміна схеми.)

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id","user_id","key")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: шаблон docs/multi-tenancy-architecture.md §5 дослівно (перевіряє rls.e2e-spec з каталогу)
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "idempotency_keys"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
