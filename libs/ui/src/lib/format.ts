// Обидва застосунки конфігурують САМ синглтон i18next (не createInstance), тож
// пакет бере той самий інстанс без прокидання через пропи чи контекст
import i18n from 'i18next';
import { toDateValue } from '@saas-skeleton/ui/lib/date-value';

/**
 * **Дата в інтерфейсі — `yyyy-MM-dd`, і це стандарт скелетона** (рішення
 * користувача 2026-09-09), спільний для гріда, картки, мета-рядка і поля вводу
 * (`DatePicker`, дефолт `format="iso"`).
 *
 * Чому не локальний формат `Intl`, який тут стояв раніше. Три причини, і жодна
 * з них не про красу:
 *   1. `03-04-2026` не має однієї відповіді — берлінський бухгалтер і
 *      нью-йоркський менеджер прочитають різні місяці. Для системи, де дані
 *      переїжджають між людьми, це не дрібниця;
 *   2. ширина стала: колонка гріда не перемальовується під мову, а `Sep`/
 *      `вересня` вже дають різні метрики;
 *   3. те, що людина бачить на екрані, збігається з тим, що вона знайде в
 *      експорті, логах і URL — і зможе просто скопіювати.
 *
 * Перевизначає це **код** конкретного екрана (`DatePicker format="long"`,
 * власний `Intl` у місці, де дата — головний зміст), а НЕ юзер у налаштуваннях:
 * формат дати не стає ще одним перемикачем в адмінці.
 *
 * Межа: календар лишається на СВОЇХ форматах (`apps/web/src/lib/calendar-date.ts`
 * — «Wednesday, September 9», «5 minutes ago»). Там дата не дані, а зміст
 * екрана, і ISO читався б як лог.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return toDateValue(date);
}

/**
 * Той самий стандарт із часом: `2026-09-09 14:30`. Година 24-годинна навіть в
 * `en` — інакше половина рядка була б ISO, а половина локальною (`2:30 PM`).
 * Секунд немає: у мета-рядку вони шум, а кому вони потрібні (черги, DLQ) —
 * форматує сам.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${toDateValue(date)} ${time}`;
}

/** Пороги «людського» відліку: до 45 с — «щойно», далі одиниця за величиною різниці */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Відносний час у минулому («5 minutes ago»). Саме `Intl.RelativeTimeFormat`, а не
 * власні рядки в i18next: відмінювання й порядок слів — робота платформи, і для
 * кожної нової мови це працює без жодного ключа.
 *
 * Понад тиждень назад відносна форма перестає щось повідомляти («3 weeks ago» —
 * це коли?), тому там віддаємо абсолютну дату. `null` — коли часу немає взагалі:
 * викликач сам вирішує, що це означає («Never», прочерк тощо).
 */
export function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  // Майбутнє (розсинхрон годинників клієнта і ноди) підтягуємо до нуля:
  // «через 2 хвилини» для останньої активності — очевидна нісенітниця
  const elapsed = Math.max(Date.now() - ms, 0);
  if (elapsed >= WEEK_MS) {
    return formatDate(iso);
  }

  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  if (elapsed < 45_000) {
    // -0 з numeric:'auto' дає саме «now», а не «0 seconds ago»
    return rtf.format(-0, 'second');
  }
  if (elapsed < HOUR_MS) {
    return rtf.format(-Math.round(elapsed / MINUTE_MS), 'minute');
  }
  if (elapsed < DAY_MS) {
    return rtf.format(-Math.round(elapsed / HOUR_MS), 'hour');
  }
  return rtf.format(-Math.round(elapsed / DAY_MS), 'day');
}
