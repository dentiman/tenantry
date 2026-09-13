import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { AuthResponseDto, AuthTokensDto, MeResponseDto } from './dto/auth-response.dto';
import { Public } from './decorators/public.decorator';
import { RATE_LIMITS, RateLimit } from '../common/throttler/rate-limit.decorator';
import { CurrentUser, type JwtPayload } from './decorators/current-user.decorator';
import { toAuthResponse, toMeResponse } from './auth.mapper';
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
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.login(dto);
    return toAuthResponse(user, tokens);
  }

  @Public()
  @Post('refresh')
  @RateLimit(RATE_LIMITS.refresh)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Вихід: клієнт здає свій refresh-токен, рядок зникає з БД. Публічний і
   * ідемпотентний (завжди 204) — деталі в AuthService.logout.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MeResponseDto.Output })
  async me(@CurrentUser() user: JwtPayload): Promise<MeResponse> {
    const fullUser = await this.authService.getMe(user.sub);
    return toMeResponse(fullUser);
  }
}
