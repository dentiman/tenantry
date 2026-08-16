import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { router } from './router';
import { initAuth } from './lib/init-auth';
import { isGlobalApiError, parseApiError } from './api/api-error';
import { showApiErrorToast } from './lib/error-toast';
import { initSocket } from './realtime/socket';
import { initPresenceSync } from './realtime/presence-sync';
import { initNotificationSync } from './realtime/notification-sync';
import './i18n';
import './index.css';

// Глобальна політика: network/5xx/403 → toast; 401 гасить refresh-інтерсептор;
// решта 4xx — відповідальність місця виклику (форми через applyServerError)
function handleGlobalError(error: unknown): void {
  const parsed = parseApiError(error);
  if (isGlobalApiError(parsed)) {
    showApiErrorToast(parsed);
  }
}

const queryClient = new QueryClient({
  // meta.silentError — опт-аут із глобального тоста для запитів, чия відмова є
  // легальним станом UI, а не подією для юзера (presence: «невідомо» замість тоста)
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.silentError === true) {
        return;
      }
      handleGlobalError(error);
    },
  }),
  mutationCache: new MutationCache({ onError: handleGlobalError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

async function bootstrap(): Promise<void> {
  // Сесія відновлюється до першого рендера — guards бачать актуальний стан
  await initAuth();

  // Realtime піднімається ПОЗА React-деревом і до першого рендера: підписки не
  // мають залежати від монтування компонентів, а StrictMode не має права
  // створити другий socket
  initSocket();
  initPresenceSync(queryClient);
  initNotificationSync(queryClient);

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }

  createRoot(rootElement).render(
    <StrictMode>
      {/* HeroUI v3 очікує class + data-theme на <html>; system — стартове значення */}
      <ThemeProvider
        attribute={['class', 'data-theme']}
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="saas_theme"
      >
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
