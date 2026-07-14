import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  CreateFileUploadResponse,
  FileDownloadUrlResponse,
  FileResponse,
} from '@saas-skeleton/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FilesService } from './files.service';
import { toFileResponse } from './files.mapper';
import {
  CreateFileUploadDto,
  CreateFileUploadResponseDto,
  FileDownloadUrlQueryDto,
  FileDownloadUrlResponseDto,
  FileResponseDto,
} from './dto/file.dto';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @ApiCreatedResponse({ type: CreateFileUploadResponseDto.Output })
  async create(
    @Body() dto: CreateFileUploadDto,
    @CurrentUser('sub') userId: string,
  ): Promise<CreateFileUploadResponse> {
    const { file, uploadUrl } = await this.filesService.createUpload(dto, userId);
    return { file: toFileResponse(file), uploadUrl };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FileResponseDto.Output })
  async complete(@Param('id') id: string): Promise<FileResponse> {
    const file = await this.filesService.complete(id);
    return toFileResponse(file);
  }

  @Get(':id')
  @ApiOkResponse({ type: FileResponseDto.Output })
  async findOne(@Param('id') id: string): Promise<FileResponse> {
    const file = await this.filesService.findOne(id);
    return toFileResponse(file);
  }

  @Get(':id/download-url')
  @ApiOkResponse({ type: FileDownloadUrlResponseDto.Output })
  async downloadUrl(
    @Param('id') id: string,
    @Query() query: FileDownloadUrlQueryDto,
  ): Promise<FileDownloadUrlResponse> {
    return this.filesService.getDownloadUrl(id, query.variant ?? 'original');
  }
}
