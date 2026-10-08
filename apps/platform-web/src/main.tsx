import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { UiThemeProvider } from '@saas-skeleton/ui/themes';
import { NavProvider } from '@saas-skeleton/ui/navigation';
import { isAllowed } from './features/auth/auth.access';
import { NAVIGATION } from './nav';
import { router } from './router';
import { initAuth } from './features/auth/lib/init-auth';
import { isGlobalApiError, parseApiError } from '@saas-skeleton/ui/api/api-error';
import { showApiErrorToast } from '@saas-skeleton/ui/lib/error-toast';
import './i18n';
import './index.css';

// Глобальна політика: network/5xx/403 → toast; 401 закінчує сесію (interceptor);
// решта 4xx — відповідальність місця виклику (форми через applyServerError)
function handleGlobalError(error: unknown): void {
  const parsed = parseApiError(error);
  if (isGlobalApiError(parsed)) {
    showApiErrorToast(parsed);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalError }),
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

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }

  createRoot(rootElement).render(
    <StrictMode>
      {/* shadcn/Tailwind читає тему з класу .dark на <html>; system — стартове значення */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="saas_platform_theme"
      >
        {/* Друга вісь теми: режим тримає next-themes (клас), палітру — цей
            провайдер (атрибут data-theme). Див. docs/frontend/theming.md */}
        <UiThemeProvider storageKey="saas_platform_theme_palette">
          <QueryClientProvider client={queryClient}>
            <NavProvider navigation={NAVIGATION} allow={isAllowed}>
              <RouterProvider router={router} />
            </NavProvider>
          </QueryClientProvider>
        </UiThemeProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
