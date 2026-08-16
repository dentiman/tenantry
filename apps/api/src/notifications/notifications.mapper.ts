/**
 * Мапер модуля живе в `libs/shared/src/notifications/`: той самий рядок треба
 * віддати і HTTP-відповіді, і socket-події, яку кладе recorder (він у shared).
 * Тримати дві копії мапінгу означало б, що клієнт колись отримає різну форму
 * з REST і з сокета.
 */
export { toNotificationResponse } from '@saas-skeleton/shared';
