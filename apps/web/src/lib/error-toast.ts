import { toast } from '@saas-skeleton/ui/components/ui/toast';
import i18n from '../i18n';
import type { ParsedApiError } from '@saas-skeleton/ui/api/api-error';

/** Анти-спам: однакова помилка не частіше ніж раз на вікно (сторінки з автооновленням) */
const DEDUP_WINDOW_MS = 5_000;
const recentToasts = new Map<string, number>();

function toastTitle(parsed: ParsedApiError): string {
  if (parsed.status === null) {
    return i18n.t('errors:toast.connectionTitle');
  }
  if (parsed.status === 403) {
    return i18n.t('errors:toast.accessDeniedTitle');
  }
  if (parsed.code === 'SERVICE_UNAVAILABLE') {
    return i18n.t('errors:toast.serviceUnavailableTitle');
  }
  return i18n.t('errors:toast.serverErrorTitle');
}

/** `code` покриває всі ApiErrorCode — перекладений опис; без code (network/parse-помилка) — вже перекладений message */
function toastDescription(parsed: ParsedApiError): string {
  return parsed.code ? i18n.t(`errors:codes.${parsed.code}`) : parsed.message;
}

export function showApiErrorToast(parsed: ParsedApiError): void {
  const key = `${String(parsed.status)}:${parsed.code ?? 'raw'}:${parsed.message}`;
  const now = Date.now();
  const last = recentToasts.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    return;
  }
  recentToasts.set(key, now);
  toast.add({
    type: 'error',
    title: toastTitle(parsed),
    description: toastDescription(parsed),
  });
}
