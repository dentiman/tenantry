import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  TenantUserListResponse,
  TenantUserResponse,
  TenantUserSessionsRevokedResponse,
} from '@saas-skeleton/contracts/platform';
import {
  CurrentOperator,
  type PlatformJwtPayload,
} from '../auth/decorators/current-operator.decorator';
import { TenantUsersService } from './tenant-users.service';
import {
  SetTenantUserPasswordDto,
  SetTenantUserStatusDto,
  TenantUserListResponseDto,
  TenantUserQueryDto,
  TenantUserResponseDto,
  TenantUserSessionsRevokedResponseDto,
} from './dto/tenant-user.dto';

@ApiTags('tenant-users')
@ApiBearerAuth()
@Controller('tenants/:tenantId/users')
export class TenantUsersController {
  constructor(private readonly users: TenantUsersService) {}

  @Get()
  @ApiOkResponse({ type: TenantUserListResponseDto.Output })
  findAll(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: TenantUserQueryDto,
  ): Promise<TenantUserListResponse> {
    return this.users.findAll(tenantId, query);
  }

  @Post(':userId/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  setPassword(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetTenantUserPasswordDto,
    @CurrentOperator() operator: PlatformJwtPayload,
  ): Promise<void> {
    return this.users.setPassword(tenantId, userId, dto.password, operator);
  }

  @Patch(':userId/status')
  @ApiOkResponse({ type: TenantUserResponseDto.Output })
  setStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetTenantUserStatusDto,
    @CurrentOperator() operator: PlatformJwtPayload,
  ): Promise<TenantUserResponse> {
    return this.users.setStatus(tenantId, userId, dto.isActive, operator);
  }

  /** POST: дія з наслідком, не повторюється префетчем */
  @Post(':userId/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TenantUserSessionsRevokedResponseDto.Output })
  revokeSessions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentOperator() operator: PlatformJwtPayload,
  ): Promise<TenantUserSessionsRevokedResponse> {
    return this.users.revokeAllSessions(tenantId, userId, operator);
  }
}
