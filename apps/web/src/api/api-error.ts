import { isAxiosError } from 'axios';
import { ApiErrorSchema } from '@saas-skeleton/contracts';
import type { ApiErrorCode, FieldError } from '@saas-skeleton/contracts';
import i18n from '../i18n';

/** Нормалізована помилка запиту: ApiError envelope бекенда або синтезований fallback */
export interface ParsedApiError {
  /** HTTP-статус; null — запит не долетів (network/CORS/timeout) */
  status: number | null;
  /** Машинний код з ApiError; null — відповідь не в форматі envelope */
  code: ApiErrorCode | null;
  message: string;
  fieldErrors: FieldError[];
  requestId?: string;
}

export function parseApiError(error: unknown): ParsedApiError {
  if (isAxiosError(error) && error.response) {
    const parsed = ApiErrorSchema.safeParse(error.response.data);
    if (parsed.success) {
      const result: ParsedApiError = {
        status: parsed.data.statusCode,
        code: parsed.data.code,
        message: parsed.data.message,
        fieldErrors: parsed.data.fieldErrors ?? [],
      };
      if (parsed.data.requestId !== undefined) {
        result.requestId = parsed.data.requestId;
      }
      return result;
    }
    return { status: error.response.status, code: null, message: i18n.t('errors:generic'), fieldErrors: [] };
  }
  if (isAxiosError(error)) {
    return { status: null, code: null, message: i18n.t('errors:network'), fieldErrors: [] };
  }
  return { status: null, code: null, message: i18n.t('errors:generic'), fieldErrors: [] };
}

/**
 * Помилки «не про конкретну дію користувача» — їх показує глобальний toast,
 * а не форма: network, 5xx (включно з 503 від недоступної БД) та 403.
 * 401 сюди не входить — ним займається refresh-інтерсептор.
 */
export function isGlobalApiError(parsed: ParsedApiError): boolean {
  if (parsed.status === null) {
    return true;
  }
  if (parsed.status === 403) {
    return true;
  }
  return parsed.status >= 500;
}
