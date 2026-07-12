import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { User as PrismaUser } from '@saas-skeleton/database';
import type { CreateUser, UpdateUser, UserQuery } from '@saas-skeleton/contracts';
import { JobDispatcher, userRegisteredJob } from '@saas-skeleton/shared';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobDispatcher: JobDispatcher,
  ) {}

  async findAll(query: UserQuery): Promise<{
    items: PrismaUser[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, role, isActive, search } = query;
    this.logger.debug(
      `Fetching users list - page: ${String(page)}, limit: ${String(limit)}, role: ${role ?? 'all'}, isActive: ${String(isActive ?? 'all')}, search: ${search ?? 'none'}`,
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

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    this.logger.log(`Fetched ${String(items.length)} users (total: ${String(total)})`);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<PrismaUser> {
    this.logger.debug(`Fetching user by id: ${id}`);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      this.logger.warn(`User not found: ${id}`);
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    this.logger.debug(`User found: ${user.email}`);
    return user;
  }

  async create(data: CreateUser): Promise<PrismaUser> {
    this.logger.log(`Creating new user: ${data.email}`);
    // password не потрапляє в Prisma напряму — зберігається тільки argon2-хеш
    const { password, ...rest } = data;
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({ data: { ...rest, passwordHash } });
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

  async update(id: string, data: UpdateUser): Promise<PrismaUser> {
    this.logger.log(`Updating user: ${id}`);
    const user = await this.prisma.user.update({ where: { id }, data });
    this.logger.log(`User updated successfully: ${user.email} (ID: ${user.id})`);
    return user;
  }

  async remove(id: string): Promise<PrismaUser> {
    this.logger.log(`Deleting user: ${id}`);
    const user = await this.prisma.user.delete({ where: { id } });
    this.logger.log(`User deleted successfully: ${user.email} (ID: ${user.id})`);
    return user;
  }
}
