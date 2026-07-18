import { create } from 'zustand';
import type { PlatformUserResponse } from '@saas-skeleton/contracts/platform';

const ACCESS_TOKEN_KEY = 'saas_platform_access_token';

/**
 * MT-3: platform-auth — MVP свідомо без refresh-механіки (операторів мало,
 * перелогін прийнятний; access-токен живе 60m — див. platform-auth.module.ts).
 * Тому, на відміну від tenant-web (accessToken тільки в пам'яті + refresh
 * у localStorage), тут access-токен зберігається напряму в localStorage —
 * інакше сесія губилася б на кожен F5. Свідомий trade-off для внутрішнього
 * операторського інструменту; якщо platform-auth отримає refresh (за патерном
 * tenant-api), цей стор варто привести до того самого візерунка.
 */
interface AuthState {
  operator: PlatformUserResponse | null;
  accessToken: string | null;
  setSession: (operator: PlatformUserResponse, accessToken: string) => void;
  setOperator: (operator: PlatformUserResponse) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  operator: null,
  accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
  setSession: (operator, accessToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    set({ operator, accessToken });
  },
  setOperator: (operator) => {
    set({ operator });
  },
  clearSession: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    set({ operator: null, accessToken: null });
  },
}));

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}
