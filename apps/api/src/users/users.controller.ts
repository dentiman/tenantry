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
import { UserQueryDto } from './dto/user-query.dto';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';
import { toUserResponse } from './users.mapper';
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
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: JwtPayload): Promise<UserResponse> {
    const user = await this.usersService.create(dto, actor);
    return this.toResponse(user);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.usersService.update(id, dto);
    return this.toResponse(user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }

  /** avatarUrl — presigned GET мініатюри (fallback на оригінал до генерації thumbnail-а) */
  private async toResponse(user: UserWithAvatar): Promise<UserResponse> {
    const avatar = user.avatarFile;
    const avatarUrl =
      avatar?.status === 'READY'
        ? await this.storage.getDownloadUrl(avatar.thumbnailKey ?? avatar.key)
        : null;
    return toUserResponse(user, avatarUrl);
  }
}
