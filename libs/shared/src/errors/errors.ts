import { ConflictException } from '@nestjs/common';

/**
 * 409 із прив'язкою до конкретного поля: AllExceptionsFilter пробросить
 * fieldErrors у ApiError envelope, фронт покаже помилку прямо в полі форми.
 * `code` за замовчуванням "already_exists" — єдиний сценарій використання зараз
 * (той самий код, що й у P2002-гілки фільтра); передати інший — для майбутніх кейсів.
 */
export function fieldConflictException(
  field: string,
  message: string,
  code = 'already_exists',
): ConflictException {
  return new ConflictException({ message, fieldErrors: [{ field, message, code }] });
}
