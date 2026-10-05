import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { CalendarSettings } from '@saas-skeleton/contracts';
import { Role } from '@saas-skeleton/database';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CalendarSettingsService } from './calendar-settings.service';
import { CalendarSettingsDto } from './dto/calendar-settings.dto';

/**
 * `GET/PUT /settings/calendar` — секція налаштувань організації, якою володіє календар
 * (docs/modules.md §4): URL лишився під `/settings`, бо для людини це той самий розділ,
 * а код живе у фічі. Документ, повна заміна; читання всім, запис — ADMIN.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/calendar')
export class CalendarSettingsController {
  constructor(private readonly calendarSettings: CalendarSettingsService) {}

  @Get()
  @ApiOkResponse({ type: CalendarSettingsDto.Output })
  async get(): Promise<CalendarSettings> {
    return this.calendarSettings.get();
  }

  @Put()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: CalendarSettingsDto.Output })
  async update(
    @Body() dto: CalendarSettingsDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarSettings> {
    return this.calendarSettings.update(dto, actor);
  }
}
