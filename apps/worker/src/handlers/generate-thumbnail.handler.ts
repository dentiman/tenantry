import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '@saas-skeleton/database';
import {
  JobHandler,
  JobHandlerContract,
  JobPayload,
  StorageService,
  generateThumbnailJob,
} from '@saas-skeleton/shared';

type GenerateThumbnailPayload = JobPayload<typeof generateThumbnailJob>;

const THUMBNAIL_SIZE_PX = 256;
const THUMBNAIL_WEBP_QUALITY = 80;

/**
 * Мініатюра зображення після complete. Стан файлу читається свіжим із БД
 * (файл могли видалити між диспатчем і обробкою). Ідемпотентний без inbox:
 * повторний запуск або перезапише той самий thumbnail-ключ, або вийде раніше,
 * якщо thumbnailKey уже записаний.
 */
@Injectable()
@JobHandler(generateThumbnailJob)
export class GenerateThumbnailHandler
  implements JobHandlerContract<typeof generateThumbnailJob.schema>
{
  private readonly logger = new Logger(GenerateThumbnailHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async handle(payload: GenerateThumbnailPayload): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: payload.fileId } });
    if (file?.status !== 'READY') {
      this.logger.warn(`Skipping thumbnail: file ${payload.fileId} missing or not READY`);
      return;
    }
    if (file.thumbnailKey) {
      return;
    }

    const source = await this.storage.readObject(file.key);
    const thumbnail = await sharp(Buffer.from(source))
      .resize(THUMBNAIL_SIZE_PX, THUMBNAIL_SIZE_PX, { fit: 'cover' })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY })
      .toBuffer();

    const thumbnailKey = `${file.key}.thumb.webp`;
    await this.storage.putObject(thumbnailKey, thumbnail, 'image/webp');
    await this.prisma.file.update({ where: { id: file.id }, data: { thumbnailKey } });
    this.logger.log(`Thumbnail generated for file ${file.id} (${thumbnailKey})`);
  }
}
