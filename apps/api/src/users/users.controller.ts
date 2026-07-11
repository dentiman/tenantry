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
import { UsersService } from './users.service';
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
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOkResponse({ type: UserListResponseDto.Output })
  async findAll(@Query() query: UserQueryDto): Promise<UserListResponse> {
    const { items, total, page, limit } = await this.usersService.findAll(query);
    return {
      items: items.map(toUserResponse),
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
    return toUserResponse(user);
  }

  @Post()
  @ApiCreatedResponse({ type: UserResponseDto.Output })
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    const user = await this.usersService.create(dto);
    return toUserResponse(user);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto.Output })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.usersService.update(id, dto);
    return toUserResponse(user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
