import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildOpenApiConfig, openApiDocumentOptions } from './openapi.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  // Workspace slots (docs/workspace-slots.md): щоб не плутати, який checkout/порт зараз слухає
  logger.log(`workspace slot: ${process.env.WORKSPACE_SLOT ?? '0 (default)'}`, 'Bootstrap');

  configureApp(app);

  const openApiDoc = SwaggerModule.createDocument(
    app,
    buildOpenApiConfig(),
    openApiDocumentOptions,
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApiDoc));

  const port = process.env.PLATFORM_PORT ?? 3002;
  await app.listen(port);
}

void bootstrap();
