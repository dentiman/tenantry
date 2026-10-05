import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CalendarSettings } from '@saas-skeleton/contracts';
import { CALENDAR_SETTINGS_DEFAULTS, CalendarSettingsSchema } from '@saas-skeleton/contracts';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { BootstrapRegistry } from '../settings/bootstrap-registry';
import { SettingsService } from '../settings/settings.service';

/**
 * Секція `calendar` налаштувань організації — дефолти КОМПАНІЇ для календаря
 * (docs/calendar.md §9.5). Зберігає її settings (`Tenant.settings` JSON, `updateSection`),
 * а схема, розбір, ендпоінти і внесок у bootstrap — тут, у фічі (docs/modules.md §4).
 *
 * Відсутній ключ читається як ДЕФОЛТИ схеми, тому наявним тенантам не потрібен ні бекфіл,
 * ні міграція: рядок зʼявляється лише коли адмін щось змінив (той самий патерн, що
 * `notification_preferences`).
 */
@Injectable()
export class CalendarSettingsService implements OnModuleInit {
  private readonly logger = new Logger(CalendarSettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly bootstrap: BootstrapRegistry,
  ) {}

  /**
   * Дефолти календаря їдуть у bootstrap: без них першим рендером неможливо намалювати
   * сітку (перший день тижня і робочі години), а другий запит дав би стрибок розкладки
   */
  onModuleInit(): void {
    this.bootstrap.section('calendar', (organization) => this.parse(organization.settings));
  }

  async get(): Promise<CalendarSettings> {
    const organization = await this.settings.current();
    return this.parse(organization.settings);
  }

  async update(data: CalendarSettings, actor: JwtPayload): Promise<CalendarSettings> {
    return this.parse(await this.settings.updateSection('calendar', data, actor));
  }

  /** Порожній/невалідний ключ → дефолти схеми, а не помилка */
  private parse(settings: unknown): CalendarSettings {
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
}
