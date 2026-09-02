import { createZodDto } from 'nestjs-zod';
import { CursorQuerySchema } from '@saas-skeleton/contracts';

/**
 * Фід налаштувань не приймає entityType/entityId: сутність — сама організація,
 * і береться вона з токена. Лишається тільки курсор.
 */
export class SettingsActivityQueryDto extends createZodDto(CursorQuerySchema) {}
