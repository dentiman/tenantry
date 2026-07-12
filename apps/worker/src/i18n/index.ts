import i18next from 'i18next';
import notificationsEn from '../locales/en/notifications.json';

/**
 * Плейн i18next (без react-i18next — воркер без UI). Один namespace поки що:
 * контент листів рендериться з локаллю юзера через опцію { lng } у кожному t()-виклику,
 * не через глобальний i18next.changeLanguage (обробники паралельно обслуговують різних юзерів).
 */
void i18next.init({
  resources: {
    en: {
      notifications: notificationsEn,
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'notifications',
  // На відміну від web (React екранує сам) — тут інтерпольовані значення йдуть
  // прямо в HTML листа, тому лишаємо дефолтне екранування i18next увімкненим
});

export default i18next;
