import { createZodDto } from 'nestjs-zod';
import { AiSettingsSchema, AiSettingsResponseSchema } from '@saas-skeleton/contracts';

export class AiSettingsDto extends createZodDto(AiSettingsSchema) {}
export class AiSettingsResponseDto extends createZodDto(AiSettingsResponseSchema) {}
