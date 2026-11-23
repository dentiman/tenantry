import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { AuthTokens } from '@saas-skeleton/contracts';
import {
  attachIdempotencyKey,
  createIdempotencyKeys,
  settleIdempotencyKey,
} from '@saas-skeleton/ui/api/idempotency';
import { TRACEPARENT_HEADER, ensureTraceparent, newTraceparent } from '@saas-skeleton/ui/api/trace-context';
import { useAuthStore } from '../features/auth/stores/auth.store';

// AUTH-2: withCredentials — без нього браузер не покладе httpOnly refresh-cookie
// в запит до /api/auth/refresh (same-origin через dev-проксі/nginx, CORS тут не
// заважає, credentials: true на бекенді покриває нестандартні розгортання)
export const axiosInstance = axios.create({ baseURL: '/', withCredentials: true });

// Idempotency-Key (docs/idempotency.md): один реєстр на вкладку — ключ живе, поки той самий
// POST летить або лишився без певної відповіді
const idempotencyKeys = createIdempotencyKeys();

axiosInstance.interceptors.request.use((config) => {
  // id операції для наскрізного пошуку в логах (бекенд бере з нього trace-id запиту)
  ensureTraceparent(config.headers);
  // Повтор того самого POST (подвійний клік, сабміт після втраченої відповіді) піде з тим
  // самим ключем, і сервер не створить другий запис
  attachIdempotencyKey(idempotencyKeys, config);
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** `code` з ApiError-envelope, якщо тіло відповіді ним є */
function apiErrorCodeOf(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    return typeof body.code === 'string' ? body.code : null;
  }
  return null;
}

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
      { withCredentials: true, headers: { [TRACEPARENT_HEADER]: newTraceparent() } },
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
  (response) => {
    settleIdempotencyKey(idempotencyKeys, response.config, { status: response.status });
    return response;
  },
  async (error: AxiosError) => {
    // 401 ключ НЕ забуває: нижче той самий запит буде повторено після refresh токена
    settleIdempotencyKey(idempotencyKeys, error.config, {
      status: error.response?.status ?? null,
      code: apiErrorCodeOf(error.response?.data),
    });
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
