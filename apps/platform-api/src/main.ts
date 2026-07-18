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

  app.useLogger(app.get(Logger));

  app.enableCors();
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
