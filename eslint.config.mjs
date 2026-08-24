import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

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
);
