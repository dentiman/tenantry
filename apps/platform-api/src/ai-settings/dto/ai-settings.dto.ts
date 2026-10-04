import { createZodDto } from 'nestjs-zod';
import {
  PlatformAiApiKeyRevealResponseSchema,
  PlatformAiSettingsEventListResponseSchema,
  PlatformAiSettingsResponseSchema,
  UpdatePlatformAiSettingsSchema,
} from '@saas-skeleton/contracts/platform';

export class PlatformAiSettingsResponseDto extends createZodDto(PlatformAiSettingsResponseSchema) {}
export class UpdatePlatformAiSettingsDto extends createZodDto(UpdatePlatformAiSettingsSchema) {}
export class PlatformAiApiKeyRevealResponseDto extends createZodDto(
  PlatformAiApiKeyRevealResponseSchema,
) {}
export class PlatformAiSettingsEventListResponseDto extends createZodDto(
  PlatformAiSettingsEventListResponseSchema,
) {}
