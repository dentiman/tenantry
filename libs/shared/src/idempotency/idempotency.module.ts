import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

/**
 * Глобальний, як NumberingModule: `IdempotencyService.claim(tx)` викликає будь-який доменний
 * сервіс, чий ендпоінт позначено `@Idempotent()`. Імпортує лише HTTP-застосунок — у воркері
 * ключа в контексті не буває, і шар там не потрібен.
 */
@Global()
@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
