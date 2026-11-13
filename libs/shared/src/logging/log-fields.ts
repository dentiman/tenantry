/**
 * Словник полів лог-запису. Імена — за семантичними угодами OpenTelemetry, щоб запити й
 * дашборди не довелося переписувати, коли зʼявиться OTel SDK (він сам пише `trace_id`).
 * `tenant.id` і `messaging.job.id` угодами не покриті — названі в тому ж стилі.
 */
export const LOG_FIELDS = {
  traceId: 'trace_id',
  serviceName: 'service.name',
  serviceVersion: 'service.version',
  environment: 'deployment.environment.name',
  hostName: 'host.name',
  processPid: 'process.pid',
  userId: 'user.id',
  tenantId: 'tenant.id',
  messageId: 'messaging.message.id',
  messageName: 'messaging.operation.name',
  queue: 'messaging.destination.name',
  jobId: 'messaging.job.id',
} as const;

/**
 * Ключі CLS, з яких mixin логера добирає контекст у кожен запис. `traceId` спільний із
 * `MessageContextService` (correlationId конверта — це він і є); `userId` ставлять guard-и
 * після перевірки токена та реєстратор воркера з актора конверта.
 */
export const LOG_CONTEXT = {
  traceId: 'log.traceId',
  userId: 'log.userId',
} as const;
