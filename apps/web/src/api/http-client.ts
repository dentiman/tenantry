import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { AuthTokens } from '@saas-skeleton/contracts';
import { useAuthStore } from '../features/auth/stores/auth.store';

// AUTH-2: withCredentials — без нього браузер не покладе httpOnly refresh-cookie
// в запит до /api/auth/refresh (same-origin через dev-проксі/nginx, CORS тут не
// заважає, credentials: true на бекенді покриває нестандартні розгортання)
export const axiosInstance = axios.create({ baseURL: '/', withCredentials: true });

axiosInstance.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<AuthTokens> | null = null;

/**
 * Single-flight: паралельні 401 чекають на один спільний refresh. AUTH-2: токен
 * більше не читається зі сховища — його несе httpOnly cookie, тіло порожнє.
 */
export async function refreshTokens(): Promise<AuthTokens> {
  refreshPromise ??= (async () => {
    // Сирий axios (без інтерсепторів), щоб 401 від refresh не зациклився
    const { data } = await axios.post<AuthTokens>(
      '/api/auth/refresh',
      {},
      { withCredentials: true },
    );
    useAuthStore.getState().setTokens(data);
    return data;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

const AUTH_URLS = ['/auth/login', '/auth/refresh'];

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = original?.url ?? '';
    const isAuthUrl = AUTH_URLS.some((p) => url.includes(p));

    if (error.response?.status === 401 && original && !original._retry && !isAuthUrl) {
      original._retry = true;
      try {
        await refreshTokens();
        return await axiosInstance(original);
      } catch {
        useAuthStore.getState().clearSession();
        window.location.assign('/login');
      }
    }
    throw error;
  },
);

/** Mutator для orval: генеровані хуки викликають API через цей інстанс */
export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => axiosInstance({ ...config, ...options }).then((r) => r.data as T);
