import { ConflictException } from '@nestjs/common';

/**
 * 409 із прив'язкою до конкретного поля: AllExceptionsFilter пробросить
 * fieldErrors у ApiError envelope, фронт покаже помилку прямо в полі форми.
 */
export function fieldConflictException(field: string, message: string): ConflictException {
  return new ConflictException({ message, fieldErrors: [{ field, message }] });
}
