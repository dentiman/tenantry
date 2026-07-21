import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ActivityListResponse } from '@saas-skeleton/contracts';
import { ActivitiesService } from './activities.service';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { ActivityListResponseDto } from './dto/activity-response.dto';
import { toActivityResponse } from './activities.mapper';

@ApiTags('activities')
@ApiBearerAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @ApiOkResponse({ type: ActivityListResponseDto.Output })
  async findAll(@Query() query: ActivityQueryDto): Promise<ActivityListResponse> {
    const { items, nextCursor } = await this.activitiesService.findAll(query);
    return { items: items.map(toActivityResponse), nextCursor };
  }
}
