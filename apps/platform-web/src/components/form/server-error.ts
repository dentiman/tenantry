import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import type { FieldError } from '@saas-skeleton/contracts';
import { isGlobalApiError, parseApiError } from '../../api/api-error';
import i18n from '../../i18n';

/** `code` — відкрита множина (Zod issue codes + бізнес-коди); немає ключа → англійський message як fallback */
function translateFieldError(fieldError: FieldError): string {
  if (!fieldError.code) {
    return fieldError.message;
  }
  return i18n.t(`errors:fieldErrors.${fieldError.code}`, {
    defaultValue: fieldError.message,
    ...fieldError.params,
  });
}

/**
 * Мапить ApiError бекенда на форму по іменах полів:
 * - fieldErrors, чиє поле існує у формі (звірка з getValues) → setError на це поле;
 * - решта (невідомі поля, помилки без fieldErrors) → errors.root.server;
 * - глобальні помилки (network/5xx/403) не чіпає — їх уже показав toast.
 *
 * Вимога: форма має задавати повні defaultValues — по них визначаються відомі поля.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  form: Pick<UseFormReturn<T>, 'setError' | 'getValues'>,
): void {
  const parsed = parseApiError(error);
  if (isGlobalApiError(parsed)) {
    return;
  }

  const knownFields = new Set(Object.keys(form.getValues()));
  const orphans: string[] = [];
  let hasFieldError = false;

  for (const fieldError of parsed.fieldErrors) {
    const rootKey = fieldError.field.split('.')[0] ?? '';
    const message = translateFieldError(fieldError);
    if (knownFields.has(rootKey)) {
      form.setError(
        fieldError.field as FieldPath<T>,
        { type: 'server', message },
        { shouldFocus: !hasFieldError },
      );
      hasFieldError = true;
    } else {
      orphans.push(`${fieldError.field}: ${message}`);
    }
  }

  if (!hasFieldError || orphans.length > 0) {
    form.setError('root.server', {
      type: 'server',
      message: orphans.length > 0 ? orphans.join('; ') : parsed.message,
    });
  }
}
