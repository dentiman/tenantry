import {
  AsYouType,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
// 4 kB на всі країни — дешевше за метадані `max` (+65 kB), які до того ж дають
// «можливу», а не типову довжину: для UA вони мовчать аж до 13 цифр
import examples from 'libphonenumber-js/examples.mobile.json';
import { DEFAULT_COUNTRY, isSupportedCountry } from './countries';

/** Усе, що не є цифрою чи структурним символом, у поле не потрапляє */
const ALLOWED_INPUT = /[^\d\s()+.-]/g;

interface CountryHint {
  /** Приклад номера так, як його вводять у це поле — без trunk-нуля ('50 123 4567') */
  placeholder: string;
  /** Максимум значущих цифр (теж без trunk-нуля) */
  maxDigits: number;
  /**
   * Національний префікс міжміського набору («0» в Україні, Британії, Франції…) або null
   * для країн, де його немає (США, Польща, Італія). Визначається з прикладу номера —
   * окремого API для нього libphonenumber не дає.
   */
  trunkPrefix: string | null;
}

const hintCache = new Map<CountryCode, CountryHint | null>();

/**
 * Маска-підказка, ліміт довжини і trunk-префікс країни — усе з прикладу номера
 * libphonenumber (аналог autoPlaceholder + strictMode в intl-tel-input).
 *
 * Приклад — МОБІЛЬНИЙ номер, тож для країн зі змінною довжиною (Німеччина, Австрія)
 * ліміт приблизний.
 */
export function getCountryHint(country: CountryCode): CountryHint | null {
  const cached = hintCache.get(country);
  if (cached !== undefined) return cached;

  const example = getExampleNumber(country, examples);
  let hint: CountryHint | null = null;

  if (example) {
    const national = example.formatNational();
    const digits = national.replace(/\D/g, '');
    // Код країни вже показано зліва від поля, тому в самому полі trunk-нуль зайвий:
    // і в підказці, і в ліміті рахуємо номер без нього
    const trunkPrefix = digits.startsWith('0') ? '0' : null;

    hint = {
      placeholder: trunkPrefix
        ? national.replace(/^0[\s\-()]*/, '')
        : national,
      maxDigits: trunkPrefix ? digits.length - 1 : digits.length,
      trunkPrefix,
    };
  }

  hintCache.set(country, hint);
  return hint;
}

/**
 * Обрізає ввід до максимальної кількості ЦИФР (роздільники не рахуються).
 * Якщо людина все ж набрала номер із trunk-нулем — ліміт піднімається на його довжину,
 * щоб той самий номер не вважався задовгим лише через спосіб набору.
 */
function clampToMaxDigits(value: string, country: CountryCode): string {
  const hint = getCountryHint(country);
  if (!hint) return value;

  const trunk = hint.trunkPrefix;
  const limit =
    trunk && value.replace(/\D/g, '').startsWith(trunk)
      ? hint.maxDigits + trunk.length
      : hint.maxDigits;

  let digits = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i] ?? '')) digits += 1;
    if (digits > limit) return value.slice(0, i);
  }
  return value;
}

export interface PhoneInputState {
  country: CountryCode;
  /** Те, що бачить користувач: національний формат без коду країни */
  national: string;
}

/**
 * Відновлення стану поля зі збереженого E.164. phoneCountry має пріоритет над
 * визначеною з номера країною: за +1 неможливо відрізнити US від CA і десятка
 * карибських країн, і без збереженого вибору користувач побачив би чужий прапор.
 */
export function stateFromE164(
  value: string | null | undefined,
  storedCountry?: string | null,
): PhoneInputState {
  const fallbackCountry = isSupportedCountry(storedCountry) ? storedCountry : DEFAULT_COUNTRY;

  if (!value) return { country: fallbackCountry, national: '' };

  const parsed = parsePhoneNumberFromString(value);
  if (!parsed) return { country: fallbackCountry, national: value };

  const country = isSupportedCountry(storedCountry)
    ? storedCountry
    : (parsed.country ?? DEFAULT_COUNTRY);

  return {
    country,
    // nationalNumber — значущі цифри БЕЗ trunk-нуля; формат накладаємо тим самим
    // шляхом, що й під час набору, щоб редагування виглядало так само, як ввід
    national: formatNationalPart(parsed.nationalNumber, country),
  };
}

/**
 * Форматування «як друкуєш». AsYouType stateful, тому на кожен ввід створюється новий
 * і йому подається ВЕСЬ рядок — це рекомендований спосіб роботи з ним у React.
 *
 * isDeletion гасить класичну ваду таких полів: коли користувач стирає символ, форматер
 * тут же дописує роздільник назад ("(21" → "(21)"), і Backspace перестає працювати.
 * Тому при видаленні залишаємо рядок таким, як його зробив користувач.
 */
export function formatAsYouType(
  raw: string,
  country: CountryCode,
  isDeletion: boolean,
): { value: string; isMaxLengthReached: boolean } {
  const sanitized = raw.replace(ALLOWED_INPUT, '');
  if (!sanitized) return { value: '', isMaxLengthReached: false };

  // Зайві цифри просто не потрапляють у поле (strictMode в intl-tel-input),
  // а не приймаються з подальшою помилкою на submit
  const clamped = clampToMaxDigits(sanitized, country);
  const isMaxLengthReached = clamped.length < sanitized.length;

  const formatted = formatNationalPart(clamped, country);
  const value = isDeletion && formatted.length > clamped.length ? clamped : formatted;

  return { value, isMaxLengthReached };
}

/**
 * Групування цифр національної частини.
 *
 * Формати в метаданих для багатьох країн (Україна, Британія, Франція, Німеччина…)
 * описані РАЗОМ із trunk-нулем, а в це поле його не вводять — код країни вже показано
 * зліва. Через це AsYouType не знаходив шаблон і повертав цифри суцільним рядком, тоді
 * як США чи Польща (без trunk-префікса) форматувалися одразу.
 *
 * Тому: якщо пряме форматування нічого не змінило — пробуємо ще раз із підставленим
 * trunk-нулем і прибираємо його з результату. Жодних правил на кожну країну: сам
 * префікс береться з прикладу номера, а групування лишається рідним для країни
 * (США зберігає свої дужки, Франція — пари цифр).
 */
function formatNationalPart(input: string, country: CountryCode): string {
  const direct = new AsYouType(country).input(input);
  if (direct !== input) return direct;

  const trunk = getCountryHint(country)?.trunkPrefix;
  if (!trunk || input.startsWith(trunk)) return direct;

  const withTrunk = new AsYouType(country).input(trunk + input);
  if (withTrunk === trunk + input) return direct;

  // Прибираємо не лише сам префікс, а й роздільник, що йшов одразу за ним
  return withTrunk.slice(trunk.length).replace(/^[\s\-()]+/, '');
}

/**
 * Значення для RHF. Повертає E.164 навіть для неповного номера (`+38067`) —
 * валідність перевіряє Zod-схема з contracts на submit, а не поле під час набору:
 * інакше поле «блимало» б помилкою на кожній цифрі.
 */
export function toE164(raw: string, country: CountryCode): string | null {
  const sanitized = raw.replace(ALLOWED_INPUT, '');
  if (!sanitized.replace(/\D/g, '')) return null;

  const formatter = new AsYouType(country);
  formatter.input(sanitized);

  return formatter.getNumberValue() ?? null;
}

/**
 * Читабельний вигляд збереженого номера («+380 67 123 4567»). У БД і в API номер
 * завжди E.164 — розставляння пробілів belongs до UI, а не до контракту.
 */
export function formatForDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
}

/**
 * Вставка повного міжнародного номера з буфера (`+380 67 123 45 67`) має перемикати
 * і країну, і поле — інакше код країни продублюється в національній частині.
 */
export function parsePastedInternational(
  raw: string,
): { country: CountryCode; national: string } | null {
  if (!raw.trim().startsWith('+')) return null;

  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed?.country) return null;

  // Той самий формат, що й під час набору — без trunk-нуля
  return {
    country: parsed.country,
    national: formatNationalPart(parsed.nationalNumber, parsed.country),
  };
}
