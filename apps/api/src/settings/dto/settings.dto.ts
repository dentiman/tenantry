import { createZodDto } from 'nestjs-zod';
import {
  SettingsBootstrapSchema,
  GeneralSettingsResponseSchema,
  GeneralSettingsSchema,
} from '@saas-skeleton/contracts';

export class GeneralSettingsDto extends createZodDto(GeneralSettingsSchema) {}
export class GeneralSettingsResponseDto extends createZodDto(GeneralSettingsResponseSchema) {}
export class SettingsBootstrapDto extends createZodDto(SettingsBootstrapSchema) {}
