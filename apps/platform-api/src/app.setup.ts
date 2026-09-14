import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
// Subpath-імпорт свідомо: головний index libs/shared тягне pg-boss/@aws-sdk
// (webpack externals), які platform-api не потрібні
import { AllExceptionsFilter } from '@saas-skeleton/shared/errors';
import { resolvePlatformAllowedOrigins, resolveTrustProxyHops } from './config/env.schema';

/** Спільний сетап HTTP-шару — використовується в main.ts і e2e-тестах */
export function configureApp(app: INestApplication): void {
  // AUTH-0: периметр — тут, а не в main.ts, щоб e2e перевіряли ту саму конфігурацію.
  // trust proxy числом хопів, а не `true`: інакше клієнт підставляє X-Forwarded-For сам
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', resolveTrustProxyHops());
  // upgrade-insecure-requests вимкнено — тестовий прод по http (див. apps/api/src/app.setup.ts)
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.enableCors({ origin: resolvePlatformAllowedOrigins(), credentials: true });
  // AUTH-2: дзеркало cookie-based refresh — cookie `saas_platform_refresh`
  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
