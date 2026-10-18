import { ActivityListResponseSchema } from '../activity/activity.schema';
import { CursorQuerySchema } from '../pagination/pagination.schema';
import { ActivityTypeSchema } from '../activity-types';

// Control plane: стрічка подій УСЬОГО тенанта — операційний зріз для розбору інцидентів
// (docs/activity-log.md, «Стрічка тенанта в control plane»). Без фільтра за сутністю і без
// обмеження `WORKSPACE_ACTIVITY_TYPES`: оператор бачить усі типи, зокрема безпекові й
// приватні події календаря, — більше, ніж будь-який юзер тенанта. Формат запису той самий,
// що в tenant-плані, тому схема відповіді не копіюється.

export const TenantActivityQuerySchema = CursorQuerySchema.extend({
  type: ActivityTypeSchema.optional(),
});

export const TenantActivityListResponseSchema = ActivityListResponseSchema;
