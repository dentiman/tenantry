import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export interface CountryOption {
  code: CountryCode;
  /** Код набору без «+» — '380' */
  callingCode: string;
  /** Локалізована назва країни ('Ukraine' / 'Україна') */
  name: string;
  /**
   * Рядок, по якому шукає `Combobox`. Base UI фільтрує по ОДНОМУ рядку елемента
   * (`itemToStringLabel`), тому всі пошукові токени зшиті сюди: локалізована назва,
   * ISO-код і код набору в обох записах ('380' і '+380')
   */
  searchText: string;
}

/** Показуються першими, до алфавітного списку. Порядок усередині — значущий */
const PREFERRED_COUNTRIES: CountryCode[] = ['UA', 'PL', 'DE', 'GB', 'US'];

/** Країна за замовчуванням для порожнього поля */
export const DEFAULT_COUNTRY: CountryCode = 'UA';

/**
 * Список країн будується з метаданих libphonenumber (245 країн), а НЕ з окремого
 * датасету: інакше два джерела правди розійшлися б — ліба знала б код набору, якого
 * немає в списку, або навпаки.
 *
 * Назви — з вбудованого Intl.DisplayNames: нуль кілобайт бандла і автоматична
 * локалізація під активну мову i18next замість власних перекладів 245 рядків.
 */
function buildCountries(locale: string): CountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);

  const options = getCountries().map((code) => {
    // of() повертає сам код, якщо назви немає — тоді хоч щось краще за порожнечу
    const name = displayNames.of(code) ?? code;
    const callingCode = getCountryCallingCode(code);

    return {
      code,
      callingCode,
      name,
      searchText: `${name} ${code} +${callingCode} ${callingCode}`,
    };
  });

  const preferredRank = new Map(PREFERRED_COUNTRIES.map((code, index) => [code, index]));

  return options.sort((a, b) => {
    const rankA = preferredRank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
    const rankB = preferredRank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return collator.compare(a.name, b.name);
  });
}

/**
 * Кеш по мові: побудова — 245 викликів Intl + сортування, а список для однієї мови
 * незмінний. Модульний Map, а не useMemo: перемикання сторінок не має це переобчислювати
 */
const cache = new Map<string, CountryOption[]>();

export function getCountryOptions(locale: string): CountryOption[] {
  const cached = cache.get(locale);
  if (cached) return cached;

  const built = buildCountries(locale);
  cache.set(locale, built);
  return built;
}

export function findCountry(locale: string, code: CountryCode): CountryOption | undefined {
  return getCountryOptions(locale).find((option) => option.code === code);
}

/** Чи входить код у метадані libphonenumber — захист від сміття в phoneCountry з БД */
export function isSupportedCountry(code: string | null | undefined): code is CountryCode {
  return code != null && (getCountries() as string[]).includes(code);
}
