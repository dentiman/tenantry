-- Операції користувача (docs/user-operations.md). Tenant-таблиця під стандартним RLS; власник —
-- ініціатор, каскад разом із користувачем. (Згенеровані Prisma `ALTER COLUMN "tenant_id" SET
-- DEFAULT` для решти таблиць прибрано: це шум нормалізації виразу, не зміна схеми.)

-- CreateEnum
CREATE TYPE "UserOperationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "user_operations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "UserOperationStatus" NOT NULL DEFAULT 'QUEUED',
    "progress_current" INTEGER,
    "progress_total" INTEGER,
    "steps" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB NOT NULL,
    "result" JSONB,
    "result_key" TEXT,
    "error_code" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "user_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_operations_tenant_id_user_id_created_at_idx" ON "user_operations"("tenant_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_operations_status_heartbeat_at_idx" ON "user_operations"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "user_operations_finished_at_idx" ON "user_operations"("finished_at");

-- AddForeignKey
ALTER TABLE "user_operations" ADD CONSTRAINT "user_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_operations" ADD CONSTRAINT "user_operations_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: шаблон docs/multi-tenancy-architecture.md §5 дослівно (перевіряє rls.e2e-spec з каталогу)
ALTER TABLE "user_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_operations"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
