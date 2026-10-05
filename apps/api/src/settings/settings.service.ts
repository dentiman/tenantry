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
   * Замінити одну секцію `Tenant.settings` JSON і записати це в журнал змін. Повертає
   * весь JSON після запису — секцію з нього розбирає її власник.
   *
   * Сховищем секцій володіє settings, а схемою секції — модуль, якому вона належить:
   * `calendar` і `ai` викликають це зі своїх контролерів (docs/modules.md §4), і settings
   * не знає, що в секції. Активність несе лише назву секції: вміст — конфігурація, яку може читати
   * вужче коло, ніж стрічку активності (так у `ai` — лише ADMIN).
   *
   * Read-modify-write під `SELECT … FOR UPDATE` (docs/backend-conventions.md §4): JSON
   * переписується цілком, тож без блокування рядка два паралельні PUT різних секцій
   * прочитали б той самий знімок, і пізніший затер би секцію раннього.
   */
  async updateSection(section: string, value: object, actor: JwtPayload): Promise<unknown> {
    const current = await this.current();

    return this.tenantTx.withTenantTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${current.id} FOR UPDATE`;
      const fresh = await tx.tenant.findUniqueOrThrow({
        where: { id: current.id },
        select: { settings: true },
      });
      const settings = {
        ...(typeof fresh.settings === 'object' &&
        fresh.settings !== null &&
        !Array.isArray(fresh.settings)
          ? fresh.settings
          : {}),
        [section]: value,
      };
      const updated = await tx.tenant.update({
        where: { id: current.id },
        data: { settings },
      });

      await this.activities.record(tx, {
        type: 'settings.updated',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: { section },
        links: [{ entityType: 'tenant', entityId: updated.id, role: 'subject' }],
      });

      this.logger.log(`Settings section "${section}" updated: ${updated.slug}`);
      return updated.settings;
    });
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
