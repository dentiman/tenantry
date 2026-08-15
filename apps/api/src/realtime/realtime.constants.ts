/** DI-токени realtime-шару (значення, не класи — тому рядкові символи) */
export const REALTIME_CONFIG = Symbol('REALTIME_CONFIG');
export const REALTIME_REDIS = Symbol('REALTIME_REDIS');

/**
 * Room-и. Префікс tenant-а обовʼязковий: `user:{userId}` без нього дав би одному
 * і тому самому імені room-у в різних тенантах — а adapter розносить broadcast
 * по імені, не звіряючись із tenant-контекстом. У назвах немає email/імені:
 * room-и видно в adapter-трафіку і в дампах Valkey.
 */
export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;
export const userRoom = (tenantId: string, userId: string): string =>
  `tenant:${tenantId}:user:${userId}`;

/** За скільки до `exp` сервер просить клієнта оновити access-токен */
export const AUTH_EXPIRY_WARNING_MS = 60_000;
