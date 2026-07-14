import { z } from 'zod';

/** Ліміт на файл: у системі документи/зображення, великих файлів не буде (рішення користувача) */
export const FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Закритий allowlist типів (зображення + офісні документи). Заявлений клієнтом
 * mimeType — лише первинний фільтр: справжній тип бекенд звіряє по magic bytes
 * на complete (Content-Type клієнта не є довіреним).
 */
export const ALLOWED_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;

export const FileMimeTypeSchema = z.enum(ALLOWED_FILE_MIME_TYPES);

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** Двофазний upload: PENDING (виданий presigned PUT) → READY (complete підтвердив об'єкт) */
export const FileStatusSchema = z.enum(['PENDING', 'READY']);

// Ключі сховища (key/thumbnailKey) — внутрішня деталь, назовні не віддаються:
// доступ до байтів тільки через короткоживучі presigned URL після authz
export const FileSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: FileMimeTypeSchema,
  size: z.number().int(),
  status: FileStatusSchema,
  hasThumbnail: z.boolean(),
  uploadedById: z.uuid().nullable(),
  // Wire-формат API: дати передаються як ISO-рядки
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateFileUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: FileMimeTypeSchema,
  size: z.number().int().min(1).max(FILE_MAX_SIZE_BYTES),
});

export const FileResponseSchema = FileSchema;

/** Відповідь фази 1: браузер робить PUT байтів напряму на uploadUrl (минаючи API) */
export const CreateFileUploadResponseSchema = z.object({
  file: FileResponseSchema,
  uploadUrl: z.url(),
});

export const FileDownloadUrlQuerySchema = z.object({
  variant: z.enum(['original', 'thumbnail']).default('original').optional(),
});

export const FileDownloadUrlResponseSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number().int(),
});
