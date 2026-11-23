import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type UserOperation } from '@saas-skeleton/database';
import {
  USER_OPERATION_RETENTION_DAYS,
  type UserOperationListQuery,
  type UserOperationResultUrlResponse,
} from '@saas-skeleton/contracts';
import { DOWNLOAD_URL_TTL_SECONDS, StorageService, UserOperationsService } from '@saas-skeleton/shared';

/**
 * Читання операцій для власника. Доступ — одна умова на всіх шляхах: `userId` з токена
 * (backend-conventions §7: функція доступу модуля). Чужа операція — 404, а не 403: не палимо
 * її існування.
 */
@Injectable()
export class UserOperationsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: UserOperationsService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, query: UserOperationListQuery): Promise<UserOperation[]> {
    return this.prisma.userOperation.findMany({
      where: { userId, ...(query.active && { status: { in: ['QUEUED', 'RUNNING'] } }) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
  }

  async findOwn(id: string, userId: string): Promise<UserOperation> {
    const row = await this.prisma.userOperation.findFirst({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException(`User operation "${id}" not found`);
    }
    return row;
  }

  async cancel(id: string, userId: string): Promise<UserOperation> {
    const row = await this.operations.requestCancel(id, userId);
    if (!row) {
      throw new NotFoundException(`User operation "${id}" not found`);
    }
    return row;
  }

  /** Посилання на файл результату: лише власнику, лише SUCCEEDED, лише в межах строку зберігання */
  async resultUrl(id: string, userId: string): Promise<UserOperationResultUrlResponse> {
    const row = await this.findOwn(id, userId);
    const expiresAfter = new Date(Date.now() - USER_OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const filename = (row.result as { filename?: unknown } | null)?.filename;
    if (
      row.status !== 'SUCCEEDED' ||
      row.resultKey === null ||
      row.finishedAt === null ||
      row.finishedAt < expiresAfter ||
      typeof filename !== 'string'
    ) {
      throw new NotFoundException(`User operation "${id}" has no result file`);
    }
    const url = await this.storage.getDownloadUrl(row.resultKey, { filename });
    return {
      url,
      filename,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
