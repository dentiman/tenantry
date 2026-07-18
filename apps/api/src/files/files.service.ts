import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { PrismaService } from '@saas-skeleton/database';
import type { File as PrismaFile } from '@saas-skeleton/database';
import type {
  CreateFileUpload,
  FileDownloadUrlResponse,
  FileMimeType,
} from '@saas-skeleton/contracts';
import { IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  JobDispatcher,
  StorageService,
  generateThumbnailJob,
} from '@saas-skeleton/shared';

/** Скільки байтів вистачає file-type для визначення типу (магічні числа — на початку файлу) */
const MAGIC_BYTES_LENGTH = 4100;

/**
 * Який детект file-type приймаємо для заявленого MIME. null — формат без magic bytes
 * (plain text): детект має бути ВІДСУТНІЙ, інакше під .txt/.csv ховається бінарник.
 * docx/xlsx — це zip-контейнери, legacy .doc/.xls — OLE-контейнери (x-cfb).
 */
const ACCEPTED_DETECTED_MIMES: Record<FileMimeType, readonly string[] | null> = {
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/webp': ['image/webp'],
  'image/gif': ['image/gif'],
  'application/pdf': ['application/pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ],
  'application/msword': ['application/x-cfb'],
  'application/vnd.ms-excel': ['application/x-cfb'],
  'text/csv': null,
  'text/plain': null,
};

function isImageMime(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobDispatcher: JobDispatcher,
  ) {}

  /**
   * Фаза 1 двофазного upload-у: PENDING-запис + presigned PUT.
   * Байти підуть із браузера напряму в сховище, минаючи API.
   */
  async createUpload(
    data: CreateFileUpload,
    userId: string,
  ): Promise<{ file: PrismaFile; uploadUrl: string }> {
    const key = this.storage.buildObjectKey(data.filename);
    const file = await this.prisma.file.create({
      data: {
        key,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        uploadedById: userId,
      },
    });
    const uploadUrl = await this.storage.getUploadUrl(key, data.mimeType);
    this.logger.log(`Upload initiated: ${file.id} (${data.mimeType}, ${String(data.size)} B)`);
    return { file, uploadUrl };
  }

  /**
   * Фаза 2: підтвердження. Перевіряє, що об'єкт реально лежить у сховищі,
   * розмір збігається із заявленим, а вміст (magic bytes) відповідає заявленому MIME —
   * Content-Type клієнта не є довіреним. Повторний виклик для READY — no-op (ідемпотентно).
   */
  async complete(id: string): Promise<PrismaFile> {
    const file = await this.findOne(id);
    if (file.status === 'READY') {
      return file;
    }

    const head = await this.storage.headObject(file.key);
    if (!head) {
      throw new BadRequestException('Uploaded object not found in storage');
    }
    if (head.size !== file.size) {
      throw new BadRequestException('Uploaded size does not match declared size');
    }

    await this.verifyMagicBytes(file);

    const ready = await this.prisma.file.update({
      where: { id: file.id },
      data: { status: 'READY' },
    });
    this.logger.log(`Upload completed: ${file.id} (${file.mimeType})`);

    if (isImageMime(file.mimeType)) {
      // Некритичний side effect — падіння диспатчу не має ламати complete
      try {
        await this.jobDispatcher.send(
          generateThumbnailJob,
          { fileId: file.id },
          { singletonKey: file.id },
        );
      } catch (error) {
        this.logger.error(
          `Failed to dispatch ${generateThumbnailJob.name} for file ${file.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return ready;
  }

  async findOne(id: string): Promise<PrismaFile> {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with id "${id}" not found`);
    }
    return file;
  }

  /** Короткоживучий presigned GET; authz виклику — відповідальність контролера/guard-ів */
  async getDownloadUrl(
    id: string,
    variant: 'original' | 'thumbnail',
  ): Promise<FileDownloadUrlResponse> {
    const file = await this.findOne(id);
    if (file.status !== 'READY') {
      // PENDING не віддаємо: об'єкт не підтверджений (може бути відсутній або невалідний)
      throw new NotFoundException(`File with id "${id}" is not ready`);
    }
    // thumbnail для не-зображень/до генерації — свідомий fallback на оригінал
    const key = variant === 'thumbnail' ? (file.thumbnailKey ?? file.key) : file.key;
    const url = await this.storage.getDownloadUrl(key, {
      ...(variant === 'original' && { filename: file.filename }),
    });
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  private async verifyMagicBytes(file: PrismaFile): Promise<void> {
    const headBytes = await this.storage.readObjectHead(file.key, MAGIC_BYTES_LENGTH);
    const detected = (await fileTypeFromBuffer(headBytes))?.mime;
    // mimeType завжди з allowlist (гарантія вхідного контракту), тому індексація безпечна
    const accepted = ACCEPTED_DETECTED_MIMES[file.mimeType as FileMimeType];

    const matches =
      accepted === null
        ? detected === undefined
        : detected !== undefined && accepted.includes(detected);
    if (matches) {
      return;
    }

    // Невалідний вміст не залишаємо ані в сховищі, ані в БД
    this.logger.warn(
      `Magic bytes mismatch for file ${file.id}: declared ${file.mimeType}, detected ${detected ?? 'none'}`,
    );
    await this.storage.deleteObject(file.key);
    await this.prisma.file.delete({ where: { id: file.id } });
    throw new BadRequestException('File content does not match declared type');
  }
}
