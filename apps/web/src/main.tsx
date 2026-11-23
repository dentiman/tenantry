import { StrictMode, useCallback, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { UiThemeProvider } from '@saas-skeleton/ui/themes';
import { router } from './router';
import { initAuth } from './features/auth/lib/init-auth';
import { isGlobalApiError, parseApiError } from '@saas-skeleton/ui/api/api-error';
import { showApiErrorToast } from '@saas-skeleton/ui/lib/error-toast';
import { reportError } from '@saas-skeleton/ui/lib/report-error';
import { initSocket } from './features/realtime/socket';
import { initPresenceSync } from './features/realtime/presence-sync';
import { initNotificationSync } from './features/notifications/realtime/notification-sync';
import { initCalendarSync } from './features/calendar/realtime/calendar-sync';
import { initAiSync } from './features/ai/realtime/ai-sync';
import { initChatSync } from './features/chat/realtime/chat-sync';
import { initUserOperationsSync } from './features/user-operations/user-operations-sync';
import { downloadUserOperationResult } from './features/user-operations/user-operations.source';
import { registerEntityAction } from './lib/entity-actions';
import { useSettingsBootstrap } from './api/generated/api';
import { NavProvider } from '@saas-skeleton/ui/navigation';
import { isAllowed } from './features/auth/auth.access';
import { useAuthStore } from './features/auth/stores/auth.store';
import { createAppQueryClient } from './lib/query-client';
import { SlotsProvider } from './lib/slots';
import { NAVIGATION } from './nav';
import { SLOT_FILLS } from './slot-fills';
import { initErrorReporting } from './lib/error-reporting';
import './i18n';
import './index.css';

// Глобальна політика: network/5xx/403 → toast; 401 гасить refresh-інтерсептор;
// решта 4xx — відповідальність місця виклику (форми через applyServerError)
function handleGlobalError(error: unknown): void {
  const parsed = parseApiError(error);
  if (isGlobalApiError(parsed)) {
    showApiErrorToast(parsed);
  }
  // Мережа й 5xx — до збирача помилок разом з id запиту; 403/429 — не дефект, а відповідь
  if (parsed.status === null || parsed.status >= 500) {
    reportError({
      error,
      source: 'api',
      context: { requestId: parsed.requestId, status: parsed.status, code: parsed.code },
    });
  }
}

// meta.silentError (опт-аут із глобального тоста) — у `lib/query-client.ts`
const queryClient = createAppQueryClient(handleGlobalError);

/** Стабільне посилання: новий `{}` на кожен рендер перебудовував би предикат і всю навігацію */
const NO_FEATURES: Readonly<Record<string, boolean>> = {};

/** Реєстр навігації + предикат доступу, привʼязаний до поточного юзера (docs/modules.md §4) */
function AppNavProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  // Прапорці фіч ховають розділи вимкнених фіч (`staticData.access.feature`). Той самий
  // кеш bootstrap, що в `useAiEnabled`; без сесії запиту немає
  const { data: bootstrap } = useSettingsBootstrap({
    query: { enabled: user !== null, staleTime: Number.POSITIVE_INFINITY },
  });
  const features = user ? (bootstrap?.features ?? NO_FEATURES) : undefined;
  const allow = useCallback(
    (access: unknown) => isAllowed(access, user, features),
    [user, features],
  );
  return (
    <NavProvider navigation={NAVIGATION} allow={allow}>
      {children}
    </NavProvider>
  );
}

async function bootstrap(): Promise<void> {
  // Збирач помилок — до всього іншого, щоб перша ж помилка не загубилась (lib/error-reporting.ts)
  initErrorReporting(() => useAuthStore.getState().user?.id);

  // Сесія відновлюється до першого рендера — guards бачать актуальний стан
  await initAuth();

  // Realtime піднімається ПОЗА React-деревом і до першого рендера: підписки не
  // мають залежати від монтування компонентів, а StrictMode не має права
  // створити другий socket
  initSocket();
  initPresenceSync(queryClient);
  initNotificationSync(queryClient);
  initCalendarSync(queryClient);
  initAiSync(queryClient);
  initChatSync(queryClient);
  initUserOperationsSync();
  // Клік по сповіщенню «експорт готовий» завантажує файл: у операції немає сторінки
  registerEntityAction('user_operation', (id) => {
    void downloadUserOperationResult(id);
  });

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
            {/* Внески фіч у модулі нижче — docs/modules.md §4 */}
            <SlotsProvider fills={SLOT_FILLS}>
              <AppNavProvider>
                <RouterProvider router={router} />
              </AppNavProvider>
            </SlotsProvider>
          </QueryClientProvider>
        </UiThemeProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
