import { z } from 'zod';
import { defineActivityTypes } from '../activity/activity-definition';

/**
 * Налаштування організації (docs/settings.md). Зміна стосується ВСІХ, а не автора, тому за
 * нею приходять питати «хто це зробив». Зсув нумерації — окремий тип і з числом у payload:
 * дія незворотна, аудиту потрібне значення. Тексти платформні.
 */
export const SETTINGS_ACTIVITIES = defineActivityTypes(
  { ns: 'activities' },
  {
    'settings.updated': {
      payload: z.object({
        section: z.string(), // 'general' | 'numbering' — секція редактора
      }),
    },
    'settings.numbering_shifted': {
      payload: z.object({
        series: z.string(),
        nextNumber: z.number().int(),
      }),
    },
  },
);
