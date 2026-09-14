import type { MeResponse } from '@saas-skeleton/contracts';
import { axiosInstance, refreshTokens } from '../api/http-client';
import { useAuthStore } from '../stores/auth.store';

/** Ключ попередньої схеми (до AUTH-2) — токен у cookie, у localStorage йому не місце */
const LEGACY_REFRESH_TOKEN_KEY = 'saas_refresh_token';

/**
 * Відновлення сесії при старті (AUTH-2). Cookie ми з JS не бачимо, тож маркера
 * «здається, залогінені» немає і бути не може — він рано чи пізно розійшовся б
 * із реальністю. Спроба БЕЗУМОВНА: холодний старт анонімного відвідувача
 * коштує один зайвий 401 (сервер відповість ним, якщо cookie немає), і це
 * дешевше за будь-яке сховище стану на клієнті.
 */
export async function initAuth(): Promise<void> {
  // Одноразове прибирання токена зі старої схеми (до AUTH-2)
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);

  try {
    await refreshTokens();
    const { data } = await axiosInstance.get<MeResponse>('/api/auth/me');
    useAuthStore.getState().setUser(data);
  } catch {
    useAuthStore.getState().clearSession();
  }
}
