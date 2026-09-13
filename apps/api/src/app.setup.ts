import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from '@saas-skeleton/shared';
import type { Redis } from 'ioredis';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter';
import { REALTIME_CONFIG } from './realtime/realtime.constants';
import { REDIS_CLIENT } from './redis/redis.constants';
import type { RealtimeConfig } from './realtime/realtime.config';
import { resolveAllowedOrigins } from './config/cors.config';
import { resolveTrustProxyHops } from './config/env.schema';

/** Спільний сетап HTTP-шару — використовується в main.ts і e2e-тестах */
export function configureApp(app: INestApplication): void {
  // AUTH-0: мережевий периметр живе ТУТ, а не в main.ts — інакше e2e перевіряли б
  // застосунок без нього (та сама причина, що з WebSocket-адаптером нижче).
  //
  // trust proxy: за nginx/swarm без нього req.ip = адреса балансувальника, і ліміт
  // по IP банив би весь тенант одразу. Число хопів, а не `true`: `true` дозволяє
  // клієнту самому підставити X-Forwarded-For і обійти ліміт
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', resolveTrustProxyHops());
  // Для JSON-API користь помірна (nosniff, frame-options, без X-Powered-By), ціна нульова.
  // upgrade-insecure-requests вимкнено: тестовий прод живе по http на IP:port, і Swagger
  // UI (/api/docs через nginx) з цією директивою тягнув би свої ресурси по https і ламався
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  // credentials: true — під refresh-cookie з AUTH-2; allowlist спільний із Socket.IO
  app.enableCors({ origin: resolveAllowedOrigins(), credentials: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  // RT-0: WebSocket-адаптер ставиться ТУТ, а не в main.ts — інакше e2e піднімали б
  // застосунок без Redis Streams adapter-а й перевіряли б не ту конфігурацію
  app.useWebSocketAdapter(
    new RealtimeIoAdapter(
      app,
      app.get<RealtimeConfig>(REALTIME_CONFIG),
      app.get<Redis>(REDIS_CLIENT),
    ),
  );
}
