import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RATE_LIMITS, RateLimit, StorageService } from '@saas-skeleton/shared';
import type { AuthSessionResponse, AuthTokens, UserResponse } from '@saas-skeleton/contracts';
import { AuthTokensDto } from '../auth/dto/auth-response.dto';
import { toAuthTokensResponse } from '../auth/auth.mapper';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { Public } from '../auth/decorators/public.decorator';
import { ClientContext, type ClientContextData } from '../common/client-context.decorator';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponseWithAvatar, toUserResponse } from '../users/users.mapper';
import { AccountService } from './account.service';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto';
import { EmailChangeRequestDto } from './dto/email-change-request.dto';
import { EmailChangeConfirmDto } from './dto/email-change-confirm.dto';

/**
 * Роути «про себе». Жоден із них не приймає id — суб'єкт завжди з токена.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Окремо від GET /auth/me: цей віддає ЖИВИЙ presigned avatarUrl (сторінка налаштувань
   * тягне його на кожне відкриття), а /auth/me лишається дешевим бутстрапом сесії
   */
  @Get()
  @ApiOkResponse({ type: UserResponseDto.Output })
  async getProfile(@CurrentUser() actor: JwtPayload): Promise<UserResponse> {
    return toUserResponseWithAvatar(await this.account.findMe(actor.sub), this.storage);
  }

  @Patch('profile')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async updateProfile(
    @Body() dto: UpdateAccountProfileDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<UserResponse> {
    const user = await this.account.updateProfile(actor.sub, dto);
    return toUserResponseWithAvatar(user, this.storage);
  }

  /**
   * Повертає нову пару токенів: зміна пароля відкликає і поточну сесію теж.
   * 200, а не дефолтний 201: ресурс не створюється — як і на /auth/login
   */
  @Post('password')
  @RateLimit(RATE_LIMITS.accountSensitive)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  async changePassword(
    @Body() dto: ChangeOwnPasswordDto,
    @CurrentUser() actor: JwtPayload,
    @ClientContext() client: ClientContextData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.account.changePassword(actor.sub, dto, actor, client);
    setRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toAuthTokensResponse(tokens);
  }

  /**
   * «Мої пристрої» (AUTH-1). Id тут з'являється лише в DELETE і лише як id СЕСІЇ —
   * суб'єкт (юзер) усе ще береться з токена, тому чужі сесії недосяжні за побудовою.
   */
  @Get('sessions')
  @ApiOkResponse({ type: AuthSessionResponseDto.Output, isArray: true })
  listSessions(@CurrentUser() actor: JwtPayload): Promise<AuthSessionResponse[]> {
    return this.account.listSessions(actor.sub, actor.sid);
  }

  /** Завершити один пристрій; чужа/неіснуюча/мертва сесія — однаковий 404 */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  revokeSession(@Param('id') id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    return this.account.revokeSession(actor.sub, id, actor);
  }

  /** «Вийти на всіх пристроях»; тіла запиту немає — суб'єкт і так із токена */
  @Post('sessions/revoke-all')
  @RateLimit(RATE_LIMITS.accountSensitive)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  async revokeAllSessions(
    @CurrentUser() actor: JwtPayload,
    @ClientContext() client: ClientContextData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.account.revokeAllSessions(actor.sub, actor, client);
    setRefreshCookie(res, tokens.refreshToken, tokens.idleExpiresAt);
    return toAuthTokensResponse(tokens);
  }

  /**
   * AUTH-3: запит зміни email. Підтвердження йде на НОВУ адресу, тому тут лише
   * 204 — сам email міняється у confirm нижче.
   */
  @Post('email-change')
  @RateLimit(RATE_LIMITS.emailChange)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async requestEmailChange(
    @Body() dto: EmailChangeRequestDto,
    @CurrentUser() actor: JwtPayload,
    @ClientContext() client: ClientContextData,
  ): Promise<void> {
    await this.account.requestEmailChange(actor.sub, dto, client);
  }

  /**
   * Публічний: лист відкривають на іншому пристрої, контекст тенанта і юзера — з
   * префікса токена (contracts/http-api.md §«/account»: `email-change/confirm`).
   */
  @Public()
  @Post('email-change/confirm')
  @RateLimit(RATE_LIMITS.verificationConfirm)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserResponseDto.Output })
  async confirmEmailChange(@Body() dto: EmailChangeConfirmDto): Promise<UserResponse> {
    const user = await this.account.confirmEmailChange(dto);
    return toUserResponse(user);
  }
}
