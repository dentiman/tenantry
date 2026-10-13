import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ChannelUnroutableListResponse } from '@saas-skeleton/contracts/platform';
import { ChannelEventsService } from './channel-events.service';
import {
  ChannelUnroutableListQueryDto,
  ChannelUnroutableListResponseDto,
} from './dto/channel-events.dto';

@ApiTags('channel-events')
@ApiBearerAuth()
@Controller('channel-events')
export class ChannelEventsController {
  constructor(private readonly events: ChannelEventsService) {}

  @Get('unroutable')
  @ApiOkResponse({ type: ChannelUnroutableListResponseDto.Output })
  unroutable(@Query() query: ChannelUnroutableListQueryDto): Promise<ChannelUnroutableListResponse> {
    // Поля явно: `query` — інстанс DTO-класу, спред зняв би прототип
    return this.events.unroutable({ limit: query.limit, reason: query.reason });
  }
}
