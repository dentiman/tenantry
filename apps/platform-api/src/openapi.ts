/**
 * Генерує apps/platform-api/openapi.json без запуску HTTP-сервера.
 * Запуск: pnpm --filter @saas-skeleton/platform-api openapi:generate.
 * Потрібен .env з PLATFORM_JWT_SECRET (підключення до БД не відбувається).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { buildOpenApiConfig, openApiDocumentOptions } from './openapi.config';

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const doc = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, buildOpenApiConfig(), openApiDocumentOptions),
  );

  const outPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(doc, null, 2));
  console.log(`Platform OpenAPI spec written to ${outPath}`);

  await app.close();
  process.exit(0);
}

generate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
