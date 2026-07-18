import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store';

export const axiosInstance = axios.create({ baseURL: '/' });

axiosInstance.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Без refresh-механіки (platform-auth MVP — див. auth.store.ts): 401 просто
// закінчує сесію і повертає на /login, single-flight refresh тут не потрібен.
// /auth/login виключено — його 401 (невірні креденшели) мусить дійти до форми,
// а не тригерити hard-redirect (інакше "невірний пароль" перезавантажує сторінку)
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      useAuthStore.getState().clearSession();
      window.location.assign('/login');
    }
    throw error;
  },
);

/** Mutator для orval: генеровані хуки викликають API через цей інстанс */
export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => axiosInstance({ ...config, ...options }).then((r) => r.data as T);
