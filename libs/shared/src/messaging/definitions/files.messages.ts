import { z } from 'zod';
import { defineCommand } from '../message-definition';

/** Мініатюра зображення після complete. Команда: споживач рівно один */
export const generateThumbnailCommand = defineCommand(
  'files.generate-thumbnail',
  z.object({ fileId: z.uuid() }),
);

/**
 * Нічна чистка осиротілих PENDING-файлів: presigned PUT видано, complete не настав.
 * System-scope — крос-tenant, БД через SystemPrismaService (BYPASSRLS).
 */
export const cleanupOrphanFilesCommand = defineCommand('files.cleanup-orphans', z.object({}), {
  scope: 'system',
});
