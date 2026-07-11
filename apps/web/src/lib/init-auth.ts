import type { MeResponse } from '@saas-skeleton/contracts';
import { axiosInstance, refreshTokens } from '../api/http-client';
import { useAuthStore, getStoredRefreshToken } from '../stores/auth.store';

/** Відновлення сесії при старті: refresh-токен з localStorage → нова пара токенів → профіль */
export async function initAuth(): Promise<void> {
  if (!getStoredRefreshToken()) {
    return;
  }
  try {
    await refreshTokens();
    const { data } = await axiosInstance.get<MeResponse>('/api/auth/me');
    useAuthStore.getState().setUser(data);
  } catch {
    useAuthStore.getState().clearSession();
  }
}
