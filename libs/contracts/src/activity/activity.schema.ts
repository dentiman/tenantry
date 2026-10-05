import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';
// Перелік типів збирає root із визначень модулів-власників (docs/module-registries.md R1)
import { ActivityTypeSchema } from '../activity-types';

/**
 * Семантика зв'язку події з сутністю. NULL, коли неоднозначності немає (один лінк).
 * Словник валідує ця схема, а не колонка БД — нові ролі без міграції.
 */
export const ActivityLinkRoleSchema = z.enum(['subject', 'target', 'source', 'context']);
export type ActivityLinkRole = z.infer<typeof ActivityLinkRoleSchema>;

/** Query: фід ЗАВЖДИ по сутності (tenant-wide фід — беклог) */
export const ActivityQuerySchema = CursorQuerySchema.extend({
  entityType: z.string().min(1),
  entityId: z.uuid(),
  type: ActivityTypeSchema.optional(),
});

export const ActivityResponseSchema = z.object({
  id: z.uuid(),
  type: ActivityTypeSchema, // фронт усе одно має generic-fallback на невідомий тип
  actorType: z.enum(['user', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()), // форму звужує ACTIVITY_PAYLOAD_SCHEMAS[type]
  createdAt: z.iso.datetime(), // як усі дати в контрактах — ISO-рядок, формат — Intl на фронті
});

export const ActivityListResponseSchema = cursorResponseSchema(ActivityResponseSchema);
