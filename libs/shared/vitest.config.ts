import { defineConfig } from 'vitest/config';

/**
 * Той самий мінімальний конфіг, що в `libs/ui/vitest.config.ts` і
 * `apps/web/vitest.config.ts`: `environment: 'node'`, жодного підключення до БД.
 *
 * `tsconfigRaw` — як в `apps/worker/vitest.config.ts`: тести AI-2a.3 тягнуть
 * `@saas-skeleton/database` (TS-джерела іншого пакета), і esbuild шукає tsconfig поруч
 * із кожним файлом, а не наш. Без цього Nest-клас із параметр-декоратором
 * (`@Inject`, `@Optional`) не трансформується.
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
