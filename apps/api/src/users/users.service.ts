import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { CreateUser, UpdateUser, UserQuery } from '@saas-skeleton/contracts';
import { IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import { JobDispatcher, userRegisteredJob } from '@saas-skeleton/shared';
import * as argon2 from 'argon2';
import { fieldConflictException } from '@saas-skeleton/shared';

/** avatarFile потрібен контролеру для presign мініатюри в UserResponse.avatarUrl */
export type UserWithAvatar = Prisma.UserGetPayload<{ include: { avatarFile: true } }>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobDispatcher: JobDispatcher,
  ) {}

  async findAll(query: UserQuery): Promise<{
    items: UserWithAvatar[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, role, isActive, search, sortBy, sortOrder } = query;
    this.logger.debug(
      `Fetching users list - page: ${String(page)}, limit: ${String(limit)}, role: ${role ?? 'all'}, isActive: ${String(isActive ?? 'all')}, search: ${search ?? 'none'}, sortBy: ${sortBy ?? 'default'}`,
    );

    const where = {
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    // tie-breaker по id обов'язковий — інакше пагінація "пливе" при рівних значеннях sortBy
    const orderBy = sortBy
      ? [{ [sortBy]: sortOrder ?? 'asc' }, { id: 'desc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: { avatarFile: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    this.logger.log(`Fetched ${String(items.length)} users (total: ${String(total)})`);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<UserWithAvatar> {
    this.logger.debug(`Fetching user by id: ${id}`);
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { avatarFile: true },
    });
    if (!user) {
      this.logger.warn(`User not found: ${id}`);
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    this.logger.debug(`User found: ${user.email}`);
    return user;
  }

  async create(data: CreateUser): Promise<UserWithAvatar> {
    this.logger.log(`Creating new user: ${data.email}`);

    // Явна перевірка → 409 з fieldErrors по полю email; гонку добиває
    // unique-констрейнт (P2002 → той самий CONFLICT у AllExceptionsFilter).
    // findFirst, НЕ findUnique: unique тепер (tenant_id, email), скоупить tenant-контекст
    const existing = await this.prisma.user.findFirst({ where: { email: data.email } });
    if (existing) {
      this.logger.warn(`User creation failed - email already exists: ${data.email}`);
      throw fieldConflictException('email', 'Email already registered');
    }

    // password не потрапляє в Prisma напряму — зберігається тільки argon2-хеш
    const { password, ...rest } = data;
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: { ...rest, passwordHash },
      include: { avatarFile: true },
    });
    this.logger.log(`User created successfully: ${user.email} (ID: ${user.id})`);

    // Та сама подія, що й при самостійній реєстрації; черга — некритичний side effect
    try {
      await this.jobDispatcher.send(
        userRegisteredJob,
        { userId: user.id, email: user.email },
        { singletonKey: user.id },
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch ${userRegisteredJob.name} for user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return user;
  }

  async update(id: string, data: UpdateUser): Promise<UserWithAvatar> {
    this.logger.log(`Updating user: ${id}`);
    if (typeof data.avatarFileId === 'string') {
      await this.assertUsableAvatar(data.avatarFileId);
    }
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { avatarFile: true },
    });
    this.logger.log(`User updated successfully: ${user.email} (ID: ${user.id})`);
    return user;
  }

  /** Аватаром може стати лише підтверджений (READY) файл-зображення */
  private async assertUsableAvatar(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(file?.mimeType ?? '');
    if (file?.status !== 'READY' || !isImage) {
      throw new BadRequestException({
        message: 'avatarFileId must reference a completed image upload',
        fieldErrors: [
          { field: 'avatarFileId', message: 'Must be an uploaded image', code: 'invalid_file' },
        ],
      });
    }
  }

  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting user: ${id}`);
    const user = await this.prisma.user.delete({ where: { id } });
    this.logger.log(`User deleted successfully: ${user.email} (ID: ${user.id})`);
  }
}
