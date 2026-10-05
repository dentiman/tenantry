import type { z } from 'zod';
import type {
  GeneralSettingsSchema,
  GeneralSettingsResponseSchema,
  SettingsBootstrapCoreSchema,
} from './settings.schema';

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
export type GeneralSettingsResponse = z.infer<typeof GeneralSettingsResponseSchema>;
export type SettingsBootstrapCore = z.infer<typeof SettingsBootstrapCoreSchema>;
