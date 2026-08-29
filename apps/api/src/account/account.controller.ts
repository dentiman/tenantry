import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { StorageService } from '@saas-skeleton/shared';
import type { AuthTokens, UserResponse } from '@saas-skeleton/contracts';
import { AuthTokensDto } from '../auth/dto/auth-response.dto';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponseWithAvatar } from '../users/users.mapper';
import { AccountService } from './account.service';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto';

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
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  changePassword(
    @Body() dto: ChangeOwnPasswordDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<AuthTokens> {
    return this.account.changePassword(actor.sub, dto, actor);
  }

  /** «Вийти на всіх пристроях»; тіла запиту немає — суб'єкт і так із токена */
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  revokeAllSessions(@CurrentUser() actor: JwtPayload): Promise<AuthTokens> {
    return this.account.revokeAllSessions(actor.sub, actor);
  }
}
