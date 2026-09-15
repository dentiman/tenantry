import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RATE_LIMITS, RateLimit } from '@saas-skeleton/shared';
import type { AuthResponse } from '@saas-skeleton/contracts';
import { Public } from '../decorators/public.decorator';
import { ClientContext, type ClientContextData } from '../../common/client-context.decorator';
import { setRefreshCookie } from '../refresh-cookie';
import { toAuthResponse } from '../auth.mapper';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';

/**
 * AUTH-3: скидання пароля без оракула (spec US4). Обидва роути публічні — request
 * не потребує identity, confirm доводить її самим токеном.
 */
@ApiTags('auth')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  @Public()
  @Post()
  @RateLimit(RATE_LIMITS.passwordReset, RATE_LIMITS.passwordResetIp)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async request(
    @Body() dto: PasswordResetRequestDto,
    @ClientContext() client: ClientContextData,
  ): Promise<void> {
    await this.passwordReset.requestReset(dto, client);
  }

  @Public()
  @Post('confirm')
  @RateLimit(RATE_LIMITS.verificationConfirm)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto.Output })
  async confirm(
    @Body() dto: PasswordResetConfirmDto,
    @ClientContext() client: ClientContextData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.passwordReset.confirmReset(dto, client);
    setRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toAuthResponse(user, tokens);
  }
}
