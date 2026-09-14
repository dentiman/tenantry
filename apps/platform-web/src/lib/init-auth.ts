import type { PlatformUserResponse } from '@saas-skeleton/contracts/platform';
import { axiosInstance, refreshTokens } from '../api/http-client';
import { useAuthStore } from '../stores/auth.store';

/** Ключ попередньої схеми (MVP MT-3, до AUTH-2) — access-токен у cookie/пам'яті тепер */
const LEGACY_ACCESS_TOKEN_KEY = 'saas_platform_access_token';

/**
 * Відновлення сесії при старті (AUTH-2, дзеркало tenant-web). Cookie ми з JS не
 * бачимо, тому спроба безумовна: анонімний відвідувач платить один зайвий 401.
 */
export async function initAuth(): Promise<void> {
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);

  try {
    await refreshTokens();
    const { data } = await axiosInstance.get<PlatformUserResponse>('/api/auth/me');
    useAuthStore.getState().setOperator(data);
  } catch {
    useAuthStore.getState().clearSession();
  }
}
