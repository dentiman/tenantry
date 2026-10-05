import { createZodDto } from 'nestjs-zod';
import { CalendarSettingsSchema } from '@saas-skeleton/contracts';

export class CalendarSettingsDto extends createZodDto(CalendarSettingsSchema) {}
