import type { z } from 'zod';
import type {
  FileSchema,
  FileStatusSchema,
  FileMimeTypeSchema,
  CreateFileUploadSchema,
  FileResponseSchema,
  CreateFileUploadResponseSchema,
  FileDownloadUrlQuerySchema,
  FileDownloadUrlResponseSchema,
} from './file.schema';

export type FileEntity = z.infer<typeof FileSchema>;
export type FileStatus = z.infer<typeof FileStatusSchema>;
export type FileMimeType = z.infer<typeof FileMimeTypeSchema>;
export type CreateFileUpload = z.infer<typeof CreateFileUploadSchema>;
export type FileResponse = z.infer<typeof FileResponseSchema>;
export type CreateFileUploadResponse = z.infer<typeof CreateFileUploadResponseSchema>;
export type FileDownloadUrlQuery = z.infer<typeof FileDownloadUrlQuerySchema>;
export type FileDownloadUrlResponse = z.infer<typeof FileDownloadUrlResponseSchema>;
