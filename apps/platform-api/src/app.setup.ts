import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
// Subpath-імпорт свідомо: головний index libs/shared тягне pg-boss/@aws-sdk
// (webpack externals), які platform-api не потрібні
import { AllExceptionsFilter } from '@saas-skeleton/shared/errors';

/** Спільний сетап HTTP-шару — використовується в main.ts і e2e-тестах */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
