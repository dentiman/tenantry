import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Workspace slots (docs/workspace-slots.md): порти й ціль проксі беруть зсув від
  // кореневого .env/.env.local (той самий каскад, що @nestjs/config у бекендах) —
  // порожній prefix, інакше loadEnv віддав би лише VITE_*-змінні.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const port = Number(rootEnv.WEB_PORT ?? '5173');
  // Claude preview інжектить generic PORT для самого Vite-процесу; API_PORT не дає
  // сприйняти цей порт як адресу tenant API у non-zero workspace slot. Формульний
  // fallback покриває старі .env.local, створені до появи API_PORT.
  const workspaceSlot = Number(rootEnv.WORKSPACE_SLOT ?? '0');
  const workspaceApiPort =
    Number.isInteger(workspaceSlot) && workspaceSlot > 0 ? 3001 + 100 * workspaceSlot : undefined;
  const apiTarget = `http://localhost:${String(rootEnv.API_PORT ?? workspaceApiPort ?? rootEnv.PORT ?? '3001')}`;

  // Версія й історія для футера шела (scripts/build-info.ts, docs/build-info.md): скрипт
  // віддає JSON у stdout, тож vite.config не імпортує .ts поза власним tsconfig
  const buildInfo = execFileSync(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      path.resolve(__dirname, '../../scripts/build-info.ts'),
    ],
    { encoding: 'utf8', env: { ...process.env, ...rootEnv } },
  );

  return {
    plugins: [react(), tailwindcss()],
    define: { __APP_BUILD__: buildInfo },
    // Vite не читає tsconfig paths — аліас дублюється тут (див. коментар у tsconfig.json)
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
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
