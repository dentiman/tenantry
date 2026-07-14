import type { File as PrismaFile } from '@saas-skeleton/database';
import type { FileResponse } from '@saas-skeleton/contracts';

export function toFileResponse(file: PrismaFile): FileResponse {
  return {
    id: file.id,
    filename: file.filename,
    // Prisma зберігає mimeType як string; належність до allowlist гарантує вхідний контракт
    mimeType: file.mimeType as FileResponse['mimeType'],
    size: file.size,
    status: file.status,
    hasThumbnail: file.thumbnailKey !== null,
    uploadedById: file.uploadedById,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}
