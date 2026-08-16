import { createZodDto } from 'nestjs-zod';
import {
  NotificationQuerySchema,
  UpdateNotificationSchema,
  UpdateNotificationPreferencesSchema,
} from '@saas-skeleton/contracts';

export class NotificationQueryDto extends createZodDto(NotificationQuerySchema) {}
export class UpdateNotificationDto extends createZodDto(UpdateNotificationSchema) {}
export class UpdateNotificationPreferencesDto extends createZodDto(
  UpdateNotificationPreferencesSchema,
) {}
