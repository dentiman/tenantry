/**
 * Граф модулів — єдине джерело правди про те, хто від кого залежить (docs/modules.md).
 * Перевіряє `pnpm modules:check` (scripts/modules-check.ts) проти фактичних імпортів.
 *
 * Модуль — це домен, а не тека: він живе в кількох застосунках і бібліотеках одразу
 * (контракт у libs/contracts, сервіс в apps/api, екран в apps/web, підписник у worker).
 * Файл належить модулю за найконкретнішим шаблоном нижче.
 *
 * Шаблони: шлях від кореня репозиторію; закінчується на `/` — уся тека; `*` — будь-що в
 * межах одного сегмента шляху.
 *
 * Рівні — напрямок, а не дозвіл: залежність іде вниз (feature → core → platform → infra).
 * Дозвіл дає лише явне ребро в `dependsOn`. Звʼязок угору (сторінка клієнта показує його
 * події) — внесок фічі в слот модуля нижче, не імпорт (docs/modules.md §3).
 */

export type Tier = 'infra' | 'platform' | 'core' | 'feature';

export interface ModuleDef {
  tier: Tier;
  dependsOn: readonly string[];
  /** Одне речення: навіщо модуль і чи переживає він форк */
  summary: string;
  paths: readonly string[];
}

export const MODULES = {
  // ------------------------------------------------------------------ infra
  infra: {
    tier: 'infra',
    dependsOn: [],
    summary:
      'Інфраструктура без домену: конфіг, БД, помилки, UI-кит, i18n, логер. Не знає жодного модуля.',
    paths: [
      'libs/database/',
      'apps/*/vite.config.ts',
      'apps/*/vitest.config.ts',
      'apps/*/orval.config.ts',
      'libs/*/vitest.config.ts',
      'libs/ui/src/',
      'libs/i18n/src/',
      'libs/shared/src/errors/',
      'libs/shared/src/crypto/',
      'libs/contracts/src/error/',
      'libs/contracts/src/pagination/',
      'libs/contracts/src/money/',
      'libs/contracts/src/phone/',
      'libs/contracts/src/time/',
      'apps/api/src/common/',
      'apps/api/src/config/',
      'apps/api/src/types/',
      'apps/api/src/openapi.config.ts',
      'apps/platform-api/src/common/',
      'apps/platform-api/src/config/',
      'apps/platform-api/src/openapi.config.ts',
      'apps/platform-api/src/logger.config.ts',
      'apps/worker/src/config/',
      'apps/worker/src/i18n/',
      'apps/worker/src/mail/',
      'apps/worker/src/logger.config.ts',
      'apps/web/src/components/form/',
      'apps/web/src/components/section/',
      'apps/web/src/components/phone-number.tsx',
      'apps/web/src/lib/uuid.ts',
      'apps/web/src/lib/slots.tsx',
      'apps/web/src/lib/payload-values.ts',
      'apps/platform-web/src/lib/money.ts',
      'apps/web/src/lib/entity-routes.ts',
      'apps/platform-web/src/components/section/',
    ],
  },

  // --------------------------------------------------------------- platform
  app: {
    tier: 'platform',
    dependsOn: ['auth', 'notifications', 'realtime'],
    summary:
      'Оболонка застосунків: app-shell (rail, sidebar, панелі), HTTP-клієнт, bootstrap, health, Valkey.',
    paths: [
      'apps/api/src/app.setup.ts',
      'apps/api/src/health.controller.ts',
      'apps/api/src/redis/',
      'apps/api/src/common/app-throttler.module.ts',
      'apps/platform-api/src/app.setup.ts',
      'apps/platform-api/src/health.controller.ts',
      'apps/platform-api/src/redis/',
      'apps/platform-api/src/common/app-throttler.module.ts',
      'apps/web/src/api/',
      'apps/web/src/app-shell/',
      'apps/web/src/components/toast-host.tsx',
      'apps/platform-web/src/api/',
      'apps/platform-web/src/app-shell/',
      'apps/platform-web/src/components/toast-host.tsx',
    ],
  },
  auth: {
    tier: 'platform',
    dependsOn: ['activities', 'app', 'messaging', 'notifications', 'realtime', 'users'],
    summary: 'Вхід, сесії, токени, відновлення пароля — обидва плани.',
    paths: [
      'apps/web/src/features/auth/',
      'libs/contracts/src/auth/',
      'libs/contracts/src/platform/platform-auth.*',
      'libs/shared/src/auth/',
      'libs/shared/src/messaging/definitions/auth.messages.ts',
      'apps/api/src/auth/',
      'apps/platform-api/src/auth/',
      'apps/worker/src/subscribers/password-reset-email.subscriber.ts',
      'apps/worker/src/subscribers/email-change-email.subscriber.ts',
      'apps/worker/src/subscribers/email-changed-notice.subscriber.ts',
      'apps/worker/src/subscribers/cleanup-expired-tokens.subscriber.ts',
      'apps/platform-web/src/features/auth/',
    ],
  },
  account: {
    tier: 'platform',
    dependsOn: ['activities', 'app', 'auth', 'files', 'messaging', 'realtime', 'users'],
    summary: 'Особисті налаштування користувача (/account, /user-settings) — субʼєкт з токена.',
    paths: [
      'apps/web/src/features/account/',
      'libs/contracts/src/account/',
      'apps/api/src/account/',
      'apps/platform-web/src/features/account/',
    ],
  },
  users: {
    tier: 'platform',
    dependsOn: [
      'account',
      'activities',
      'app',
      'auth',
      'files',
      'messaging',
      'notifications',
      'realtime',
    ],
    summary: 'Користувачі тенанта: адмінське CRUD, вибір користувача в UI.',
    paths: [
      'apps/web/src/features/users/',
      'libs/contracts/src/user/',
      'libs/shared/src/messaging/definitions/users.messages.ts',
      'apps/api/src/users/',
      'apps/worker/src/subscribers/welcome-email.subscriber.ts',
    ],
  },
  settings: {
    tier: 'platform',
    dependsOn: ['activities', 'app', 'auth', 'numbering', 'users'],
    summary: 'Налаштування організації (/settings): каркас секцій і загальні секції.',
    paths: [
      'apps/web/src/features/settings/',
      'libs/contracts/src/settings/',
      'apps/api/src/settings/',
    ],
  },
  files: {
    tier: 'platform',
    dependsOn: ['auth', 'messaging'],
    summary: 'S3-сховище: двофазне завантаження, мініатюри, прибирання сиріт.',
    paths: [
      'apps/web/src/features/files/',
      'libs/contracts/src/file/',
      'libs/shared/src/storage/',
      'libs/shared/src/messaging/definitions/files.messages.ts',
      'apps/api/src/files/',
      'apps/worker/src/subscribers/cleanup-orphan-files.subscriber.ts',
      'apps/worker/src/subscribers/generate-thumbnail.subscriber.ts',
    ],
  },
  notifications: {
    tier: 'platform',
    dependsOn: ['account', 'activities', 'auth', 'messaging', 'realtime'],
    summary: 'In-app інбокс, тости, відкладені нагадування (scheduled_notifications).',
    paths: [
      'apps/web/src/features/notifications/',
      'libs/contracts/src/notification/',
      'libs/shared/src/notifications/',
      'libs/shared/src/messaging/definitions/notifications.messages.ts',
      'apps/api/src/notifications/',
      'apps/worker/src/subscribers/dispatch-scheduled-notifications.subscriber.ts',
    ],
  },
  activities: {
    tier: 'platform',
    dependsOn: ['settings'],
    summary: 'Стрічка активності (activities / activity_links) і її рендеринг.',
    paths: [
      'apps/web/src/features/activities/',
      'libs/contracts/src/activity/',
      'libs/shared/src/activities/',
      'apps/api/src/activities/',
    ],
  },
  realtime: {
    tier: 'platform',
    dependsOn: ['app', 'auth', 'notifications'],
    summary: 'Socket.IO-шлюз, presence, last-seen.',
    paths: [
      'apps/web/src/features/realtime/',
      'libs/contracts/src/realtime/',
      'apps/api/src/realtime/',
      'apps/worker/src/realtime/',
    ],
  },
  messaging: {
    tier: 'platform',
    dependsOn: ['app'],
    summary: 'Події/команди поверх pg-boss, inbox, DLQ; моніторинг черг у control plane.',
    paths: [
      'libs/contracts/src/job/',
      'libs/shared/src/messaging/',
      'apps/worker/src/subscribers/cleanup-processed-jobs.subscriber.ts',
      'apps/platform-api/src/jobs/',
      'apps/platform-web/src/features/messaging/',
    ],
  },
  numbering: {
    tier: 'platform',
    dependsOn: ['settings'],
    summary: 'Людські номери записів (лічильник на тенант).',
    paths: [
      'apps/web/src/features/numbering/',
      'libs/contracts/src/numbering/',
      'libs/shared/src/numbering/',
    ],
  },
  tenants: {
    tier: 'platform',
    dependsOn: ['app', 'users'],
    summary: 'Control plane: тенанти та їхній перший адмін.',
    paths: [
      'libs/contracts/src/platform/tenant.schema.ts',
      'libs/contracts/src/platform/tenant.types.ts',
      'apps/platform-api/src/tenants/',
      'apps/platform-web/src/features/tenants/',
    ],
  },
  dashboard: {
    tier: 'platform',
    dependsOn: ['app'],
    summary: 'Стартовий екран із віджетами.',
    paths: ['apps/web/src/features/dashboard/'],
  },

  // ------------------------------------------------------------------- core
  customers: {
    tier: 'core',
    dependsOn: ['activities', 'app', 'auth', 'notifications', 'numbering', 'settings', 'users'],
    summary: 'Клієнти та їхні контакти — еталонний домен, є в кожному форку за замовчуванням.',
    paths: [
      'apps/web/src/features/dashboard/',
      'apps/web/src/features/customers/',
      'libs/contracts/src/customer/',
      'apps/api/src/customers/',
    ],
  },

  // ---------------------------------------------------------------- feature
  calendar: {
    tier: 'feature',
    dependsOn: [
      'activities',
      'app',
      'auth',
      'customers',
      'dashboard',
      'notifications',
      'realtime',
      'settings',
      'users',
    ],
    summary: 'Події, учасники, RSVP, нагадування. Опційний.',
    paths: [
      'apps/web/src/features/calendar/',
      'libs/contracts/src/calendar/',
      'apps/api/src/calendar/',
    ],
  },
  chat: {
    tier: 'feature',
    dependsOn: ['app', 'auth', 'files', 'tenants', 'users'],
    summary: 'Розмови між людьми (REST-зріз, docs/chat.md). Опційний.',
    paths: [
      'apps/web/src/features/chat/',
      'libs/contracts/src/chat/',
      'libs/shared/src/chat/',
      'apps/platform-api/src/chat/',
      'apps/api/src/chat/',
    ],
  },
  ai: {
    tier: 'feature',
    dependsOn: ['app', 'auth', 'messaging', 'realtime', 'settings'],
    summary: 'AI-асистент, база знань і платформні AI-контролі (обидва плани). Опційний.',
    paths: [
      'apps/web/src/features/ai/',
      'libs/contracts/src/ai/',
      'libs/contracts/src/platform/ai-*',
      'libs/shared/src/ai/',
      'libs/shared/src/messaging/definitions/ai.messages.ts',
      'apps/api/src/ai/',
      'apps/worker/src/ai/',
      'apps/worker/src/subscribers/ai-*',
      'apps/platform-api/src/ai-costs/',
      'apps/platform-api/src/ai-settings/',
      'apps/platform-web/src/features/ai/',
    ],
  },
  guide: {
    tier: 'feature',
    dependsOn: ['app'],
    summary: 'Внутрішній гайд по UI-кіту (демо, не продукт).',
    paths: ['apps/web/src/features/guide/'],
  },
  playground: {
    tier: 'feature',
    dependsOn: ['app', 'users'],
    summary: 'Пісочниця компонентів (демо, не продукт).',
    paths: ['apps/web/src/features/playground/'],
  },
} as const satisfies Record<string, ModuleDef>;

export type ModuleName = keyof typeof MODULES;

/**
 * Composition roots — єдині місця, яким дозволено знати список модулів: вони лише збирають
 * модулі докупи (Nest-модулі застосунку, роутер, ресурси i18n, barrel-и бібліотек, маніфест
 * черг). Логіки, що розгалужується за модулями, тут бути не повинно.
 */
export const COMPOSITION_ROOTS: readonly string[] = [
  'apps/api/src/app.module.ts',
  'apps/api/src/main.ts',
  'apps/api/src/openapi.ts',
  'apps/platform-api/src/app.module.ts',
  'apps/platform-api/src/main.ts',
  'apps/platform-api/src/openapi.ts',
  'apps/worker/src/worker.module.ts',
  'apps/worker/src/main.ts',
  'apps/web/src/main.tsx',
  'apps/web/src/router.tsx',
  'apps/web/src/slot-fills.ts',
  'apps/web/src/i18n/',
  'apps/web/src/app-shell/areas.tsx',
  'apps/web/src/app-shell/paths.ts',
  'apps/platform-web/src/main.tsx',
  'apps/platform-web/src/router.tsx',
  'apps/platform-web/src/i18n/',
  'apps/platform-web/src/app-shell/areas.tsx',
  'apps/platform-web/src/app-shell/paths.ts',
  'apps/web/src/components/form/index.ts',
  'libs/contracts/src/index.ts',
  'libs/contracts/src/bootstrap.schema.ts',
  'libs/contracts/src/activity-types.ts',
  'libs/contracts/src/notification-types.ts',
  'libs/contracts/src/socket-events.ts',
  'libs/database/prisma/seed.ts',
  'libs/contracts/src/*/index.ts',
  'libs/shared/src/index.ts',
  'libs/shared/src/*/index.ts',
  'libs/shared/src/messaging/topology.ts',
  'libs/shared/src/messaging/definitions/index.ts',
];

/** Не код модулів: згенероване, локалі, e2e. Юніт-тести (`*.test.ts`, `*.spec.ts`) і `*.d.ts`
 *  скрипт пропускає сам — тест може зібрати фікстури з будь-яких модулів. */
export const IGNORED: readonly string[] = [
  'libs/database/src/generated/',
  'apps/web/src/api/generated/',
  'apps/platform-web/src/api/generated/',
  'apps/web/src/locales/',
  'apps/platform-web/src/locales/',
  'apps/worker/src/locales/',
  'libs/i18n/src/locales/',
  'apps/api/test/',
  'apps/platform-api/test/',
  'apps/worker/test/',
];
