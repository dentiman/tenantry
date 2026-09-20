import { defineConfig } from 'vitest/config';

/**
 * Той самий мінімальний конфіг, що в `libs/shared`, `libs/ui` і `apps/web`:
 * `environment: 'node'`, жодного підключення до БД чи брокера.
 *
 * Що тут тестується: життєвий цикл генерації відповіді асистента — межі
 * транзакцій, порядок дельт, скасування, відмови, ретрай. Prisma і емітер
 * підмінюються заглушками, провайдер — справжній `FakeLlmProvider`.
 *
 * `tsconfigRaw` обовʼязковий: тести тягнуть `@saas-skeleton/shared` і
 * `@saas-skeleton/database`, тобто TS-джерела з ІНШИХ пакетів, і esbuild шукає
 * tsconfig поруч із кожним файлом, а не наш. Без цього будь-який Nest-клас із
 * параметр-декоратором (`@Inject`, `@Optional`) не трансформується.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
