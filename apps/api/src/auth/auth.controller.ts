import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { AuthResponseDto, AuthTokensDto, MeResponseDto } from './dto/auth-response.dto';
import { Public } from './decorators/public.decorator';
import { RATE_LIMITS, RateLimit } from '@saas-skeleton/shared';
import { ClientContext, type ClientContextData } from '../common/client-context.decorator';
import { CurrentUser, type JwtPayload } from './decorators/current-user.decorator';
import { toAuthResponse, toAuthTokensResponse, toMeResponse } from './auth.mapper';
import { OriginGuard } from './guards/origin.guard';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import type { AuthResponse, AuthTokens, MeResponse } from '@saas-skeleton/contracts';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // MT-1: POST /auth/register видалено зовсім (рішення 2026-07-16) —
  // юзерів створює tenant-адмін, тенантів — platform-api (MT-3)

  @Public()
  @Post('login')
  // AUTH-0: ліміт спрацьовує в guard-і, тобто ДО argon2 — перебір не палить CPU
  @RateLimit(RATE_LIMITS.login, RATE_LIMITS.loginIp)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto.Output })
  async login(
    @Body() dto: LoginDto,
    @ClientContext() client: ClientContextData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.login(dto, client);
    setRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toAuthResponse(user, tokens);
  }

  @Public()
  @UseGuards(OriginGuard)
  @Post('refresh')
  @RateLimit(RATE_LIMITS.refresh)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @ClientContext() client: ClientContextData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    // AUTH-2: cookie спочатку, тіло — перехідний шлях (platform-web, старі вкладки),
    // прибрати після AUTH-4 (§7 плану auth-hardening-plan.md)
    const token = readRefreshCookie(req) ?? dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const tokens = await this.authService.refresh(token, client);
    setRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toAuthTokensResponse(tokens);
  }

  /**
   * Вихід: клієнт здає свій refresh-токен, рядок зникає з БД. Публічний і
   * ідемпотентний (завжди 204) — деталі в AuthService.logout. AUTH-2: cookie
   * чиститься ЗАВЖДИ, незалежно від того, чи вдалося розпізнати токен.
   */
  @Public()
  @UseGuards(OriginGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readRefreshCookie(req) ?? dto.refreshToken;
    if (token) {
      await this.authService.logout(token);
    }
    clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MeResponseDto.Output })
  async me(@CurrentUser() user: JwtPayload): Promise<MeResponse> {
    const fullUser = await this.authService.getMe(user.sub);
    return toMeResponse(fullUser);
  }
}
