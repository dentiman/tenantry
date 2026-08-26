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
