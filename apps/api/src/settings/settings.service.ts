import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Tenant } from '@saas-skeleton/database';
import type { AiSettings, CalendarSettings, GeneralSettings } from '@saas-skeleton/contracts';
import { CALENDAR_SETTINGS_DEFAULTS, CalendarSettingsSchema } from '@saas-skeleton/contracts';
import { ActivityRecorder, readAiSettings } from '@saas-skeleton/shared';
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
   * Секція `calendar` живе в `Tenant.settings` JSON (docs/calendar.md §9.5) —
   * перший реальний споживач гібридного сховища з docs/settings.md.
   *
   * Відсутній ключ читається як ДЕФОЛТИ схеми, тому наявним тенантам не
   * потрібен ні бекфіл, ні міграція: рядок зʼявляється лише коли адмін щось
   * змінив (той самий патерн, що `notification_preferences`). Сміття в JSON
   * (чужий райтер, старий формат) теж не валить читання — `catch` віддає
   * дефолти, бо календар мусить намалюватись навіть із зіпсованим конфігом.
   */
  async calendar(): Promise<CalendarSettings> {
    const organization = await this.current();
    return this.parseCalendar(organization.settings);
  }

  /**
   * Json-секція = read-modify-write у транзакції (docs/settings.md § «RLS та
   * транзакційність»): без цього конкурентний PUT сусідньої секції затер би
   * ключі, які ми не чіпали.
   */
  async updateCalendar(data: CalendarSettings, actor: JwtPayload): Promise<CalendarSettings> {
    const current = await this.current();

    return this.tenantTx.withTenantTx(async (tx) => {
      const fresh = await tx.tenant.findUniqueOrThrow({
        where: { id: current.id },
        select: { settings: true },
      });
      const settings = {
        ...(typeof fresh.settings === 'object' && fresh.settings !== null && !Array.isArray(fresh.settings)
          ? fresh.settings
          : {}),
        calendar: data,
      };
      const updated = await tx.tenant.update({
        where: { id: current.id },
        data: { settings },
      });

      await this.activities.record(tx, {
        type: 'settings.updated',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: { section: 'calendar' },
        links: [{ entityType: 'tenant', entityId: updated.id, role: 'subject' }],
      });

      this.logger.log(`Calendar settings updated: ${updated.slug}`);
      return this.parseCalendar(updated.settings);
    });
  }

  /** Порожній/невалідний ключ → дефолти схеми, а не помилка (див. calendar()) */
  parseCalendar(settings: unknown): CalendarSettings {
    const section =
      typeof settings === 'object' && settings !== null && !Array.isArray(settings)
        ? (settings as Record<string, unknown>).calendar
        : undefined;
    // Відсутні ключі добиваються константою дефолтів, а не `.default()` у схемі
    // (див. CALENDAR_SETTINGS_DEFAULTS): так наявним тенантам не потрібен бекфіл,
    // а новий тумблер зʼявляється без міграції
    const parsed = CalendarSettingsSchema.safeParse({
      ...CALENDAR_SETTINGS_DEFAULTS,
      ...(typeof section === 'object' && section !== null && !Array.isArray(section)
        ? section
        : {}),
    });
    if (parsed.success) {
      return parsed.data;
    }
    // Зіпсована секція (чужий райтер, старий формат) не має валити календар:
    // він мусить намалюватись навіть із нечитабельним конфігом
    this.logger.warn('Calendar settings section is invalid — falling back to defaults');
    return CALENDAR_SETTINGS_DEFAULTS;
  }

  /**
   * Секція `ai` (AI-1c) — персона й інструкції асистента. Той самий JSON-патерн,
   * що `calendar`, але читач спільний із воркером (`readAiSettings` у libs/shared):
   * саме воркер кладе цей текст у промпт, і «що збережено» має означати для обох
   * одне й те саме.
   */
  async ai(): Promise<AiSettings> {
    const organization = await this.current();
    return this.parseAi(organization.settings);
  }

  async updateAi(data: AiSettings, actor: JwtPayload): Promise<AiSettings> {
    const current = await this.current();

    return this.tenantTx.withTenantTx(async (tx) => {
      const fresh = await tx.tenant.findUniqueOrThrow({
        where: { id: current.id },
        select: { settings: true },
      });
      const settings = {
        ...(typeof fresh.settings === 'object' && fresh.settings !== null && !Array.isArray(fresh.settings)
          ? fresh.settings
          : {}),
        ai: data,
      };
      const updated = await tx.tenant.update({
        where: { id: current.id },
        data: { settings },
      });

      // Лише назва секції: сам текст — конфігурація, яку читає тільки ADMIN, і в
      // стрічку активності (її бачать ширше) він не копіюється
      await this.activities.record(tx, {
        type: 'settings.updated',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: { section: 'ai' },
        links: [{ entityType: 'tenant', entityId: updated.id, role: 'subject' }],
      });

      this.logger.log(`AI assistant settings updated: ${updated.slug}`);
      return this.parseAi(updated.settings);
    });
  }

  private parseAi(settings: unknown): AiSettings {
    const { settings: ai, valid } = readAiSettings(settings);
    if (!valid) {
      this.logger.warn('AI settings section is invalid — falling back to defaults');
    }
    return ai;
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
