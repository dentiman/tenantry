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

  // Use Pino logger from nestjs-pino (multistream: console + file)
  app.useLogger(app.get(Logger));

  // RT-1: без цього SIGTERM від swarm убив би процес до того, як presence встигне
  // віддати свої leases — і кожен rolling deploy лишав би «привидів» online
  app.enableShutdownHooks();
  configureApp(app);

  const openApiDoc = SwaggerModule.createDocument(
    app,
    buildOpenApiConfig(),
    openApiDocumentOptions,
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApiDoc));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
