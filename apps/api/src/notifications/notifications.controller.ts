import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  NotificationListResponse,
  NotificationPreferenceList,
  NotificationResponse,
  NotificationSummary,
} from '@saas-skeleton/contracts';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { toNotificationResponse } from './notifications.mapper';
import {
  NotificationQueryDto,
  UpdateNotificationDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-query.dto';
import {
  NotificationListResponseDto,
  NotificationPreferenceListDto,
  NotificationResponseDto,
  NotificationSummaryDto,
} from './dto/notification-response.dto';

/**
 * Персональний інбокс (docs/notifications.md). Отримувач у КОЖНОМУ методі береться
 * з токена — параметра «чужий інбокс» у контракті немає й не буде.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: NotificationListResponseDto.Output })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListResponse> {
    const { items, nextCursor } = await this.notifications.findAll(user.sub, query);
    return { items: items.map(toNotificationResponse), nextCursor };
  }

  /** Snapshot бейджа: повний стан по HTTP, дельти — по socket (патерн presence) */
  @Get('summary')
  @ApiOkResponse({ type: NotificationSummaryDto.Output })
  getSummary(@CurrentUser() user: JwtPayload): Promise<NotificationSummary> {
    return this.notifications.summary(user.sub);
  }

  @Get('preferences')
  @ApiOkResponse({ type: NotificationPreferenceListDto.Output })
  async getPreferences(@CurrentUser() user: JwtPayload): Promise<NotificationPreferenceList> {
    return { items: await this.notifications.preferences(user.sub) };
  }

  @Put('preferences')
  @ApiOkResponse({ type: NotificationPreferenceListDto.Output })
  async setPreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceList> {
    return { items: await this.notifications.setPreferences(user.sub, dto) };
  }

  @Post('mark-all-read')
  @ApiOkResponse({ type: NotificationSummaryDto.Output })
  markAllRead(@CurrentUser() user: JwtPayload): Promise<NotificationSummary> {
    return this.notifications.markAllRead(user.sub);
  }

  @Post('seen')
  @ApiOkResponse({ type: NotificationSummaryDto.Output })
  markSeen(@CurrentUser() user: JwtPayload): Promise<NotificationSummary> {
    return this.notifications.markSeen(user.sub);
  }

  @Patch(':id')
  @ApiOkResponse({ type: NotificationResponseDto.Output })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationDto,
  ): Promise<NotificationResponse> {
    return toNotificationResponse(await this.notifications.update(user.sub, id, dto));
  }
}
