import { createZodDto } from 'nestjs-zod';
import {
  SettingsBootstrapSchema,
  CalendarSettingsSchema,
  GeneralSettingsResponseSchema,
  GeneralSettingsSchema,
} from '@saas-skeleton/contracts';

export class GeneralSettingsDto extends createZodDto(GeneralSettingsSchema) {}
export class GeneralSettingsResponseDto extends createZodDto(GeneralSettingsResponseSchema) {}
export class CalendarSettingsDto extends createZodDto(CalendarSettingsSchema) {}
export class SettingsBootstrapDto extends createZodDto(SettingsBootstrapSchema) {}
