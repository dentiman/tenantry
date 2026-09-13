/** DI-токени realtime-шару (значення, не класи — тому рядкові символи) */
export const REALTIME_CONFIG = Symbol('REALTIME_CONFIG');

/**
 * `tenantRoom`/`userRoom` переїхали в `@saas-skeleton/contracts` (realtime.schema):
 * імена room-ів формує тепер і воркер (headless-емітер сповіщень), а дві копії
 * тихо розійшлися б і перестали доставляти. Реекспорт залишений, щоб решта
 * realtime-теки імпортувала їх звідси, як і раніше.
 */
export { tenantRoom, userRoom } from '@saas-skeleton/contracts';

/** За скільки до `exp` сервер просить клієнта оновити access-токен */
export const AUTH_EXPIRY_WARNING_MS = 60_000;
