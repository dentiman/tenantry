/**
 * Основний клієнт Valkey процесу: realtime-адаптер і presence. Тримає offline-чергу
 * команд — короткий розрив брокера не має губити heartbeat-и presence.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Окреме з'єднання під лічильники throttler-а (AUTH-0, research R-01/R-16).
 * БЕЗ offline-черги: throttler працює fail-open, і йому потрібна швидка помилка,
 * а не команда, що висить у черзі й підвішує логін. На спільному клієнті вимкнути
 * чергу не можна — її потребує presence.
 */
export const REDIS_THROTTLER_CLIENT = Symbol('REDIS_THROTTLER_CLIENT');
