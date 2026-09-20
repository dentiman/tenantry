import { defineConfig } from 'vitest/config';

/**
 * Той самий мінімальний конфіг, що в `libs/ui/vitest.config.ts` і
 * `apps/web/vitest.config.ts`: `environment: 'node'`, лише чисті функції.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
