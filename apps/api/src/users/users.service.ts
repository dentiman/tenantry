import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { CreateUser, UpdateUser, UserQuery } from '@saas-skeleton/contracts';
import { IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import { ActivityRecorder, MessagePublisher, userRegisteredEvent } from '@saas-skeleton/shared';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import * as argon2 from 'argon2';
import { fieldConflictException } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

/** avatarFile потрібен контролеру для presign мініатюри в UserResponse.avatarUrl */
export type UserWithAvatar = Prisma.UserGetPayload<{ include: { avatarFile: true } }>;

/**
 * phone і phoneCountry — одна неподільна пара, і тримається вона ТУТ, а не крос-полевим
 * refine у контракті (той зробив би зі схеми ZodEffects і зламав .omit()/.partial(),
 * якими UpdateUserSchema виводиться з CreateUserSchema).
 *
 * Правила: телефон стерли → країну теж; країну не прислали → виводимо з самого номера
 * (для +380 однозначно; для +1 клієнт має прислати явно — інакше буде US);
 * телефон у патчі відсутній → пари не чіпаємо взагалі, навіть якщо прислали саму країну.
 */
function normalizePhonePair(data: {
  phone?: string | null;
  phoneCountry?: string | null;
}): { phone?: string | null; phoneCountry?: string | null } {
  if (data.phone === undefined) return {};
  if (data.phone === null) return { phone: null, phoneCountry: null };

  return {
    phone: data.phone,
    phoneCountry: data.phoneCountry ?? parsePhoneNumberFromString(data.phone)?.country ?? null,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagePublisher,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
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

  async create(data: CreateUser, actor: JwtPayload): Promise<UserWithAvatar> {
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
    const phonePatch = normalizePhonePair(rest);

    // Атомарно: юзер + активність + публікація події (по job-у в чергу КОЖНОГО
    // підписника з MESSAGE_TOPOLOGY). Або все, або нічого — welcome-лист без
    // user.created не мав би сенсу.
    const user = await this.tenantTx.withTenantTx(async (tx) => {
      const created = await tx.user.create({
        data: { ...rest, ...phonePatch, passwordHash },
        include: { avatarFile: true },
      });

      await this.activities.record(tx, {
        type: 'user.created',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {
          user: { kind: 'user', id: created.id, label: created.name ?? created.email },
        },
        links: [{ entityType: 'user', entityId: created.id, role: 'subject' }],
      });

      // Продюсер НЕ знає підписників: fan-out робить publish за маніфестом
      await this.messages.publish(
        tx,
        userRegisteredEvent,
        { userId: created.id, email: created.email },
        {
          singletonKey: created.id,
          actor: { type: 'user', id: actor.sub, label: actor.email },
        },
      );

      return created;
    });

    this.logger.log(`User created successfully: ${user.email} (ID: ${user.id})`);
    return user;
  }

  async update(id: string, data: UpdateUser): Promise<UserWithAvatar> {
    this.logger.log(`Updating user: ${id}`);
    if (typeof data.avatarFileId === 'string') {
      await this.assertUsableAvatar(data.avatarFileId);
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...data, ...normalizePhonePair(data) },
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
