import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TenantListResponse, TenantResponse } from '@saas-skeleton/contracts/platform';
import { TenantsService } from './tenants.service';
import {
  CreateTenantDto,
  TenantListResponseDto,
  TenantResponseDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import { toTenantResponse } from './tenants.mapper';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOkResponse({ type: TenantListResponseDto.Output })
  async findAll(): Promise<TenantListResponse> {
    const { items, total } = await this.tenantsService.findAll();
    return { items: items.map(toTenantResponse), total };
  }

  @Get(':id')
  @ApiOkResponse({ type: TenantResponseDto.Output })
  async findOne(@Param('id') id: string): Promise<TenantResponse> {
    return toTenantResponse(await this.tenantsService.findOne(id));
  }

  @Post()
  @ApiCreatedResponse({ type: TenantResponseDto.Output })
  async create(@Body() dto: CreateTenantDto): Promise<TenantResponse> {
    return toTenantResponse(await this.tenantsService.create(dto));
  }

  @Patch(':id')
  @ApiOkResponse({ type: TenantResponseDto.Output })
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto): Promise<TenantResponse> {
    return toTenantResponse(await this.tenantsService.update(id, dto));
  }
}
