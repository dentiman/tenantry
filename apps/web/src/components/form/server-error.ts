import { isAxiosError } from 'axios';
import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

/**
 * Мапить помилку бекенда на форму: 409 → конкретне поле (унікальність),
 * решта → загальна помилка форми (errors.root.server).
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options?: { conflictField?: FieldPath<T>; conflictMessage?: string },
): void {
  if (isAxiosError(error) && error.response?.status === 409 && options?.conflictField) {
    setError(options.conflictField, {
      type: 'server',
      message: options.conflictMessage ?? 'Already exists',
    });
    return;
  }
  setError('root.server', {
    type: 'server',
    message: 'Something went wrong. Please try again.',
  });
}
