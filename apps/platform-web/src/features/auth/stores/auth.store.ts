import { create } from 'zustand';
import type { PlatformUserResponse } from '@saas-skeleton/contracts/platform';

/**
 * AUTH-2: дзеркало tenant-web — access-токен тільки в пам'яті, refresh у httpOnly
 * cookie (`saas_platform_refresh`, `Path=/api/auth`), недоступній JS. До цього
 * (MVP MT-3) тут не було refresh-механіки взагалі, і access-токен (60m) свідомо
 * зберігався напряму в `localStorage`, щоб сесія не губилася на F5 — тепер це
 * робить `POST /auth/refresh` при старті (`init-auth.ts`), і localStorage не потрібен.
 */
interface AuthState {
  operator: PlatformUserResponse | null;
  accessToken: string | null;
  setSession: (operator: PlatformUserResponse, accessToken: string) => void;
  setToken: (accessToken: string) => void;
  setOperator: (operator: PlatformUserResponse) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  operator: null,
  accessToken: null,
  setSession: (operator, accessToken) => {
    set({ operator, accessToken });
  },
  setToken: (accessToken) => {
    set({ accessToken });
  },
  setOperator: (operator) => {
    set({ operator });
  },
  clearSession: () => {
    set({ operator: null, accessToken: null });
  },
}));
