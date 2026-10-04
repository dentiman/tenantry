import type { z } from 'zod';
import type {
  PlatformAiApiKeyRevealResponseSchema,
  PlatformAiSettingsEventListResponseSchema,
  PlatformAiSettingsResponseSchema,
  UpdatePlatformAiSettingsSchema,
} from './ai-settings.schema';

export type PlatformAiSettingsResponse = z.infer<typeof PlatformAiSettingsResponseSchema>;
export type UpdatePlatformAiSettings = z.infer<typeof UpdatePlatformAiSettingsSchema>;
export type PlatformAiApiKeyRevealResponse = z.infer<typeof PlatformAiApiKeyRevealResponseSchema>;
export type PlatformAiSettingsEventListResponse = z.infer<
  typeof PlatformAiSettingsEventListResponseSchema
>;
