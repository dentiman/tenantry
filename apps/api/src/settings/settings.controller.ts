import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  ActivityListResponse,
  SettingsBootstrap,
  GeneralSettingsResponse,
} from '@saas-skeleton/contracts';
import { Role } from '@saas-skeleton/database';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { ActivitiesService } from '../activities/activities.service';
import { toActivityResponse } from '../activities/activities.mapper';
import { ActivityListResponseDto } from '../activities/dto/activity-response.dto';
import {
  SettingsBootstrapDto,
  GeneralSettingsDto,
  GeneralSettingsResponseDto,
} from './dto/settings.dto';
import { SettingsActivityQueryDto } from './dto/settings-activity-query.dto';
import { toSettingsBootstrap, toGeneralSettingsResponse } from './settings.mapper';

/**
 * Налаштування ОРГАНІЗАЦІЇ (docs/settings.md). Дзеркало `/account`: суб'єкт
 * береться з токена, **id у шляху немає** — саме відсутність id і є твердженням
 * «чужа організація через цей ендпоінт недосяжна».
 *
 * Словом `settings` володіє організація, особисте живе під `/account` — патерн
 * GitLab / Stripe / Notion. Перегляд попереднього іменування (`/workspace`) —
 * у docs/settings.md § «Перегляд рішень».
 *
 * Читання відкрите всім автентифікованим (валюта й локаль потрібні кожному
 * екрану), запис — ТІЛЬКИ ADMIN: зміна валюти чи нумерації стосується всієї
 * компанії, а не автора дії.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly activities: ActivitiesService,
  ) {}

  /**
   * Курований read-only зріз для SPA: вантажиться раз на старті сесії.
   * Свідомо доступний УСІМ ролям — на відміну від редактора нижче.
   */
  @Get('bootstrap')
  @ApiOkResponse({ type: SettingsBootstrapDto.Output })
  async bootstrap(): Promise<SettingsBootstrap> {
    return toSettingsBootstrap(await this.settings.current());
  }

  @Get('general')
  @ApiOkResponse({ type: GeneralSettingsResponseDto.Output })
  async general(): Promise<GeneralSettingsResponse> {
    return toGeneralSettingsResponse(await this.settings.current());
  }

  /**
   * PUT, а не PATCH: секція — один документ, і повна заміна ідемпотентна.
   * `slug` у схемі відсутній фізично — його змінює лише оператор платформи
   * (на ньому тримається логін по slug).
   */
  @Put('general')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: GeneralSettingsResponseDto.Output })
  async updateGeneral(
    @Body() dto: GeneralSettingsDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<GeneralSettingsResponse> {
    return toGeneralSettingsResponse(await this.settings.updateGeneral(dto, actor));
  }

  /**
   * Журнал змін налаштувань компанії. Окремий ендпоінт, а не
   * `GET /activities?entityType=tenant&entityId=…`, рівно з тієї ж причини, що
   * й решта секції: id організації клієнту не віддається і в шляху не фігурує —
   * сутність береться з токена. Пагінація — той самий курсор, сервіс той самий.
   */
  @Get('activity')
  @ApiOkResponse({ type: ActivityListResponseDto.Output })
  async activity(
    @Query() query: SettingsActivityQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ActivityListResponse> {
    const { items, nextCursor } = await this.activities.findAll({
      // Поля перелічені явно: `query` — інстанс DTO-класу, і спред зняв би з нього
      // прототип (ESLint ловить це окремим правилом)
      cursor: query.cursor,
      limit: query.limit,
      entityType: 'tenant',
      entityId: actor.tenantId,
    });
    return { items: items.map(toActivityResponse), nextCursor };
  }
}
