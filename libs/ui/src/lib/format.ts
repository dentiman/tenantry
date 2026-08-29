// Обидва застосунки конфігурують САМ синглтон i18next (не createInstance), тож
// пакет бере той самий інстанс без прокидання через пропи чи контекст
import i18n from 'i18next';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  return new Intl.DateTimeFormat(i18n.language).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
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
