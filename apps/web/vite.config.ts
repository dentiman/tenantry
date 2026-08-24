import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite не читає tsconfig paths — аліас дублюється тут (див. коментар у tsconfig.json)
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // RT-0: Socket.IO. Окреме правило з ws:true — без нього dev-proxy проксить лише
      // HTTP-запити, а HTTP Upgrade до WebSocket не пропускає (клієнт вічно реконектиться).
      // changeOrigin НЕ ставимо: гейтвей звіряє Origin через allowRequest, і підміна
      // на localhost:3001 не пройшла б REALTIME_ALLOWED_ORIGINS.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
