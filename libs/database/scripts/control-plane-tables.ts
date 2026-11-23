/**
 * Дані без побічних ефектів, винесені з ensure-roles.ts (той виконує `main()` при імпорті), щоб їх
 * міг прочитати й e2e-тест `rls.e2e-spec.ts`: одне джерело правди для `db:roles` і для
 * RLS-автоперевірки (docs/multi-tenancy-architecture.md §12).
 */

/**
 * Таблиці control plane і що з ними може tenant-runtime (`saas_app`). Має збігатися з
 * REVOKE/GRANT у міграціях — ті діють при створенні таблиці, цей список — при кожному
 * переналаштуванні ролей.
 */
export const CONTROL_PLANE_TABLES: readonly {
  table: string;
  saasApp: 'none' | 'select' | 'select-insert';
  /** Привілеї, які міграція відкликає і в control plane (`saas_platform`) */
  platformRevoke?: 'INSERT, UPDATE';
}[] = [
  { table: 'platform_users', saasApp: 'none' },
  { table: 'platform_auth_sessions', saasApp: 'none' },
  // AI-5a: tenant-процеси читають налаштування й свій дозвіл, але не пишуть
  { table: 'platform_ai_settings', saasApp: 'select' },
  { table: 'platform_ai_settings_events', saasApp: 'none' },
  { table: 'tenant_ai_access', saasApp: 'select' },
  // AI-5b: тарифи читаються для розрахункової вартості; журнал витрат — tenant-таблиця під
  // RLS, але append-only для tenant-процесів (добір вартості оновлює його як saas_platform)
  { table: 'ai_model_prices', saasApp: 'select' },
  { table: 'ai_usage_events', saasApp: 'select-insert' },
  // Журнал дій оператора над даними тенантів: tenant-процеси його не бачать узагалі
  { table: 'platform_audit_events', saasApp: 'none' },
  // CHAT-2a: tenant-процес пише лише через SECURITY DEFINER-функцію `record_unroutable_event`;
  // platform-api читає й чистить за retention, але не вставляє й не змінює рядки
  { table: 'channel_unroutable_events', saasApp: 'none', platformRevoke: 'INSERT, UPDATE' },
];
