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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  CustomerContactResponse,
  CustomerDetailResponse,
  CustomerListResponse,
} from '@saas-skeleton/contracts';
import { NumberingService } from '@saas-skeleton/shared';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SetCustomerStatusDto } from './dto/set-customer-status.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { CreateCustomerContactDto } from './dto/create-customer-contact.dto';
import { UpdateCustomerContactDto } from './dto/update-customer-contact.dto';
import {
  CustomerContactResponseDto,
  CustomerDetailResponseDto,
  CustomerListResponseDto,
} from './dto/customer-response.dto';
import {
  toCustomerContactResponse,
  toCustomerDetailResponse,
  toCustomerResponse,
} from './customers.mapper';
import type { CustomerWithContacts } from './customers.service';

/** Простір нумерації кастомерів у спільному двигуні (libs/shared) */
const CUSTOMER_SERIES = 'customer';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly numbering: NumberingService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CustomerListResponseDto.Output })
  async findAll(@Query() query: CustomerQueryDto): Promise<CustomerListResponse> {
    const { items, total, page, limit } = await this.customersService.findAll(query);
    // Конфіг серії читається ОДИН раз на запит, а не на рядок: це один
    // проіндексований рядок, кеш тут був би передчасною складністю
    const series = await this.numbering.resolve(CUSTOMER_SERIES);
    return {
      items: items.map((item) => toCustomerResponse(item, this.numbering, series)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerDetailResponseDto.Output })
  async findOne(@Param('id') id: string): Promise<CustomerDetailResponse> {
    return this.toDetail(await this.customersService.findOne(id));
  }

  @Post()
  @ApiCreatedResponse({ type: CustomerDetailResponseDto.Output })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CustomerDetailResponse> {
    return this.toDetail(await this.customersService.create(dto, actor));
  }

  @Patch(':id')
  @ApiOkResponse({ type: CustomerDetailResponseDto.Output })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CustomerDetailResponse> {
    return this.toDetail(await this.customersService.update(id, dto, actor));
  }

  /**
   * Окремий ресурс, а не поле в PATCH: зміна статусу — подія, яку читають у журналі
   * («хто заархівував клієнта»), а не редагування атрибута. Повертає кастомера —
   * грід перемальовує рядок із відповіді, без зайвого GET.
   */
  @Patch(':id/status')
  @ApiOkResponse({ type: CustomerDetailResponseDto.Output })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetCustomerStatusDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CustomerDetailResponse> {
    return this.toDetail(await this.customersService.setStatus(id, dto.status, actor));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    await this.customersService.remove(id, actor);
  }

  /**
   * Контакти — вкладений ресурс тільки на ЗМІНУ: читаються вони разом із карткою
   * (GET /customers/:id), інакше та сама інформація мала б два шляхи отримання
   * і два стани кешу на фронті.
   */
  @Post(':id/contacts')
  @ApiCreatedResponse({ type: CustomerContactResponseDto.Output })
  async addContact(
    @Param('id') id: string,
    @Body() dto: CreateCustomerContactDto,
  ): Promise<CustomerContactResponse> {
    return toCustomerContactResponse(await this.customersService.addContact(id, dto));
  }

  @Patch(':id/contacts/:contactId')
  @ApiOkResponse({ type: CustomerContactResponseDto.Output })
  async updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateCustomerContactDto,
  ): Promise<CustomerContactResponse> {
    return toCustomerContactResponse(await this.customersService.updateContact(id, contactId, dto));
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ): Promise<void> {
    await this.customersService.removeContact(id, contactId);
  }

  /** Картка з живим numberLabel: серія читається одним запитом на відповідь */
  private async toDetail(customer: CustomerWithContacts): Promise<CustomerDetailResponse> {
    const series = await this.numbering.resolve(CUSTOMER_SERIES);
    return toCustomerDetailResponse(customer, this.numbering, series);
  }
}
