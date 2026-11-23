import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { type Observable, from, lastValueFrom } from 'rxjs';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  isValidIdempotencyKey,
  requestFingerprint,
} from './idempotency-fingerprint';
import {
  IdempotencyKeyTakenSignal,
  IdempotencyService,
  type StoredIdempotencyKey,
} from './idempotency.service';

/**
 * Скільки чекати на відповідь першого запиту, перш ніж сказати 409. Паралельний дублікат
 * розблоковується рівно в момент коміту першого, а той зберігає відповідь одним UPDATE одразу
 * після — тож вікно зазвичай мілісекунди. Сума ≈ 2 с: довше тримати запит немає сенсу, відповідь,
 * якої немає за цей час, найімовірніше втрачена разом із процесом.
 */
const RESPONSE_WAIT_STEPS_MS = [25, 50, 100, 200, 400, 600, 600];
const RETRY_AFTER_SECONDS = '1';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * HTTP-половина ідемпотентності (docs/idempotency.md). Вішається декоратором `@Idempotent()`.
 *
 * 1. Немає заголовка → запит іде як звичайний.
 * 2. Ключ уже відомий → збережена відповідь (або 422, якщо запит інший), обробник не викликається.
 * 3. Ключ новий → контекст у CLS; сервіс займає ключ у своїй транзакції (`claim(tx)`); після
 *    успіху відповідь зберігається. Помилка обробника нічого не лишає — транзакція відкотилась
 *    разом із ключем, повтор просто виконається знову.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const invoke = (): Promise<unknown> => lastValueFrom(next.handle(), { defaultValue: undefined });
    if (context.getType() !== 'http') {
      return invoke();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { sub?: string } }>();
    const response = http.getResponse<Response>();

    const key = request.headers[IDEMPOTENCY_KEY_HEADER];
    if (key === undefined) {
      return invoke();
    }
    if (!isValidIdempotencyKey(key)) {
      throw new BadRequestException('Idempotency-Key must be 1 to 255 visible ASCII characters');
    }
    const userId = request.user?.sub;
    if (!userId) {
      // Ключ належить користувачу; публічний ендпоінт не має до чого його привʼязати
      throw new Error('@Idempotent() requires an authenticated endpoint');
    }

    const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
    const operation = `${request.method} ${route}`;
    const requestHash = requestFingerprint({
      method: request.method,
      url: request.originalUrl,
      body: request.body,
    });

    const known = await this.idempotency.find(userId, key);
    if (known) {
      return this.replay(known, { userId, key, requestHash }, response);
    }

    const claim = this.idempotency.begin({ key, userId, operation, requestHash });
    let body: unknown;
    try {
      body = await invoke();
    } catch (error) {
      if (error instanceof IdempotencyKeyTakenSignal) {
        // Інший запит із цим ключем закомітився між нашою перевіркою і вставкою (або ми
        // чекали на нього на індексі) — віддаємо його відповідь
        const winner = await this.idempotency.find(userId, key);
        return await this.replay(winner, { userId, key, requestHash }, response);
      }
      throw error;
    } finally {
      this.idempotency.end();
    }

    if (!claim.committed) {
      // Половинчасте підключення: декоратор є, а сервіс ключ не зайняв. Тихо пропустити —
      // означало б «захист, якого немає»; так це падає першим же тестом ендпоінта
      throw new Error(
        `${operation} is marked @Idempotent() but no committed transaction called IdempotencyService.claim(tx)`,
      );
    }

    const handlerStatus = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
      | number
      | undefined;
    const status =
      handlerStatus ?? (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    try {
      await this.idempotency.saveResponse(claim, status, body);
    } catch (error) {
      // Ефект уже закомічено — клієнт отримує свою відповідь. Повтор із цим ключем побачить
      // рядок без відповіді й отримає 409 IDEMPOTENCY_IN_PROGRESS, а не другий ефект
      this.logger.error(
        { err: error, operation },
        'Failed to store the response for an idempotency key',
      );
    }
    return body;
  }

  private async replay(
    stored: StoredIdempotencyKey | null,
    request: { userId: string; key: string; requestHash: string },
    response: Response,
  ): Promise<unknown> {
    let current = stored;
    if (current && current.requestHash !== request.requestHash) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used with a different request',
      });
    }
    for (const delay of RESPONSE_WAIT_STEPS_MS) {
      if (current?.responseStatus != null) {
        break;
      }
      await sleep(delay);
      current = await this.idempotency.find(request.userId, request.key);
    }
    if (current?.responseStatus == null) {
      response.header('Retry-After', RETRY_AFTER_SECONDS);
      throw new ConflictException({
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message:
          'A request with this Idempotency-Key was already applied, but its response is not available',
      });
    }
    // Статус не чіпаємо: Nest сам поставить статичний код ендпоінта — той самий, що вперше
    response.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return current.responseBody ?? undefined;
  }
}
