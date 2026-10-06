import { create } from 'zustand';
import type { UserResponse, AuthTokens } from '@saas-skeleton/contracts';

/**
 * AUTH-2: refresh-токен більше НІКОЛИ не потрапляє на цей бік — сервер тримає
 * його в httpOnly cookie (`saas_refresh`, `Path=/api/auth`), недоступній JS.
 * Стор тримає лише те, що фронту фізично потрібно в пам'яті: юзера і
 * access-токен (обидва помруть на перезавантаженні — і це навмисно, `initAuth`
 * відновлює їх через `POST /auth/refresh`, який cookie вже несе сам).
 */
interface AuthState {
  user: UserResponse | null;
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
    set({ user, accessToken: tokens.accessToken });
  },
  setTokens: (tokens) => {
    set({ accessToken: tokens.accessToken });
  },
  setUser: (user) => {
    set({ user });
  },
  clearSession: () => {
    set({ user: null, accessToken: null });
  },
}));
