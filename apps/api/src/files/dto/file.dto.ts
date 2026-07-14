import { createZodDto } from 'nestjs-zod';
import {
  CreateFileUploadSchema,
  CreateFileUploadResponseSchema,
  FileDownloadUrlQuerySchema,
  FileDownloadUrlResponseSchema,
  FileResponseSchema,
} from '@saas-skeleton/contracts';

export class CreateFileUploadDto extends createZodDto(CreateFileUploadSchema) {}
export class CreateFileUploadResponseDto extends createZodDto(CreateFileUploadResponseSchema) {}
export class FileResponseDto extends createZodDto(FileResponseSchema) {}
export class FileDownloadUrlQueryDto extends createZodDto(FileDownloadUrlQuerySchema) {}
export class FileDownloadUrlResponseDto extends createZodDto(FileDownloadUrlResponseSchema) {}
