import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
