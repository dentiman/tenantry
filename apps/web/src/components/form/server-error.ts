import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import { isGlobalApiError, parseApiError } from '../../api/api-error';

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
    if (knownFields.has(rootKey)) {
      form.setError(
        fieldError.field as FieldPath<T>,
        { type: 'server', message: fieldError.message },
        { shouldFocus: !hasFieldError },
      );
      hasFieldError = true;
    } else {
      orphans.push(`${fieldError.field}: ${fieldError.message}`);
    }
  }

  if (!hasFieldError || orphans.length > 0) {
    form.setError('root.server', {
      type: 'server',
      message: orphans.length > 0 ? orphans.join('; ') : parsed.message,
    });
  }
}
