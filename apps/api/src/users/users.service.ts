import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { CreateUser, UpdateUser, UserQuery } from '@saas-skeleton/contracts';
import { IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import {
  ActivityRecorder,
  MessagePublisher,
  NotificationRecorder,
  recipientsByRole,
  userRegisteredEvent,
} from '@saas-skeleton/shared';
import { Role } from '@saas-skeleton/database';
import * as argon2 from 'argon2';
import { fieldConflictException } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
// Пара phone/phoneCountry узгоджується одним правилом на застосунок (common/phone.ts):
// те саме поле є в кастомерів і їхніх контактів
import { normalizePhonePair } from '../common/phone';

/** avatarFile потрібен контролеру для presign мініатюри в UserResponse.avatarUrl */
export type UserWithAvatar = Prisma.UserGetPayload<{ include: { avatarFile: true } }>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagePublisher,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
    private readonly notifications: NotificationRecorder,
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

      // Кого це стосується, вирішує домен (docs/notifications.md): поява юзера —
      // подія для адмінів воркспейсу. Автор дії відсіюється в recorder-і.
      // groupKey: адмін, який заводить команду підряд, отримає ОДИН рядок
      // «створено N юзерів», а не п'ять однакових
      await this.notifications.notify(tx, {
        type: 'user.created',
        recipientIds: await recipientsByRole(tx, Role.ADMIN, [actor.sub]),
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {
          user: { kind: 'user', id: created.id, label: created.name ?? created.email },
        },
        target: { kind: 'user', id: created.id },
        groupKey: 'user.created',
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

  /**
   * Зміна пароля адміном — окремий флоу, не PATCH: разом із хешем ОБОВ'ЯЗКОВО
   * відкликаються всі refresh-сесії юзера. Інакше зміна пароля не витісняє того,
   * хто вже сидить у викраденій сесії, — тобто не робить того, заради чого її роблять.
   * Access-токени (15m) лишаються дійсними до закінчення — це свідома межа
   * stateless-JWT, миттєвий kill-switch — це disable.
   */
  async setPassword(id: string, password: string, actor: JwtPayload): Promise<void> {
    this.logger.log(`Changing password for user: ${id}`);
    const user = await this.findOne(id);

    // argon2 рахуємо ДО транзакції — це ~100мс CPU, тримати на них відкриту
    // транзакцію (і рядок під блокуванням) немає причин
    const passwordHash = await argon2.hash(password);

    await this.tenantTx.withTenantTx(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      const revoked = await tx.refreshToken.deleteMany({ where: { userId: id } });

      await this.activities.record(tx, {
        type: 'user.password_changed',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        // Ні пароля, ні хеша, ні довжини — у журналі лише факт і його учасники
        payload: { user: { kind: 'user', id: user.id, label: user.name ?? user.email } },
        links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
      });

      // Сповіщення про безпеку — самому юзеру. Тип немутабельний: людина мусить
      // дізнатись про зміну свого пароля незалежно від налаштувань. Якщо адмін
      // змінив пароль СОБІ, recorder відсіє його як автора дії
      await this.notifications.notify(tx, {
        type: 'user.password_changed',
        recipientIds: [user.id],
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {},
      });

      this.logger.log(
        `Password changed for ${user.email} (ID: ${id}); revoked ${String(revoked.count)} refresh session(s)`,
      );
    });
  }

  /**
   * Вмикання/вимикання доступу. Повторний виклик із тим самим значенням — no-op
   * БЕЗ запису в журнал: активність — це факт зміни, а не факт натискання тумблера
   * (інакше подвійний клік у гріді засмічував би фід).
   */
  async setStatus(id: string, isActive: boolean, actor: JwtPayload): Promise<UserWithAvatar> {
    // Замкнути себе не можна навіть в обхід UI: адмін, що вимкнув власний доступ,
    // не має ким його повернути (у тенанті може не бути другого адміна)
    if (id === actor.sub) {
      throw new BadRequestException({
        message: 'You cannot change the status of your own account',
        fieldErrors: [
          { field: 'isActive', message: 'You cannot disable yourself', code: 'self_status_change' },
        ],
      });
    }

    const user = await this.findOne(id);
    if (user.isActive === isActive) {
      this.logger.debug(`User ${id} already ${isActive ? 'enabled' : 'disabled'} - no-op`);
      return user;
    }

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { isActive },
        include: { avatarFile: true },
      });

      // Вимкнення = kill-switch: сесії йдуть разом із доступом. /auth/refresh і так
      // перевіряє isActive, але лишати живі рядки токенів після відкликання доступу
      // означало б, що повернення прапорця тихо воскресить старі сесії
      if (!isActive) {
        await tx.refreshToken.deleteMany({ where: { userId: id } });
      }

      await this.activities.record(tx, {
        type: isActive ? 'user.enabled' : 'user.disabled',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: { user: { kind: 'user', id: updated.id, label: updated.name ?? updated.email } },
        links: [{ entityType: 'user', entityId: updated.id, role: 'subject' }],
      });

      this.logger.log(`User ${updated.email} (ID: ${id}) ${isActive ? 'enabled' : 'disabled'}`);
      return updated;
    });
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
