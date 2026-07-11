import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { buildOpenApiConfig, openApiDocumentOptions } from './openapi.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino logger from nestjs-pino (multistream: console + file)
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ZodValidationPipe());
  const httpAdapter = app.getHttpAdapter();
  app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

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
