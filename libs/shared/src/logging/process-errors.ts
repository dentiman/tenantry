interface FatalLogger {
  fatal(message: unknown, ...optionalParams: unknown[]): void;
}

/**
 * Без цього падіння процесу йде в stderr сирим текстом Node — повз JSON-лог і без полів
 * сервісу. Після `uncaughtException` стан процесу невизначений, тому він завершується:
 * перезапуск — справа оркестратора (у dev — `nest start --watch`).
 */
export function installProcessErrorHandlers(logger: FatalLogger): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception, exiting');
    process.exitCode = 1;
    // Дати потокам логера дописати запис
    setTimeout(() => {
      process.exit(1);
    }, 200).unref();
  });
}
