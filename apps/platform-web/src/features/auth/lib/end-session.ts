import { platformAuthLogout } from '../../../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

/** Скільки чекаємо на `POST /auth/logout`, перш ніж піти без відповіді */
const LOGOUT_TIMEOUT_MS = 3_000;

/**
 * Вихід оператора — дзеркало `apps/web/src/features/auth/lib/end-session.ts`: дочекатися
 * logout (з таймаутом, інакше перезавантаження обірве запит і `initAuth` відновить сесію з
 * невідкликаної cookie) і перезавантажити документ, щоб кеш TanStack Query попереднього
 * оператора не дожив до наступного входу в тій самій вкладці.
 */
export async function endSession(): Promise<void> {
  await platformAuthLogout(undefined, AbortSignal.timeout(LOGOUT_TIMEOUT_MS)).catch(
    () => undefined,
  );
  useAuthStore.getState().clearSession();
  window.location.assign('/login');
}
