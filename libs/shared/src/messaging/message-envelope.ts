import { z } from 'zod';

/**
 * Актор повідомлення. Свідомо ТА САМА форма, що в ActivityRecorder (ActivityActor):
 * подія несе актора крізь весь ланцюг, щоб підписник міг записати активність від імені
 * людини, яка операцію ініціювала, а не від безликої системи.
 */
export const messageActorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), id: z.uuid(), label: z.string() }),
  z.object({ type: z.literal('system') }),
]);

export type MessageActor = z.infer<typeof messageActorSchema>;

export const SYSTEM_ACTOR: MessageActor = { type: 'system' };

/**
 * Конверт — однаковий для ПОДІЙ і КОМАНД (docs/event-driven-architecture.md §3.1.1).
 * Це і є «все працює однаково»: у pgboss.job.data лежить одна й та сама форма
 * незалежно від того, чи це invoice-paid, чи нічний cron.
 *
 * `data` тут unknown — його звужує схема конкретного повідомлення (MessageDefinition).
 */
export const messageEnvelopeSchema = z.object({
  /** Ключ ідемпотентності бізнес-факту. Спільний для ВСІХ підписників однієї публікації */
  messageId: z.uuid(),
  /** Ім'я повідомлення: 'billing.invoice-paid.v1' або 'files.generate-thumbnail' */
  name: z.string().min(1),
  occurredAt: z.iso.datetime(),
  /** tenant-повідомлення — uuid; system (cron/maintenance) — null */
  tenantId: z.uuid().nullable(),
  actor: messageActorSchema,
  /** Корінь ланцюга: на HTTP-вході = pino req.id (той самий, що в ApiError.requestId) */
  correlationId: z.string().min(1),
  /** messageId батьківського повідомлення; null для кореня ланцюга */
  causationId: z.uuid().nullable(),
  data: z.unknown(),
});

export type MessageEnvelope<TData = unknown> = Omit<
  z.infer<typeof messageEnvelopeSchema>,
  'data'
> & { data: TData };
