import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from '@saas-skeleton/shared';
import type { Redis } from 'ioredis';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter';
import { REALTIME_CONFIG, REALTIME_REDIS } from './realtime/realtime.constants';
import type { RealtimeConfig } from './realtime/realtime.config';

/** Спільний сетап HTTP-шару — використовується в main.ts і e2e-тестах */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  // RT-0: WebSocket-адаптер ставиться ТУТ, а не в main.ts — інакше e2e піднімали б
  // застосунок без Redis Streams adapter-а й перевіряли б не ту конфігурацію
  app.useWebSocketAdapter(
    new RealtimeIoAdapter(
      app,
      app.get<RealtimeConfig>(REALTIME_CONFIG),
      app.get<Redis>(REALTIME_REDIS),
    ),
  );
}
