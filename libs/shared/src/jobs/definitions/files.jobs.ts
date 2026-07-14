import { z } from 'zod';
import { defineJob } from '../job-definition';

/** Мініатюра зображення після complete (диспатчиться із singletonKey=fileId) */
export const generateThumbnailJob = defineJob(
  'files.generate-thumbnail',
  z.object({ fileId: z.uuid() }),
);

/**
 * Нічна чистка осиротілих PENDING-файлів: presigned PUT видано, але complete
 * так і не настав (закрита вкладка, обірваний upload). Прибирає і S3-об'єкт, і рядок.
 */
export const filesCleanupOrphansJob = defineJob('files.cleanup-orphans', z.object({}), {
  cron: '30 3 * * *',
  retryLimit: 1,
});
