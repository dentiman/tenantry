import { defineConfig } from 'vitest/config';

/**
 * Той самий мінімальний конфіг, що в `apps/web/vitest.config.ts`:
 * `environment: 'node'`, лише чисті функції, jsdom/happy-dom свідомо не підключені.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` — рендер-тести через `renderToStaticMarkup`, DOM для них не потрібен
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
