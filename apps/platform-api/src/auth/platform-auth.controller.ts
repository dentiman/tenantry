import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {
  PlatformAuthResponse,
  PlatformAuthTokens,
  PlatformUserResponse,
} from '@saas-skeleton/contracts/platform';
// Subpath-імпорт: головний index libs/shared тягне pg-boss/@aws-sdk (webpack externals),
// які platform-api не потрібні
import { RATE_LIMITS, RateLimit } from '@saas-skeleton/shared/auth/throttler';
import { PlatformAuthService } from './platform-auth.service';
import {
  PlatformAuthResponseDto,
  PlatformAuthTokensDto,
  PlatformLoginDto,
  PlatformUserResponseDto,
} from './dto/platform-auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentOperator, type PlatformJwtPayload } from './decorators/current-operator.decorator';
import { toPlatformAuthResponse, toPlatformAuthTokensResponse, toPlatformUserResponse } from './platform-auth.mapper';
import { OriginGuard } from './guards/origin.guard';
import {
  clearPlatformRefreshCookie,
  readPlatformRefreshCookie,
  setPlatformRefreshCookie,
} from './platform-refresh-cookie';

function clientContext(req: Request): { ip: string | null; userAgent: string | null } {
  const userAgent = (req.headers['user-agent'] ?? '').slice(0, 512);
  return { ip: req.ip ?? null, userAgent: userAgent === '' ? null : userAgent };
}

@ApiTags('platform-auth')
@Controller('auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Public()
  @Post('login')
  // AUTH-2: дзеркало tenant-плану — той самий поріг, той самий storage
  @RateLimit(RATE_LIMITS.login, RATE_LIMITS.loginIp)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAuthResponseDto.Output })
  async login(
    @Body() dto: PlatformLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformAuthResponse> {
    const { user, tokens } = await this.authService.login(dto, clientContext(req));
    setPlatformRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toPlatformAuthResponse(user, tokens);
  }

  @Public()
  @UseGuards(OriginGuard)
  @Post('refresh')
  @RateLimit(RATE_LIMITS.refresh)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAuthTokensDto.Output })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformAuthTokens> {
    const token = readPlatformRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const tokens = await this.authService.refresh(token);
    setPlatformRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toPlatformAuthTokensResponse(tokens);
  }

  /** Публічний, ідемпотентний (завжди 204) — той самий контракт, що tenant-логаут */
  @Public()
  @UseGuards(OriginGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readPlatformRefreshCookie(req);
    if (token) {
      await this.authService.logout(token);
    }
    clearPlatformRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlatformUserResponseDto.Output })
  async me(@CurrentOperator() operator: PlatformJwtPayload): Promise<PlatformUserResponse> {
    return toPlatformUserResponse(await this.authService.getMe(operator.sub));
  }
}
