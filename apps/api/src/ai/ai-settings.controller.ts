import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AiSettingsResponse } from '@saas-skeleton/contracts';
import { Role } from '@saas-skeleton/database';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiSettingsService } from './ai-settings.service';
import { AiSettingsDto, AiSettingsResponseDto } from './dto/ai-settings.dto';

/**
 * `GET/PUT /settings/ai` — секція налаштувань організації, якою володіє фіча (docs/modules.md
 * §4): URL лишився під `/settings`, бо для людини це той самий розділ, а код живе в `ai`.
 *
 * На відміну від решти секцій, ADMIN-only і ЧИТАННЯ теж: жоден екран поза редактором її не
 * потребує (воркер читає рядок тенанта сам), а адмін може писати туди внутрішні
 * формулювання — найменші привілеї.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/ai')
export class AiSettingsController {
  constructor(private readonly aiSettings: AiSettingsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: AiSettingsResponseDto.Output })
  async get(): Promise<AiSettingsResponse> {
    return this.aiSettings.get();
  }

  /** Секція разом із вмикачем Tenant Admin (AI-5a), повна заміна */
  @Put()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: AiSettingsResponseDto.Output })
  async update(
    @Body() dto: AiSettingsDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<AiSettingsResponse> {
    return this.aiSettings.update(dto, actor);
  }
}
