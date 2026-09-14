/**
 * Окреме з'єднання під лічильники throttler-а (AUTH-2, дзеркало apps/api/src/redis).
 * БЕЗ offline-черги: throttler працює fail-open, і йому потрібна швидка помилка,
 * а не команда, що висить у черзі й підвішує логін. platform-api не має realtime-
 * гейтвея, тому тут це ЄДИНИЙ клієнт Valkey процесу.
 */
export const REDIS_THROTTLER_CLIENT = Symbol('REDIS_THROTTLER_CLIENT');
