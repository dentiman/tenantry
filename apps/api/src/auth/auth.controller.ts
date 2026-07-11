import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto, AuthTokensDto, MeResponseDto } from './dto/auth-response.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, type JwtPayload } from './decorators/current-user.decorator';
import { toAuthResponse, toMeResponse } from './auth.mapper';
import type { AuthResponse, AuthTokens, MeResponse } from '@saas-skeleton/contracts';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiCreatedResponse({ type: AuthResponseDto.Output })
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.register(dto);
    return toAuthResponse(user, tokens);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto.Output })
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.login(dto);
    return toAuthResponse(user, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto.Output })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MeResponseDto.Output })
  async me(@CurrentUser() user: JwtPayload): Promise<MeResponse> {
    const fullUser = await this.authService.getMe(user.sub);
    return toMeResponse(fullUser);
  }
}
