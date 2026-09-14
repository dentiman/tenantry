import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Workspace slots (docs/workspace-slots.md): той самий підхід, що apps/web/vite.config.ts —
  // читаємо кореневий .env/.env.local, а не .env цього застосунку (якого нема).
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const port = Number(rootEnv.PLATFORM_WEB_PORT ?? '5174');
  const apiTarget = `http://localhost:${rootEnv.PLATFORM_PORT ?? '3002'}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      // Vite не читає tsconfig paths — аліас @ дублюється тут (див. tsconfig.json)
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
