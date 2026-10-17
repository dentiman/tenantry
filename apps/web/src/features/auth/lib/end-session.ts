import { authLogout } from '../../../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

/** Скільки чекаємо на `POST /auth/logout`, перш ніж піти без відповіді */
const LOGOUT_TIMEOUT_MS = 3_000;

/**
 * Єдиний вихід із сесії (кнопка «Вийти», завершення поточного пристрою). Закінчується
 * ПОВНИМ перезавантаженням документа, а не SPA-навігацією: кеш TanStack Query
 * (ключі без identity, bootstrap зі `staleTime: Infinity`), feature-стори (чат-outbox,
 * typing, AI-панель) і незавершені запити живуть у памʼяті вкладки, і наступний
 * користувач — інший тенант на демо-стенді — побачив би їх до ручного оновлення.
 * Перезавантаження прибирає все одразу, і auth не мусить знати про стори фіч.
 * Той самий шлях уже бере interceptor у `http-client.ts`, коли refresh не вдався.
 *
 * На `POST /auth/logout` ЧЕКАЄМО (з таймаутом): перезавантаження обірвало б запит, а
 * `initAuth` після нього відновив би сесію з cookie, яку сервер так і не відкликав.
 * Endpoint ідемпотентний (вже відкликана сесія — теж 204) і завжди стирає cookie, тому
 * його кличемо й тоді, коли сесію щойно відкликали з `/user-settings/security`.
 * Помилку ковтаємо — вихід не залежить від мережі, а глобальний MutationCache
 * показав би тост (тому згенерована функція, не хук).
 */
export async function endSession(): Promise<void> {
  await authLogout({}, undefined, AbortSignal.timeout(LOGOUT_TIMEOUT_MS)).catch(() => undefined);
  useAuthStore.getState().clearSession();
  window.location.assign('/login');
}
