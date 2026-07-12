import { toast } from '@heroui/react';
import type { ParsedApiError } from '../api/api-error';

/** Анти-спам: однакова помилка не частіше ніж раз на вікно (сторінки з автооновленням) */
const DEDUP_WINDOW_MS = 5_000;
const recentToasts = new Map<string, number>();

function toastTitle(parsed: ParsedApiError): string {
  if (parsed.status === null) {
    return 'Connection problem';
  }
  if (parsed.status === 403) {
    return 'Access denied';
  }
  if (parsed.code === 'SERVICE_UNAVAILABLE') {
    return 'Service unavailable';
  }
  return 'Server error';
}

export function showApiErrorToast(parsed: ParsedApiError): void {
  const key = `${String(parsed.status)}:${parsed.code ?? 'raw'}:${parsed.message}`;
  const now = Date.now();
  const last = recentToasts.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    return;
  }
  recentToasts.set(key, now);
  toast.danger(toastTitle(parsed), { description: parsed.message });
}
