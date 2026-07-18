import type { PlatformUserResponse } from '@saas-skeleton/contracts/platform';
import { axiosInstance } from '../api/http-client';
import { getStoredAccessToken, useAuthStore } from '../stores/auth.store';

/**
 * Відновлення сесії при старті: токен уже в сторі (init з localStorage),
 * тут лише звіряємо його з бекендом і тягнемо профіль. Немає окремого
 * refresh-кроку (platform-auth MVP — див. auth.store.ts).
 */
export async function initAuth(): Promise<void> {
  if (!getStoredAccessToken()) {
    return;
  }
  try {
    const { data } = await axiosInstance.get<PlatformUserResponse>('/api/auth/me');
    useAuthStore.getState().setOperator(data);
  } catch {
    useAuthStore.getState().clearSession();
  }
}
