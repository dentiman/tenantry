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
// закінчує сесію і повертає на /login, single-flight refresh тут не потрібен
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
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
