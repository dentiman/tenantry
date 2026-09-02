import type { Tenant } from '@saas-skeleton/database';
import type { SettingsBootstrap, GeneralSettingsResponse } from '@saas-skeleton/contracts';

/**
 * Назовні йдуть ТІЛЬКИ поля, які тенант має бачити. `isActive` і `settings`
 * не мапляться: перший — платформенний прапорець (тенант його не змінює і
 * бачити не потребує), другий стане секціями, коли вони з'являться.
 */
export function toGeneralSettingsResponse(tenant: Tenant): GeneralSettingsResponse {
  return {
    name: tenant.name,
    slug: tenant.slug,
    locale: tenant.locale as GeneralSettingsResponse['locale'],
    currency: tenant.currency,
  };
}

export function toSettingsBootstrap(tenant: Tenant): SettingsBootstrap {
  return {
    general: {
      name: tenant.name,
      slug: tenant.slug,
      locale: tenant.locale,
      currency: tenant.currency,
    },
    // V1 порожня: ключ закладений, щоб feature-gating не вимагав нового ендпоінта
    features: {},
  };
}
