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
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Workspace slots (docs/workspace-slots.md): щоб не плутати, який checkout/порт зараз слухає
  logger.log(`workspace slot: ${process.env.WORKSPACE_SLOT ?? '0 (default)'}`, 'Bootstrap');

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

  // API_PORT із workspace slot має пріоритет над generic PORT, який Claude preview
  // інжектить зі свого slot-0 launch.json у кожен worktree. Формульний fallback
  // захищає й уже створені .env.local, у яких API_PORT ще немає.
  const workspaceSlot = Number(process.env.WORKSPACE_SLOT ?? '0');
  const workspacePort =
    Number.isInteger(workspaceSlot) && workspaceSlot > 0 ? 3001 + 100 * workspaceSlot : undefined;
  const port = process.env.API_PORT ?? workspacePort ?? process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
