import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Workspace slots (docs/workspace-slots.md): порти й ціль проксі беруть зсув від
  // кореневого .env/.env.local (той самий каскад, що @nestjs/config у бекендах) —
  // порожній prefix, інакше loadEnv віддав би лише VITE_*-змінні.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const port = Number(rootEnv.WEB_PORT ?? '5173');
  const apiTarget = `http://localhost:${rootEnv.PORT ?? '3001'}`;

  return {
    plugins: [react(), tailwindcss()],
    // Vite не читає tsconfig paths — аліас дублюється тут (див. коментар у tsconfig.json)
    resolve: {
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
        // RT-0: Socket.IO. Окреме правило з ws:true — без нього dev-proxy проксить лише
        // HTTP-запити, а HTTP Upgrade до WebSocket не пропускає (клієнт вічно реконектиться).
        // changeOrigin НЕ ставимо: гейтвей звіряє Origin через allowRequest, і підміна
        // на apiTarget не пройшла б REALTIME_ALLOWED_ORIGINS.
        '/socket.io': {
          target: apiTarget,
          ws: true,
        },
      },
    },
  };
});
