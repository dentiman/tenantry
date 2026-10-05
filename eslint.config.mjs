import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

// Межі залежностей (docs/backend-conventions.md §1–§2). Flat config не зливає опції одного
// правила між блоками — пізніший блок ЗАМІНЮЄ ранішній, — тому кожен набір файлів нижче
// отримує свій повний список заборон, а набори не перетинаються.
const CROSS_APP = {
  group: [
    '**/api/src/**',
    '**/platform-api/src/**',
    '**/worker/src/**',
    '**/web/src/**',
    '**/platform-web/src/**',
  ],
  message:
    'Імпорт з іншої апки заборонений. Спільний код — у libs/* (shared/contracts/database/ui).',
};
const fromSiblingModule = (suffixes) =>
  suffixes.flatMap((suffix) => [`../*/*${suffix}`, `../../*/*${suffix}`]);
const MODULE_INTERNALS = {
  group: fromSiblingModule([
    '.controller',
    '.access',
    '-access.service',
    '.subscriber',
    '.gateway',
  ]),
  message:
    'Внутрішній файл чужого модуля. Публічний API модуля — exports його *.module.ts, плюс mapper/dto/decorators (docs/backend-conventions.md §1).',
};
const BACKEND_LIBS = {
  group: [
    '@saas-skeleton/database',
    '@saas-skeleton/database/*',
    '@saas-skeleton/shared',
    '@saas-skeleton/shared/*',
  ],
  message: 'Backend-бібліотека у фронтенді затягне Prisma/серверний код у браузерний бандл.',
};
const ANY_WORKSPACE_LIB = {
  group: ['@saas-skeleton/*'],
  message: 'contracts, database та i18n — листки графа бібліотек і не залежать від інших libs.',
};
const FRONTEND_LIBS = {
  group: [
    '@saas-skeleton/ui',
    '@saas-skeleton/ui/*',
    '@saas-skeleton/i18n',
    '@saas-skeleton/i18n/*',
  ],
  message: 'libs/shared — серверний шар; UI/i18n фронтендів йому не належать.',
};
const restrictImports = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/.turbo/',
      '**/coverage/',
      '**/generated/',
      '**/prisma.config.ts',
      '**/*.js',
      '**/*.mjs',
      '**/test/**/*.e2e-spec.ts',
      'apps/web/src/api/generated/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'interface', format: ['PascalCase'] },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
      ],
    },
  },
  {
    // React-код: явні типи повернення для компонентів — зайвий шум
    files: [
      'apps/web/**/*.{ts,tsx}',
      'apps/platform-web/**/*.{ts,tsx}',
      'libs/ui/src/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Вендорений код реєстру shadcn (`shadcn add` кладе його сюди й ним же оновлює через
    // `--diff`). Правити стиль під наш конфіг = вічні конфлікти з апстрімом, тому гасимо
    // рівно ті правила, які реально стріляють; файли НЕ в ignores — вони наші, ми їх редагуємо
    files: ['libs/ui/src/components/ui/**/*.{ts,tsx}', 'libs/ui/src/hooks/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Додалися з примітивами UI-1 (sidebar, toggle-group, use-mobile) — теж стилістика апстріму
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },
  {
    // MT-1 (§6 multi-tenancy-plan.md): голий $transaction обходить tenant-extension —
    // транзакції в доменному коді ТІЛЬКИ через TenantTransactions.withTenantTx
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='$transaction']",
          message:
            'Голий $transaction обходить tenant-контекст (set_config). Використовуй TenantTransactions.withTenantTx з @saas-skeleton/database.',
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts', 'apps/platform-api/src/**/*.ts'],
    rules: restrictImports(CROSS_APP, MODULE_INTERNALS),
  },
  {
    files: ['apps/worker/src/**/*.ts'],
    rules: restrictImports(CROSS_APP),
  },
  {
    files: [
      'apps/web/**/*.{ts,tsx}',
      'apps/platform-web/**/*.{ts,tsx}',
      'libs/ui/src/**/*.{ts,tsx}',
    ],
    rules: restrictImports(CROSS_APP, BACKEND_LIBS),
  },
  {
    files: ['libs/contracts/src/**/*.ts', 'libs/database/src/**/*.ts', 'libs/i18n/src/**/*.ts'],
    rules: restrictImports(CROSS_APP, ANY_WORKSPACE_LIB),
  },
  {
    files: ['libs/shared/src/**/*.ts'],
    rules: restrictImports(CROSS_APP, FRONTEND_LIBS),
  },
);
