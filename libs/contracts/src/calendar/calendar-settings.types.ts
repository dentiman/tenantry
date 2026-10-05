import type { z } from 'zod';
import type { CalendarSettingsSchema } from './calendar-settings.schema';

export type CalendarSettings = z.infer<typeof CalendarSettingsSchema>;
