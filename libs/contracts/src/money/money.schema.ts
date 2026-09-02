import { z } from 'zod';

/**
 * Валюта — ISO 4217. Лежить окремим листовим модулем (як `phone/`), бо її
 * вживають і воркспейс (дефолт компанії), і кастомер (валюта розрахунків), а
 * згодом — документи й проводки. Довідник має бути один на всі три.
 */
export const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Expected ISO 4217 currency code'));

/** Дефолт до того, як воркспейс задасть свою валюту в налаштуваннях */
export const DEFAULT_CURRENCY = 'USD';
