import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { TenantWithAiAccess } from './tenants.mapper';
import type { CreateTenant, TenantQuery, UpdateTenant } from '@saas-skeleton/contracts/platform';
import { fieldConflictException } from '@saas-skeleton/shared/errors';
import * as argon2 from 'argon2';

/** Назва дефолтного каналу чату (docs/chat.md §7.4) */
const DEFAULT_CHANNEL_TITLE = 'General';

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

  constructor(private readonly prisma: SystemPrismaService) {}

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

      // Дефолтний канал чату народжується РАЗОМ із тенантом (design.md D3):
      // інакше тенант, створений оператором, лишився б єдиним без нього, а
      // tenant-api його не полагодить — там канал уже вважається інваріантом.
      // tenantId скрізь явний: system-клієнт BYPASSRLS, DB-default (current_setting)
      // тут дав би NULL
      const channel = await tx.conversation.create({
        data: {
          tenantId: created.id,
          kind: 'INTERNAL',
          access: 'private',
          isDefault: true,
          title: DEFAULT_CHANNEL_TITLE,
          lastSeq: 2,
          lastMessageAt: new Date(),
        },
      });
      await tx.conversationParticipant.create({
        data: {
          tenantId: created.id,
          conversationId: channel.id,
          userId: admin.id,
          role: 'member',
          // Приєднання не створює непрочитаних
          joinSeq: 2,
          lastReadSeq: 2,
        },
      });
      // Стрічка непорожня з першої секунди. Текст не зберігається: type + params,
      // рендер через i18next (docs/chat.md §4.7)
      await tx.chatMessage.createMany({
        data: [
          {
            tenantId: created.id,
            conversationId: channel.id,
            seq: 1,
            kind: 'SYSTEM',
            senderType: 'system',
            payload: { type: 'conversation.created' },
          },
          {
            tenantId: created.id,
            conversationId: channel.id,
            seq: 2,
            kind: 'SYSTEM',
            senderType: 'system',
            payload: {
              type: 'member.added',
              member: { id: admin.id, label: admin.name ?? admin.email },
            },
          },
        ],
      });

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
