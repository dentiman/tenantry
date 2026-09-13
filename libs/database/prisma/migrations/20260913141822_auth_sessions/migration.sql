-- AUTH-1: refresh_tokens → auth_sessions (сесія = пристрій, а не рядок токена).
--
-- ПОРЯДОК КРИТИЧНИЙ і відрізняється від згенерованого Prisma: вона ставить
-- `DROP TABLE "refresh_tokens"` ПЕРЕД `CREATE TABLE "auth_sessions"`, тобто мовчки
-- розлогінює всіх. Тут спершу створюємо нову таблицю, ПЕРЕНОСИМО рядки, вмикаємо
-- RLS — і лише потім дропаємо стару.

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prev_token_hash" TEXT,
    "prev_rotated_at" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMP(3) NOT NULL,
    "absolute_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,
    "device_label" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "auth_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_idle_expires_at_idx" ON "auth_sessions"("tenant_id", "idle_expires_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Перенесення живих сесій. Мета — НЕ розлогінити нікого деплоєм: id рядка стає
-- `sid`, тому refresh-токен `tenantId:id:secret`, який лежить у браузері,
-- лишається валідним і після переходу.
--
-- Старий хеш — argon2, новий формат — sha256. Щоб не тримати прапорець "яким
-- алгоритмом це хешовано", алгоритм їде ПРЕФІКСОМ у самому полі: перенесені
-- рядки отримують `argon2:`, нові пишуться як `sha256:`. Перша ж успішна
-- ротація перезапише перенесений рядок на sha256 — окремої міграції даних
-- потім не знадобиться.
--
-- `absolute_expires_at` рахуємо від created_at, а не від expires_at: стеля
-- життя пристрою відлічується від ЛОГІНУ (30 днів за дефолтом AUTH_SESSION_*).
-- ============================================================================

INSERT INTO "auth_sessions" (
  "id", "tenant_id", "user_id", "token_hash", "generation",
  "issued_at", "last_used_at", "idle_expires_at", "absolute_expires_at"
)
SELECT
  "id", "tenant_id", "user_id", 'argon2:' || "token_hash", 0,
  "created_at", "created_at", "expires_at", "created_at" + INTERVAL '30 days'
FROM "refresh_tokens";

-- ============================================================================
-- RLS — той самий шаблон, що в 20260716140000_enable_rls. Для таблиці сесій це
-- не формальність: без політики сусідній тенант бачив би, з яких IP і пристроїв
-- заходять чужі співробітники.
-- ============================================================================

ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "auth_sessions"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey";

-- DropTable (тільки ПІСЛЯ переносу рядків вище)
DROP TABLE "refresh_tokens";
