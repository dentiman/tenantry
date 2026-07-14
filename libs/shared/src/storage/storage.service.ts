import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Дефолти = SeaweedFS із docker-compose (як SMTP-дефолти MailerService → Mailpit)
const DEFAULT_ENDPOINT = 'http://localhost:8333';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_ACCESS_KEY = 'saas';
const DEFAULT_SECRET_KEY = 'saas-secret';
const DEFAULT_BUCKET = 'saas-files';

/** TTL presigned PUT: встигнути завантажити файл після POST /files */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
/** TTL presigned GET: URL живе рівно стільки, щоб браузер встиг його відкрити */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name: string }).name === 'NotFound' ||
      (error as { name: string }).name === 'NoSuchKey')
  );
}

/**
 * Тонка обгортка над S3 API (@aws-sdk/client-s3). Зафіксоване рішення: S3 API —
 * і є абстракція сховища (окремого StorageDriver-інтерфейсу немає, аналогічно
 * підходу з pg-boss): dev — SeaweedFS з docker-compose, прод — будь-яке
 * S3-сумісне сховище через ті самі env-змінні.
 *
 * Presign — локальна криптооперація (мережа не потрібна); мережеві виклики
 * тут лише head/get/put/delete та one-off ensureBucket на старті.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? DEFAULT_BUCKET;
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? DEFAULT_ENDPOINT,
      region: process.env.S3_REGION ?? DEFAULT_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? DEFAULT_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY ?? DEFAULT_SECRET_KEY,
      },
      // path-style (endpoint/bucket/key) — вимога більшості self-hosted реалізацій
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      // Без цього SDK вшиває в presigned PUT дефолтну CRC32-чексуму ПОРОЖНЬОГО payload
      // (x-amz-checksum-crc32=AAAAAA==) — сховище валідує її проти реального тіла і
      // відхиляє upload 400-кою (перевірено на живому SeaweedFS)
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Dev-DX: створює бакет і вішає CORS (прямий PUT/GET із браузера за presigned URL).
   * Помилки не валять старт: у проді бакет готують заздалегідь і права на
   * CreateBucket/PutBucketCors у runtime-креденшелів зазвичай відсутні.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (error) {
      this.logger.warn(
        `Bucket bootstrap skipped (${error instanceof Error ? error.message : String(error)}) — ensure bucket "${this.bucket}" and its CORS config exist`,
      );
    }
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" created`);
    }

    const origins = (process.env.S3_CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: origins,
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
      this.logger.log(`Bucket CORS set for origins: ${origins.join(', ')}`);
    }
  }

  /** Presigned PUT. ContentType підписується — клієнт зобов'язаний слати саме заявлений MIME */
  async getUploadUrl(key: string, mimeType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
  }

  /** Presigned GET; filename → Content-Disposition attachment (скачування під людською назвою) */
  async getDownloadUrl(key: string, options: { filename?: string } = {}): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.filename && {
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(options.filename)}`,
        }),
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  /** null — об'єкта немає (upload не відбувся або ключ хибний) */
  async headObject(key: string): Promise<{ size: number } | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: head.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Перші maxBytes об'єкта (Range-запит) — для перевірки magic bytes без викачування всього файлу */
  async readObjectHead(key: string, maxBytes: number): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${String(maxBytes - 1)}`,
      }),
    );
    return (await response.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async readObject(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return (await response.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Ідемпотентне видалення: відсутність об'єкта — не помилка (ретраї cleanup-джоб) */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }
}
