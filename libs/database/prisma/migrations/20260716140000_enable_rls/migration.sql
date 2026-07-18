-- MT-2: увімкнення RLS — ізоляція тенантів стає enforcement-ом БД
-- (docs/multi-tenancy-plan.md §4, docs/multi-tenancy-migration.md MT-2).
-- Діє на saas_app (не власник, без BYPASSRLS); saas_platform (control plane і
-- системні cron-джоби) проходить крізь політики; міграції йдуть під власником.
--
-- Механіка політики (три неочевидні деталі — §4 плану):
--  - current_setting(..., true): без контексту NULL → порівняння false → НУЛЬ рядків
--    на читанні (fail-closed), а не помилка і не «всі рядки»;
--  - nullif(..., ''): після RESET setting — порожній рядок, без nullif падав би каст;
--  - (SELECT ...): InitPlan — обчислюється раз на запит, а не на кожен рядок.

-- 1. Доменні tenant-таблиці: ENABLE + FORCE (страховка навіть від власника)
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "refresh_tokens"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- 2. tenants: tenant бачить/оновлює ЛИШЕ власний рядок; створення нових —
--    неможливе під saas_app (WITH CHECK успадковує USING: новий id ≠ ctx),
--    тенантів заводить platform-api під saas_platform (BYPASSRLS).
--    БЕЗ FORCE свідомо: resolve_tenant() — SECURITY DEFINER від ВЛАСНИКА таблиці
--    (saas_migrator), FORCE осліпив би і її.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON "tenants"
  FOR ALL
  USING ("id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

-- processed_jobs: інфра-таблиця, RLS свідомо НЕ вмикається (маркер ідемпотентності глобальний)

-- 3. resolve_tenant(slug) — курка-яйце slug-логіну (MT-3): tenants під RLS,
--    а читати її по slug-у треба ДО автентифікації. SECURITY DEFINER = права
--    власника (обходить політику, бо без FORCE); повертає лише id активного
--    tenant-а (NULL для неіснуючого/suspended → звичайний 401 далі).
--    saas_app НЕ має прямого SELECT на чужі рядки → перелічити тенантів неможливо.
CREATE FUNCTION resolve_tenant(p_slug text) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$ SELECT id FROM tenants WHERE slug = p_slug AND is_active $$;

REVOKE EXECUTE ON FUNCTION resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO saas_app;
