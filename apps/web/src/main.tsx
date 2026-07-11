import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { router } from './router';
import { initAuth } from './lib/init-auth';
import './index.css';

const queryClient = new QueryClient({
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
