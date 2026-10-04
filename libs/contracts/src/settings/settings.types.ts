import type { z } from 'zod';
import type {
  GeneralSettingsSchema,
  GeneralSettingsResponseSchema,
  CalendarSettingsSchema,
  AiSettingsSchema,
  AiAvailabilitySchema,
  AiSettingsResponseSchema,
  SettingsBootstrapSchema,
} from './settings.schema';

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
export type GeneralSettingsResponse = z.infer<typeof GeneralSettingsResponseSchema>;
export type CalendarSettings = z.infer<typeof CalendarSettingsSchema>;
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type AiAvailability = z.infer<typeof AiAvailabilitySchema>;
export type AiSettingsResponse = z.infer<typeof AiSettingsResponseSchema>;
export type SettingsBootstrap = z.infer<typeof SettingsBootstrapSchema>;
