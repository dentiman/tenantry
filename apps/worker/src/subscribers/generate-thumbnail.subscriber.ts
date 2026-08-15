import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '@saas-skeleton/database';
import {
  MessageData,
  MessageSubscriber,
  MessageSubscriberContract,
  StorageService,
  generateThumbnailCommand,
} from '@saas-skeleton/shared';

type GenerateThumbnail = MessageData<typeof generateThumbnailCommand>;

const THUMBNAIL_SIZE_PX = 256;
const THUMBNAIL_WEBP_QUALITY = 80;

/**
 * Мініатюра зображення після complete. Стан файлу читається свіжим із БД
 * (файл могли видалити між публікацією й обробкою). Ідемпотентний без inbox:
 * повторний запуск або перезапише той самий thumbnail-ключ, або вийде раніше,
 * якщо thumbnailKey уже записаний.
 */
@Injectable()
@MessageSubscriber({ definition: generateThumbnailCommand, id: 'thumbnailer' })
export class GenerateThumbnailSubscriber
  implements MessageSubscriberContract<typeof generateThumbnailCommand.schema>
{
  private readonly logger = new Logger(GenerateThumbnailSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async handle(data: GenerateThumbnail): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: data.fileId } });
    if (file?.status !== 'READY') {
      this.logger.warn(`Skipping thumbnail: file ${data.fileId} missing or not READY`);
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
