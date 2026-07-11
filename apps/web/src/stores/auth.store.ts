import { create } from 'zustand';
import type { UserResponse, AuthTokens } from '@saas-skeleton/contracts';

const REFRESH_TOKEN_KEY = 'saas_refresh_token';

interface AuthState {
  user: UserResponse | null;
  /** Access-токен живе тільки в пам'яті; у localStorage — лише refresh */
  accessToken: string | null;
  setSession: (user: UserResponse, tokens: AuthTokens) => void;
  setTokens: (tokens: AuthTokens) => void;
  setUser: (user: UserResponse) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  setSession: (user, tokens) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    set({ user, accessToken: tokens.accessToken });
  },
  setTokens: (tokens) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    set({ accessToken: tokens.accessToken });
  },
  setUser: (user) => {
    set({ user });
  },
  clearSession: () => {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null });
  },
}));

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}
