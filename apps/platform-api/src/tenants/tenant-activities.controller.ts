import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TenantActivityListResponse } from '@saas-skeleton/contracts/platform';
import { TenantActivitiesService } from './tenant-activities.service';
import {
  TenantActivityListResponseDto,
  TenantActivityQueryDto,
} from './dto/tenant-activity.dto';

@ApiTags('tenant-activities')
@ApiBearerAuth()
@Controller('tenants/:tenantId/activities')
export class TenantActivitiesController {
  constructor(private readonly activities: TenantActivitiesService) {}

  @Get()
  @ApiOkResponse({ type: TenantActivityListResponseDto.Output })
  findAll(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: TenantActivityQueryDto,
  ): Promise<TenantActivityListResponse> {
    return this.activities.findAll(tenantId, query);
  }
}
