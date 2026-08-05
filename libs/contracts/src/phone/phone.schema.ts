import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';

/**
 * Свідомий виняток із правила «contracts залежить лише від zod»: libphonenumber-js —
 * ізоморфна ліба без власних залежностей, і саме тут вона потрібна, щоб правило
 * валідності номера було ОДНЕ на всі плейни (web/api/worker). Інакше фронт і бекенд
 * розійшлися б у трактуванні «валідний номер».
 *
 * Метадані — дефолтні (`min`, ~80 kB): їх достатньо для parse/format/isValidPhoneNumber.
 * `max` знадобиться, лише якщо треба відсіювати неіснуючі префікси всередині країни.
 */

/** ISO 3166-1 alpha-2, як їх повертає libphonenumber (`getCountries()`) */
export const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Expected ISO 3166-1 alpha-2 country code'));

/**
 * Телефон у wire-форматі E.164 (`+380671234567`) — саме так він лежить у БД і їздить в API.
 * Форматування «як друкуєш» і національний вигляд — виключно справа UI.
 *
 * Регекс відсіює сміття дешево ще до метаданих, refine перевіряє реальну існуваність
 * (довжину для конкретної країни/оператора).
 */
export const PhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Expected phone number in E.164 format')
  .refine((value) => isValidPhoneNumber(value), 'Invalid phone number');

/** Хелпер для доменних схем: телефон із країною або обидва null (окремо їх не буває) */
export const OptionalPhoneSchema = PhoneNumberSchema.nullable().optional();

export type { CountryCode };
