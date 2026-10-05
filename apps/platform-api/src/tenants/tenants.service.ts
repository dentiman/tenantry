import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { TenantWithAiAccess } from './tenants.mapper';
import { TenantLifecycleHooks } from './tenant-lifecycle.hooks';
import type { CreateTenant, TenantQuery, UpdateTenant } from '@saas-skeleton/contracts/platform';
import { fieldConflictException } from '@saas-skeleton/shared/errors';
import * as argon2 from 'argon2';

/** Назва дефолтного каналу чату (docs/chat.md §7.4) */

/** Дозвіл AI-асистента поруч із tenant-ом у кожній відповіді (AI-5a) */
const AI_ACCESS = { aiAccess: { select: { allowed: true } } } as const;

/**
 * CRUD тенантів — ЄДИНЕ місце в системі, де tenant-и створюються/suspend-яться
 * (у tenant-api під RLS це неможливо структурно: WITH CHECK на tenants).
 * Голий $transaction тут легальний: system-клієнт BYPASSRLS, set_config не потрібен —
 * ESLint-заборона діє тільки на tenant-застосунки (apps/api, apps/worker).
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly lifecycle: TenantLifecycleHooks,
  ) {}

  async findAll(query: TenantQuery): Promise<{
    items: TenantWithAiAccess[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, isActive, search, sortBy, sortOrder } = query;

    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { slug: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    // tie-breaker по id обов'язковий — інакше пагінація "пливе" при рівних значеннях sortBy
    const orderBy = sortBy
      ? [{ [sortBy]: sortOrder ?? 'asc' }, { id: 'desc' as const }]
      : [{ createdAt: 'asc' as const }, { id: 'desc' as const }];

    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: AI_ACCESS,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<TenantWithAiAccess> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, include: AI_ACCESS });
    if (!tenant) {
      throw new NotFoundException(`Tenant with id "${id}" not found`);
    }
    return tenant;
  }

  /**
   * Створення = Tenant + перший admin в ОДНІЙ транзакції (або все, або нічого).
   * Початковий пароль admin-а задає оператор (рішення 2026-07-16; invite-флоу — MT-4).
   */
  async create(data: CreateTenant): Promise<TenantWithAiAccess> {
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
      const admin = await tx.user.create({
        data: {
          tenantId: created.id,
          email: data.admin.email,
          name: data.admin.name ?? null,
          passwordHash,
          role: 'ADMIN',
          locale: data.locale,
        },
      });

      // Те, що є частиною появи тенанта (дефолтний канал чату), реєструють самі
      // модулі-фічі — у цій же транзакції, тож «тенант без каналу» не існує як стан
      await this.lifecycle.runCreated(tx, { id: created.id, admin });

      return created;
    });

    this.logger.log(`Tenant created: ${tenant.slug} (${tenant.id}), admin: ${data.admin.email}`);
    // Новий tenant без запису дозволу — дозволено, як і решта (AI-5a)
    return { ...tenant, aiAccess: null };
  }

  /** suspend/resume (isActive) + перейменування; login у data plane реагує миттєво */
  async update(id: string, data: UpdateTenant): Promise<TenantWithAiAccess> {
    await this.findOne(id);
    const { aiAllowed, ...fields } = data;
    const tenant = await this.prisma.$transaction(async (tx) => {
      // Дозвіл AI — окрема таблиця, яку tenant-процеси лише читають (AI-5a, design.md D4)
      if (aiAllowed !== undefined) {
        await tx.tenantAiAccess.upsert({
          where: { tenantId: id },
          create: { tenantId: id, allowed: aiAllowed },
          update: { allowed: aiAllowed },
        });
      }
      return tx.tenant.update({ where: { id }, data: fields, include: AI_ACCESS });
    });
    this.logger.log(
      `Tenant updated: ${tenant.slug} (${tenant.id})${data.isActive !== undefined ? ` — isActive: ${String(data.isActive)}` : ''}`,
    );
    return tenant;
  }
}
