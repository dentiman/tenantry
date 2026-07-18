import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PlatformAuthResponse, PlatformUserResponse } from '@saas-skeleton/contracts/platform';
import { PlatformAuthService } from './platform-auth.service';
import {
  PlatformAuthResponseDto,
  PlatformLoginDto,
  PlatformUserResponseDto,
} from './dto/platform-auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentOperator, type PlatformJwtPayload } from './decorators/current-operator.decorator';
import { toPlatformAuthResponse, toPlatformUserResponse } from './platform-auth.mapper';

@ApiTags('platform-auth')
@Controller('auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAuthResponseDto.Output })
  async login(@Body() dto: PlatformLoginDto): Promise<PlatformAuthResponse> {
    const { user, accessToken } = await this.authService.login(dto);
    return toPlatformAuthResponse(user, accessToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlatformUserResponseDto.Output })
  async me(@CurrentOperator() operator: PlatformJwtPayload): Promise<PlatformUserResponse> {
    return toPlatformUserResponse(await this.authService.getMe(operator.sub));
  }
}
