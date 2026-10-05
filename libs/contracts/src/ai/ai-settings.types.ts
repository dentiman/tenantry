import type { z } from 'zod';
import type {
  AiSettingsSchema,
  AiAvailabilitySchema,
  AiSettingsResponseSchema,
} from './ai-settings.schema';

export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type AiAvailability = z.infer<typeof AiAvailabilitySchema>;
export type AiSettingsResponse = z.infer<typeof AiSettingsResponseSchema>;
