import type { z } from 'zod';
import type {
  GeneralSettingsSchema,
  GeneralSettingsResponseSchema,
  CalendarSettingsSchema,
  SettingsBootstrapSchema,
} from './settings.schema';

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
export type GeneralSettingsResponse = z.infer<typeof GeneralSettingsResponseSchema>;
export type CalendarSettings = z.infer<typeof CalendarSettingsSchema>;
export type SettingsBootstrap = z.infer<typeof SettingsBootstrapSchema>;
