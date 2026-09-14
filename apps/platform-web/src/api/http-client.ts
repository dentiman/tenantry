import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import type { PlatformAuthTokens } from '@saas-skeleton/contracts/platform';
import { useAuthStore } from '../stores/auth.store';

// AUTH-2: withCredentials — без нього браузер не покладе httpOnly refresh-cookie
// в запит до /api/auth/refresh
export const axiosInstance = axios.create({ baseURL: '/', withCredentials: true });

axiosInstance.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<PlatformAuthTokens> | null = null;

/** Single-flight refresh — той самий патерн, що apps/web/src/api/http-client.ts */
export async function refreshTokens(): Promise<PlatformAuthTokens> {
  refreshPromise ??= (async () => {
    const { data } = await axios.post<PlatformAuthTokens>(
      '/api/auth/refresh',
      {},
      { withCredentials: true },
    );
    useAuthStore.getState().setToken(data.accessToken);
    return data;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

const AUTH_URLS = ['/auth/login', '/auth/refresh'];

// AUTH-2: 401 тепер намагається оновитись через refresh-cookie ПЕРЕД hard-redirect —
// той самий цикл, що tenant-web. /auth/login лишається винятком: його 401 (невірні
// креденшели) мусить дійти до форми, а не тригерити редірект
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
