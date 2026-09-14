import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // Без HTTP-сервера: воркер живе завдяки poll-циклам pg-boss
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Workspace slots (docs/workspace-slots.md): щоб не плутати, який checkout зараз обробляє джоби
  logger.log(`workspace slot: ${process.env.WORKSPACE_SLOT ?? '0 (default)'}`, 'Bootstrap');
  app.enableShutdownHooks();
}

void bootstrap();
