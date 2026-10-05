import type { Tenant } from '@saas-skeleton/database';
import type { SettingsBootstrap, GeneralSettingsResponse } from '@saas-skeleton/contracts';
import { SettingsBootstrapSchema } from '@saas-skeleton/contracts';

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

/**
 * Ядро (general, features) плюс секції фіч з `BootstrapRegistry`. Форма — з composition
 * root контрактів (`SettingsBootstrapSchema`): `parse` перевіряє, що кожна секція, яку
 * обіцяє схема, справді зареєстрована (фіча прибрана з модулів, але лишилась у схемі —
 * 500 на старті сесії, а не тихий `undefined` у SPA), і відкидає незадекларовані.
 */
export function toSettingsBootstrap(
  tenant: Tenant,
  features: Record<string, boolean>,
  sections: Record<string, unknown>,
): SettingsBootstrap {
  return SettingsBootstrapSchema.parse({
    ...sections,
    general: {
      name: tenant.name,
      slug: tenant.slug,
      locale: tenant.locale,
      currency: tenant.currency,
    },
    // Ключ був закладений порожнім саме під це: AI-0 став його першим споживачем
    // (`features.ai`), і жодного нового ендпоінта для прапорця не знадобилось
    features,
  });
}
