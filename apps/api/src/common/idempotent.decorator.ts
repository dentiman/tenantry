import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { IdempotencyInterceptor } from '@saas-skeleton/shared';

/**
 * Ендпоінт приймає заголовок `Idempotency-Key` (docs/idempotency.md): повтор завершеного запиту
 * отримує відповідь першого й не створює другого ефекту.
 *
 * Це ПОЛОВИНА підключення. Друга — `await this.idempotency.claim(tx)` першим стейтментом у
 * `withTenantTx` сервісу: ключ мусить закомітитись разом з ефектом. Без неї запит із заголовком
 * падає з 500 — навмисно, щоб половинчастий захист не лишився непоміченим.
 *
 * Не вішати на ендпоінт, відповідь якого містить секрет (токен, presigned URL): відповідь
 * зберігається в БД на добу.
 *
 * У OpenAPI — розширення `x-idempotency-key`, а не параметр-заголовок: оголошений заголовок
 * додав би аргумент `headers` у кожен згенерований orval-виклик, а фронтенд ставить ключ
 * централізовано в HTTP-клієнті.
 */
export function Idempotent(): MethodDecorator {
  return applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiExtension('x-idempotency-key', true),
  );
}
