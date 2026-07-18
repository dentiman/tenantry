-- MT-3: identity control plane (apps/platform-api). Окрема від users:
-- інший login-флоу, інший JWT-secret, без tenant_id (глобальна таблиця).

CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- Розділення plane-ів на рівні ПРИВІЛЕЇВ, не тільки коду: tenant-api (saas_app)
-- операторську identity навіть прочитати не може. Default privileges дали DML
-- усім runtime-ролям — забираємо в saas_app явно.
REVOKE ALL ON "platform_users" FROM saas_app;
