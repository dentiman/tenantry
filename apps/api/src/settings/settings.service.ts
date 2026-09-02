import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Tenant } from '@saas-skeleton/database';
import type { GeneralSettings } from '@saas-skeleton/contracts';
import { ActivityRecorder } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Налаштування організації — те, що належить компанії, а не людині.
 *
 * `where: { id }` тут узагалі не потрібен у сенсі ізоляції: RLS-політика
 * `own_tenant` фізично не дасть побачити чужий рядок `tenants`, тому сервіс
 * бере ПЕРШИЙ видимий — він же єдиний. Це та сама доктрина, що в решті домену:
 * tenantId у коді не згадується.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
  ) {}

  async current(): Promise<Tenant> {
    const organization = await this.prisma.tenant.findFirst();
    if (!organization) {
      // Недосяжно за наявності контексту: RLS показує рівно один рядок.
      // Явна помилка замість `!` — щоб зникнення контексту не стало 500-кою
      // з незрозумілим стеком
      throw new NotFoundException('Organization not found for the current context');
    }
    return organization;
  }

  /**
   * PUT-семантика: секція — один документ, приходить цілком. Часткових
   * оновлень тут немає свідомо — інакше «прибрати значення» і «не чіпати поле»
   * стають нерозрізнюваними на формі з трьох полів.
   */
  async updateGeneral(data: GeneralSettings, actor: JwtPayload): Promise<Tenant> {
    const current = await this.current();

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: current.id },
        data: { name: data.name, locale: data.locale, currency: data.currency },
      });

      // Зміна налаштувань компанії — подія, за якою приходять питати «хто це
      // зробив»: вона стосується всіх, а не лише автора
      await this.activities.record(tx, {
        type: 'settings.updated',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: { section: 'general' },
        // entityType — внутрішній ключ фіда (назовні не віддається), тому тут
        // технічно точне 'tenant', а не UI-лейбл
        links: [{ entityType: 'tenant', entityId: updated.id, role: 'subject' }],
      });

      this.logger.log(`Organization settings updated: ${updated.slug}`);
      return updated;
    });
  }
}
