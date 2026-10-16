-- MT-0: три ролі БД (docs/multi-tenancy-plan.md §3).
-- Виконується ТІЛЬКИ на свіжому volume (docker-entrypoint-initdb.d); для наявних БД —
-- `pnpm db:roles` (libs/database/scripts/ensure-roles.ts, той самий ефект ідемпотентно).
-- Паролі — dev-only (як saas:saas); цей файл бачить лише локальний docker compose. На стендах
-- ролі створює `pnpm db:roles` з паролями з DB_*_PASSWORD (docker/deploy.env) — і поки що там
-- ті самі значення; план зміни — docs/deploy-swarm.md §«Ролі БД і паролі».

-- 1. Власник схеми: тільки міграції. CREATEDB — для shadow database `prisma migrate dev`.
CREATE ROLE saas_migrator LOGIN PASSWORD 'saas_migrator' CREATEDB;

-- 2. Runtime api/worker: НЕ власник, без BYPASSRLS → RLS діятиме (MT-2). DDL-прав немає.
CREATE ROLE saas_app LOGIN PASSWORD 'saas_app';

-- 3. Control plane + maintenance-джоби: бачить крізь RLS, але НЕ superuser.
CREATE ROLE saas_platform LOGIN PASSWORD 'saas_platform' BYPASSRLS;

GRANT USAGE ON SCHEMA public TO saas_app, saas_platform;
ALTER SCHEMA public OWNER TO saas_migrator;

-- Майбутні таблиці/sequences міграцій → DML для runtime-ролей автоматично
ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO saas_app, saas_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO saas_app, saas_platform;

-- pg-boss створює свої таблиці сам під runtime-роллю → схема належить saas_app.
-- CREATE на database потрібен, бо install-шлях pg-boss робить CREATE SCHEMA IF NOT EXISTS,
-- а Postgres перевіряє ACL ДО перевірки існування схеми (перевірено на свіжій БД)
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO saas_app', current_database());
END
$$;
CREATE SCHEMA pgboss AUTHORIZATION saas_app;
GRANT USAGE ON SCHEMA pgboss TO saas_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE saas_app IN SCHEMA pgboss
  GRANT SELECT ON TABLES TO saas_platform;
