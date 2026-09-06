import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { UiThemeProvider } from '@saas-skeleton/ui/themes';
import { router } from './router';
import { initAuth } from './lib/init-auth';
import { isGlobalApiError, parseApiError } from '@saas-skeleton/ui/api/api-error';
import { showApiErrorToast } from '@saas-skeleton/ui/lib/error-toast';
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
      {/* shadcn/Tailwind очікує лише class на <html>; system — стартове значення */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="saas_theme"
      >
        {/* Друга вісь теми: режим тримає next-themes (клас), палітру — цей
            провайдер (атрибут data-theme). Див. docs/frontend/theming.md */}
        <UiThemeProvider storageKey="saas_theme_palette">
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </UiThemeProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
