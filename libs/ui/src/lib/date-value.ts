// Обидва застосунки конфігурують САМ синглтон i18next (не createInstance), тож
// пакет бере той самий інстанс без прокидання через пропи чи контекст
import i18n from 'i18next';

/**
 * **Цивільна дата** у форматі `yyyy-MM-dd` — значення, яким оперує `DatePicker`.
 *
 * Чому рядок, а не `Date`. «9 вересня» — це календарна дата, а не момент часу:
 * у неї немає ні години, ні зони. Щойно її загорнути в `Date`, вона отримує
 * опівніч у зоні ПРИСТРОЮ, і будь-яка серіалізація (`toISOString()`) зсуває її
 * на сусідню добу — рівно та грабля, що вже спіймана живим прогоном календаря
 * (`apps/web/src/lib/calendar-date.ts`, `toInstantIso`). Рядок `yyyy-MM-dd`
 * зсунути неможливо: він не знає, що таке зона.
 *
 * Той самий формат уже є ключем дня в календарі (`dayKey`) і в URL (`?date=`),
 * тож поле і сітка розмовляють однією мовою без конвертацій між ними.
 *
 * `Date` тут з'являється рівно у двох місцях і обидва — ЛОКАЛЬНІ: сітка
 * `react-day-picker` (вона будує свої дні в зоні пристрою) і арифметика
 * розбору введеного тексту.
 */
export type DateValue = string;

/**
 * Як показати дату людині.
 *
 * **`iso` — дефолт скелетона**: у полі стоїть рівно те, що лежить у значенні
 * (`2026-09-09`). Однозначно (`03-04` не питає, який це місяць), однакової
 * ширини в будь-якій мові — тобто поле не «стрибає» при перемиканні локалі й
 * не обрізає підпис у вузькій колонці, — і головне: те, що людина бачить,
 * збігається з тим, що поїде на дріт і що вона побачить у логах, експорті чи
 * URL. Для внутрішньої системи це коштує менше, ніж красивий `Sep 9, 2026`.
 *
 * Решта — стилі `Intl`, і вони НЕ налаштування продукту: перемикає їх код
 * конкретного екрана (`format="long"` на картці, де дата — головний зміст),
 * а не юзер в адмінці. Один формат на весь застосунок лишається дефолтом.
 */
export type DateValueFormat = 'iso' | 'short' | 'medium' | 'long' | 'full';

/** Маска ISO — технічний формат, тому НЕ перекладається (на відміну від решти) */
const ISO_MASK = 'yyyy-MM-dd';

/** Рік мусить бути з чотирьох цифр — двозначний нормалізується ДО розбору */
const ISO_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Розділювачі числових частин. `-` тут теж є (формат `9-9-2026` реальний), і це
 * безпечно: ISO ловиться окремим патерном ВИЩЕ за токенізацію.
 */
const TOKEN_SEPARATORS = /[\s.,/\\|·-]+/;

/**
 * Межа двозначного року за конвенцією POSIX: `69`…`99` — двадцяте століття,
 * `00`…`68` — двадцять перше.
 */
const CENTURY_PIVOT = 68;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/**
 * Складання локального `Date` із перевіркою round-trip.
 *
 * Перевірка обов'язкова: `new Date(2026, 1, 31)` мовчки дає 3 березня, тобто
 * «31 лютого» пройшло б як валідна дата. Порівняння трьох полів після
 * складання — єдиний спосіб це відсікти, не переписуючи григоріанський
 * календар руками.
 */
function buildLocalDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  // `new Date(45, 0, 1)` — це 1945 рік, а не 45-й: двозначні роки конструктор
  // трактує як 19xx. Нормалізація йде ще до виклику, але страховка дешева
  if (year >= 0 && year <= 99) {
    date.setFullYear(year);
  }
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Локальний `Date` → `yyyy-MM-dd` (жодного UTC: беремо саме локальні геттери) */
export function toDateValue(date: Date): DateValue {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `yyyy-MM-dd` → локальна опівніч цієї доби; невалідний рядок → `null` */
export function fromDateValue(value: DateValue | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const match = ISO_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return buildLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isDateValue(value: unknown): value is DateValue {
  return typeof value === 'string' && fromDateValue(value) !== null;
}

export function todayValue(): DateValue {
  return toDateValue(new Date());
}

/**
 * Дата очима людини. Через `Intl`, а не власні рядки в i18next: порядок полів,
 * назва місяця й розділювачі — робота платформи, і для кожної нової мови це
 * працює без жодного ключа (та сама доктрина, що в `lib/format.ts`).
 */
export function formatDateValue(
  value: DateValue | null | undefined,
  format: DateValueFormat = 'iso',
): string {
  const date = fromDateValue(value);
  if (!date) {
    return '';
  }
  // ISO — це саме значення: форматувати нічого, і round-trip «показали →
  // прочитали назад» стає тотожністю, а не збігом
  if (format === 'iso') {
    return value ?? '';
  }
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: format }).format(date);
}

// ------------------------------------------------------------- розбір вводу

type DateField = 'day' | 'month' | 'year';

/** Число, вирване з введеного тексту, разом із кількістю цифр (рік `26` ≠ `2026`) */
interface NumberToken {
  value: number;
  digits: number;
}

/**
 * Числовий кістяк дати поточної локалі: порядок полів і розділювачі між ними.
 *
 * Зразкова дата навмисно «22.11» — три ЧИСЛА, які неможливо переплутати між
 * собою (день > 12, місяць ≠ день, рік із чотирьох цифр), інакше визначити
 * порядок за результатом форматування не вийшло б.
 */
function skeleton(locale: string): { fields: DateField[]; parts: Intl.DateTimeFormatPart[] } {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(2026, 10, 22));
  const fields = parts
    .map((part) => part.type)
    .filter((type): type is DateField => type === 'day' || type === 'month' || type === 'year');
  return { fields, parts };
}

const skeletonCache = new Map<string, ReturnType<typeof skeleton>>();

function localeSkeleton(locale: string): ReturnType<typeof skeleton> {
  const cached = skeletonCache.get(locale);
  if (cached) {
    return cached;
  }
  const built = skeleton(locale);
  skeletonCache.set(locale, built);
  return built;
}

/**
 * Маска формату під плейсхолдер: `yyyy-MM-dd` для дефолтного `iso`,
 * `mm/dd/yyyy` / `dd.mm.yyyy` — для локалізованих стилів.
 *
 * У локалізованих порядок і розділювачі беруться з `Intl`, а літери — з i18n
 * (`common`), бо вони й є перекладом: `d/m/y` англійською, `д/м/р`
 * українською. Плейсхолдер тут навмисно МАСКА, а не приклад реальної дати:
 * приклад у полі читається як уже введене значення.
 */
export function dateInputMask(
  format: DateValueFormat = 'iso',
  locale: string = i18n.language,
): string {
  if (format === 'iso') {
    return ISO_MASK;
  }
  const letters: Record<DateField, string> = {
    day: i18n.t('common:datePicker.mask.day', { defaultValue: 'd' }),
    month: i18n.t('common:datePicker.mask.month', { defaultValue: 'm' }),
    year: i18n.t('common:datePicker.mask.year', { defaultValue: 'y' }),
  };
  return localeSkeleton(locale)
    .parts.map((part) =>
      part.type === 'day' || part.type === 'month' || part.type === 'year'
        ? letters[part.type].repeat(part.value.length)
        : part.value,
    )
    .join('');
}

/** Порівняння без регістру, діакритики і крапок: «Верес.» === «вересня» */
function normalizeWord(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

const monthNameCache = new Map<string, Map<string, number>>();

/**
 * Назви місяців поточної локалі — і повні, і скорочені. Будуються з `Intl`
 * тим самим ходом, що й решта форматів: словника місяців у репозиторії немає і
 * не має бути.
 */
function monthNames(locale: string): Map<string, number> {
  const cached = monthNameCache.get(locale);
  if (cached) {
    return cached;
  }
  const names = new Map<string, number>();
  /*
   * Форм чотири, а не дві, і це не надмірність. `{ month: 'long' }` дає
   * САМОСТІЙНУ форму назви («вересень»), а людина в даті пише контекстну
   * («9 вересня») — у слов'янських мовах це різні слова, і без другої пари
   * «9 вересня 2026» не розбиралося б узагалі (спіймано прогоном парсера).
   * Контекстну форму витягуємо з відформатованої дати через `formatToParts`:
   * знати про відмінки не треба, це робота `Intl`.
   */
  const formatters = [
    { formatter: new Intl.DateTimeFormat(locale, { month: 'long' }), standalone: true },
    { formatter: new Intl.DateTimeFormat(locale, { month: 'short' }), standalone: true },
    {
      formatter: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }),
      standalone: false,
    },
    {
      formatter: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      standalone: false,
    },
  ];
  for (const { formatter, standalone } of formatters) {
    for (let index = 0; index < 12; index += 1) {
      const date = new Date(2026, index, 9);
      const raw = standalone
        ? formatter.format(date)
        : (formatter.formatToParts(date).find((part) => part.type === 'month')?.value ?? '');
      const key = normalizeWord(raw);
      if (key && !names.has(key)) {
        names.set(key, index + 1);
      }
    }
  }
  monthNameCache.set(locale, names);
  return names;
}

/** Точний збіг або унікальний префікс від трьох літер («sept» → September) */
function monthFromName(token: string, locale: string): number | null {
  const normalized = normalizeWord(token);
  if (!normalized) {
    return null;
  }
  const names = monthNames(locale);
  const exact = names.get(normalized);
  if (exact !== undefined) {
    return exact;
  }
  if (normalized.length < 3) {
    return null;
  }
  let match: number | null = null;
  for (const [name, month] of names) {
    if (!name.startsWith(normalized) || month === match) {
      continue;
    }
    if (match !== null) {
      // Префікс підійшов двом різним місяцям («ju» → June/July) — це не вибір
      return null;
    }
    match = month;
  }
  return match;
}

function expandYear(year: number, digits: number): number {
  if (digits > 2) {
    return year;
  }
  return year <= CENTURY_PIVOT ? 2000 + year : 1900 + year;
}

/**
 * Текст із поля → `yyyy-MM-dd`, або `null`, якщо прочитати не вдалось.
 *
 * Поле можна ЗАПОВНИТИ З КЛАВІАТУРИ — це головна причина, чому пікер зроблено
 * полем із календарем, а не самим лише календарем у поповері: людина, яка знає
 * дату, набирає її швидше, ніж домотує сітку до потрібного місяця, а зчитувачу
 * екрана календарна сітка взагалі дається важче за звичайний ввід.
 *
 * Що приймається:
 *   - `2026-09-09` — ISO, завжди й незалежно від локалі (однозначний);
 *   - `9/9/2026`, `09.09.26` — числа в порядку ПОТОЧНОЇ локалі (`Intl`);
 *   - `9/9` — без року, рік поточний;
 *   - `9` — тільки день, місяць і рік поточні;
 *   - `20260909` — вісім цифр поспіль;
 *   - `Sep 9 2026`, `9 вересня`, `sept 9` — місяць словом у будь-якому місці.
 *
 * Свідомо НЕ приймаються відносні слова («today», «завтра»): їх переклад — це
 * словник у пакеті, тобто рівно те, чого доктрина i18n тут уникає.
 */
export function parseDateInput(
  text: string,
  options: { today?: Date; locale?: string } = {},
): DateValue | null {
  const locale = options.locale ?? i18n.language;
  const today = options.today ?? new Date();
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = ISO_PATTERN.exec(trimmed);
  if (isoMatch) {
    const date = buildLocalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return date ? toDateValue(date) : null;
  }

  if (/^\d{8}$/.test(trimmed)) {
    const date = buildLocalDate(
      Number(trimmed.slice(0, 4)),
      Number(trimmed.slice(4, 6)),
      Number(trimmed.slice(6, 8)),
    );
    return date ? toDateValue(date) : null;
  }

  const tokens = trimmed.split(TOKEN_SEPARATORS).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) {
    return null;
  }

  let namedMonth: number | null = null;
  const numbers: NumberToken[] = [];

  for (const token of tokens) {
    // «9th», «9-е» — число з мовним хвостом
    const digits = /^(\d+)\p{L}*$/u.exec(token)?.[1];
    if (digits !== undefined) {
      numbers.push({ value: Number(digits), digits: digits.length });
      continue;
    }
    const month = monthFromName(token, locale);
    if (month === null || namedMonth !== null) {
      return null;
    }
    namedMonth = month;
  }

  let year: number;
  let month: number;
  let day: number;

  const [first, second] = numbers;

  if (namedMonth !== null) {
    month = namedMonth;
    if (!first) {
      return null;
    }
    if (!second) {
      day = first.value;
      year = today.getFullYear();
    } else if (numbers.length === 2) {
      // Рік — той із двох, що не може бути днем (чотири цифри або > 31)
      const firstIsYear = first.digits === 4 || first.value > 31;
      day = firstIsYear ? second.value : first.value;
      const rawYear = firstIsYear ? first : second;
      year = expandYear(rawYear.value, rawYear.digits);
    } else {
      return null;
    }
  } else {
    const { fields } = localeSkeleton(locale);
    if (first && !second) {
      day = first.value;
      month = today.getMonth() + 1;
      year = today.getFullYear();
    } else {
      // Двох чисел вистачає на день і місяць — рік беремо поточний, але позиції
      // все одно диктує локаль: у en-US спершу місяць, у більшості інших — день
      const order = numbers.length === 3 ? fields : fields.filter((field) => field !== 'year');
      if (order.length !== numbers.length) {
        return null;
      }
      const assigned = new Map<DateField, NumberToken>();
      order.forEach((field, index) => {
        const token = numbers[index];
        if (token) {
          assigned.set(field, token);
        }
      });
      if (assigned.size !== order.length) {
        return null;
      }
      day = assigned.get('day')?.value ?? 0;
      month = assigned.get('month')?.value ?? 0;
      const rawYear = assigned.get('year');
      year = rawYear ? expandYear(rawYear.value, rawYear.digits) : today.getFullYear();
    }
  }

  const date = buildLocalDate(year, month, day);
  return date ? toDateValue(date) : null;
}
