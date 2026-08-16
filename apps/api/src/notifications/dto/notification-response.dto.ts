import { createZodDto } from 'nestjs-zod';
import {
  NotificationListResponseSchema,
  NotificationPreferenceListSchema,
  NotificationResponseSchema,
  NotificationSummarySchema,
} from '@saas-skeleton/contracts';

export class NotificationResponseDto extends createZodDto(NotificationResponseSchema) {}
export class NotificationListResponseDto extends createZodDto(NotificationListResponseSchema) {}
export class NotificationSummaryDto extends createZodDto(NotificationSummarySchema) {}
export class NotificationPreferenceListDto extends createZodDto(NotificationPreferenceListSchema) {}
