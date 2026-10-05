import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AiSettings, AiSettingsResponse } from '@saas-skeleton/contracts';
import { AiAvailabilityService, readAiSettings } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { BootstrapRegistry } from '../settings/bootstrap-registry';
import { SettingsService } from '../settings/settings.service';

/**
 * Секція `ai` налаштувань організації (AI-1c, AI-5a) — персона, інструкції і вмикач
 * Tenant Admin. Зберігає її settings (`Tenant.settings` JSON, `updateSection`), а схема,
 * читання і ендпоінти — тут, у фічі (docs/modules.md §4).
 *
 * Читач спільний із воркером (`readAiSettings` у libs/shared): саме воркер кладе цей текст
 * у промпт, і «що збережено» має означати для обох одне й те саме.
 */
@Injectable()
export class AiSettingsService implements OnModuleInit {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly availability: AiAvailabilityService,
    private readonly bootstrap: BootstrapRegistry,
  ) {}

  /** `features.ai` у bootstrap: усі чотири рівні — інсталяція, платформа, дозвіл tenant-у, Tenant Admin */
  onModuleInit(): void {
    this.bootstrap.flag('ai', async () => (await this.availability.forCurrentTenant()).available);
  }

  async get(): Promise<AiSettingsResponse> {
    const organization = await this.settings.current();
    return this.withAvailability(this.parse(organization.settings));
  }

  /** Доступність рахується ПІСЛЯ запису — екран одразу бачить, чи зміна щось увімкнула */
  async update(data: AiSettings, actor: JwtPayload): Promise<AiSettingsResponse> {
    const settings = await this.settings.updateSection('ai', data, actor);
    return this.withAvailability(this.parse(settings));
  }

  private async withAvailability(section: AiSettings): Promise<AiSettingsResponse> {
    return { ...section, availability: await this.availability.forCurrentTenant() };
  }

  private parse(settings: unknown): AiSettings {
    const { settings: ai, valid } = readAiSettings(settings);
    if (!valid) {
      this.logger.warn('AI settings section is invalid — falling back to defaults');
    }
    return ai;
  }
}
