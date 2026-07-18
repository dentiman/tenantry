import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { Tenant } from '@saas-skeleton/database';
import type { CreateTenant, UpdateTenant } from '@saas-skeleton/contracts/platform';
import { fieldConflictException } from '@saas-skeleton/shared/errors';
import * as argon2 from 'argon2';

/**
 * CRUD тенантів — ЄДИНЕ місце в системі, де tenant-и створюються/suspend-яться
 * (у tenant-api під RLS це неможливо структурно: WITH CHECK на tenants).
 * Голий $transaction тут легальний: system-клієнт BYPASSRLS, set_config не потрібен —
 * ESLint-заборона діє тільки на tenant-застосунки (apps/api, apps/worker).
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly prisma: SystemPrismaService) {}

  async findAll(): Promise<{ items: Tenant[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.tenant.count(),
    ]);
    return { items, total };
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant with id "${id}" not found`);
    }
    return tenant;
  }

  /**
   * Створення = Tenant + перший admin в ОДНІЙ транзакції (або все, або нічого).
   * Початковий пароль admin-а задає оператор (рішення 2026-07-16; invite-флоу — MT-4).
   */
  async create(data: CreateTenant): Promise<Tenant> {
    this.logger.log(`Creating tenant: ${data.slug}`);

    const existing = await this.prisma.tenant.findUnique({ where: { slug: data.slug } });
    if (existing) {
      this.logger.warn(`Tenant creation failed - slug already exists: ${data.slug}`);
      throw fieldConflictException('slug', 'Slug already in use');
    }

    const passwordHash = await argon2.hash(data.admin.password);
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { slug: data.slug, name: data.name, locale: data.locale },
      });
      await tx.user.create({
        data: {
          tenantId: created.id,
          email: data.admin.email,
          name: data.admin.name ?? null,
          passwordHash,
          role: 'ADMIN',
          locale: data.locale,
        },
      });
      return created;
    });

    this.logger.log(`Tenant created: ${tenant.slug} (${tenant.id}), admin: ${data.admin.email}`);
    return tenant;
  }

  /** suspend/resume (isActive) + перейменування; login у data plane реагує миттєво */
  async update(id: string, data: UpdateTenant): Promise<Tenant> {
    await this.findOne(id);
    const tenant = await this.prisma.tenant.update({ where: { id }, data });
    this.logger.log(
      `Tenant updated: ${tenant.slug} (${tenant.id})${data.isActive !== undefined ? ` — isActive: ${String(data.isActive)}` : ''}`,
    );
    return tenant;
  }
}
