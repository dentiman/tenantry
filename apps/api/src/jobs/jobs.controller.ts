import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JobListResponse, QueueStatsResponse } from '@saas-skeleton/contracts';
import { JobsService } from './jobs.service';
import { JobQueryDto } from './dto/job-query.dto';
import { JobListResponseDto, QueueStatsResponseDto } from './dto/job-response.dto';
import { toJobResponse, toQueueStats } from './jobs.mapper';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  @ApiOkResponse({ type: JobListResponseDto.Output })
  async findAll(@Query() query: JobQueryDto): Promise<JobListResponse> {
    const { items, total, page, limit } = await this.jobsService.findAll(query);
    return {
      items: items.map(toJobResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get('queues')
  @ApiOkResponse({ type: QueueStatsResponseDto.Output })
  async queues(): Promise<QueueStatsResponse> {
    const rows = await this.jobsService.queueStats();
    return { queues: toQueueStats(rows) };
  }
}
