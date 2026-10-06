import { useSettingsBootstrap } from '../../../api/generated/api';

/**
 * Чи ввімкнений асистент у ЦІЙ інсталяції.
 *
 * Прапорець їде в уже наявному курованому зрізі `GET /settings/bootstrap` — у
 * мапі `features`, яку заклали порожньою саме під feature-gating. Нового
 * ендпоінта не знадобилось, а зріз і так вантажиться раз на сесію.
 *
 * До першої відповіді — `false`: краще показати кнопку на кадр пізніше, ніж
 * блимнути мертвим контролом у інсталяції, де асистента немає.
 */
export function useAiEnabled(): boolean {
  const { data } = useSettingsBootstrap({ query: { staleTime: Number.POSITIVE_INFINITY } });
  return data?.features.ai ?? false;
}
