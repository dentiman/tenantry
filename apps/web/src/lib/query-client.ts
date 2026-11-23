import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/**
 * Єдиний QueryClient застосунку. Глобальну політику помилок (`onGlobalError`: network/5xx/403 →
 * тост) задає `main.tsx`; тут — лише те, КОЛИ її не кликати.
 *
 * `meta.silentError` — опт-аут із глобального тоста для викликів, чия відмова є легальним
 * станом UI, а не подією для юзера (presence: «невідомо»; надсилання в чаті: рядок «не
 * надіслано» вже є повідомленням про ту саму помилку). Діє і на запити, і на мутації: раніше
 * прапорець читав лише `QueryCache`, тож мутації з ним усе одно показували тост.
 */
export function createAppQueryClient(onGlobalError: (error: unknown) => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.silentError === true) {
          return;
        }
        onGlobalError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.silentError === true) {
          return;
        }
        onGlobalError(error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}
