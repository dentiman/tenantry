import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StorageService } from '@saas-skeleton/shared';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { UsersService, type UserWithAvatar } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';
import { toUserResponseWithAvatar } from './users.mapper';
import type { UserResponse, UserListResponse } from '@saas-skeleton/contracts';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOkResponse({ type: UserListResponseDto.Output })
  async findAll(@Query() query: UserQueryDto): Promise<UserListResponse> {
    const { items, total, page, limit } = await this.usersService.findAll(query);
    return {
      items: await Promise.all(items.map((user) => this.toResponse(user))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    const user = await this.usersService.findOne(id);
    return this.toResponse(user);
  }

  @Post()
  @ApiCreatedResponse({ type: UserResponseDto.Output })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<UserResponse> {
    const user = await this.usersService.create(dto, actor);
    return this.toResponse(user);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.usersService.update(id, dto);
    return this.toResponse(user);
  }

  /**
   * Окремий ресурс, а не поле в PATCH: пароль не читається назад і не мапиться
   * у відповідь — 204 без тіла (і без юзера в ньому, щоб не спокушати клієнта
   * підтверджувати зміну пароля з відповіді)
   */
  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async setPassword(
    @Param('id') id: string,
    @Body() dto: SetUserPasswordDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<void> {
    await this.usersService.setPassword(id, dto.password, actor);
  }

  /** Повертає юзера — грід перемальовує рядок із відповіді, без зайвого GET */
  @Patch(':id/status')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<UserResponse> {
    const user = await this.usersService.setStatus(id, dto.isActive, actor);
    return this.toResponse(user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }

  private toResponse(user: UserWithAvatar): Promise<UserResponse> {
    return toUserResponseWithAvatar(user, this.storage);
  }
}
