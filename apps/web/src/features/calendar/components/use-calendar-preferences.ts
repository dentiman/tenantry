import { CALENDAR_SETTINGS_DEFAULTS, type CalendarSettings } from '@saas-skeleton/contracts';
import { useSettingsBootstrap } from '../../../api/generated/api';
import { useAuthStore } from '../../auth/stores/auth.store';
import { browserTimeZone } from '../lib/calendar-date';

export interface CalendarPreferences extends CalendarSettings {
  /** Зона, у якій малюємо сітку: юзер → організація → пристрій */
  viewerTimeZone: string;
  /** Зона пристрою відрізняється від профільної — привід показати банер */
  isDeviceZoneDifferent: boolean;
  /**
   * Дефолти вже приїхали. Доки `false`, зона — це фолбек на зону ПРИСТРОЮ, тобто
   * вікно порахувалось би не там, де його малюватимемо: спіймано в мережі —
   * на холодному старті летіли ДВА запити вікна (спершу в зоні пристрою, потім
   * у зоні організації). Споживач притримує запит цим прапорцем.
   */
  isReady: boolean;
}

/**
 * Дефолти календаря. Беруться з `GET /settings/bootstrap` (курований зріз, який
 * доступний усім ролям) і кешуються назавжди в межах сесії: перший день тижня і
 * робочі години не змінюються поки людина дивиться на екран, а стрибок розкладки
 * від другого запиту видно одразу.
 *
 * Фолбек `null → організація → пристрій` живе ТУТ, а не на бекенді, свідомо:
 * `users.time_zone = null` означає «як в організації», і саме клієнт знає ще й
 * третій рівень — зону пристрою, яку сервер не бачить.
 */
export function useCalendarPreferences(): CalendarPreferences {
  const user = useAuthStore((state) => state.user);
  const { data, isSuccess } = useSettingsBootstrap({
    query: { staleTime: Number.POSITIVE_INFINITY },
  });

  const device = browserTimeZone();
  const organization = data?.calendar.timeZone;
  const viewerTimeZone = user?.timeZone ?? organization ?? device;

  return {
    // До першої відповіді bootstrap-у — ті самі дефолти, що на бекенді, крім
    // зони: у неї є третій рівень, який сервер не бачить (зона пристрою)
    ...CALENDAR_SETTINGS_DEFAULTS,
    ...(data?.calendar ?? {}),
    timeZone: organization ?? device,
    viewerTimeZone,
    isDeviceZoneDifferent: viewerTimeZone !== device,
    isReady: isSuccess,
  };
}
