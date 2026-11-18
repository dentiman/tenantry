import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  UserOperationListResponse,
  UserOperationResponse,
  UserOperationResultUrlResponse,
} from '@saas-skeleton/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  UserOperationListQueryDto,
  UserOperationListResponseDto,
  UserOperationResponseDto,
  UserOperationResultUrlResponseDto,
} from './user-operation.dto';
import { toUserOperationResponse } from './user-operations.mapper';
import { UserOperationsReadService } from './user-operations-read.service';

/**
 * Операції користувача (docs/user-operations.md §5). Запуск — завжди доменним ендпоінтом
 * модуля-власника (`POST /customers/export`), спільного `POST /user-operations` немає. Субʼєкт —
 * власник із токена: чужа операція, навіть для ADMIN, — 404 (рішення 2026-11-17).
 */
@ApiTags('user-operations')
@ApiBearerAuth()
@Controller('user-operations')
export class UserOperationsController {
  constructor(private readonly operations: UserOperationsReadService) {}

  @Get()
  @ApiOkResponse({ type: UserOperationListResponseDto.Output })
  async findAll(
    @Query() query: UserOperationListQueryDto,
    @CurrentUser('sub') userId: string,
  ): Promise<UserOperationListResponse> {
    const rows = await this.operations.list(userId, query);
    return { items: rows.map(toUserOperationResponse) };
  }

  @Get(':id')
  @ApiOkResponse({ type: UserOperationResponseDto.Output })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<UserOperationResponse> {
    return toUserOperationResponse(await this.operations.findOwn(id, userId));
  }

  /** 200 з поточним станом і для вже завершеної: для клієнта це «скасування опрацьовано» */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserOperationResponseDto.Output })
  async cancel(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<UserOperationResponse> {
    return toUserOperationResponse(await this.operations.cancel(id, userId));
  }

  @Get(':id/result-url')
  @ApiOkResponse({ type: UserOperationResultUrlResponseDto.Output })
  async resultUrl(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<UserOperationResultUrlResponse> {
    return this.operations.resultUrl(id, userId);
  }
}
