import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@saas-skeleton/database';
import type {
  ChannelContactResponse,
  InboxListResponse,
  MessagingAccountResponse,
} from '@saas-skeleton/contracts';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChannelInboxService } from './channel-inbox.service';
import { toChannelResponse } from './channel.mapper';
import { MessagingAccountService } from './messaging-account.service';
import {
  ChannelContactResponseDto,
  ChannelListResponseDto,
  InboxListResponseDto,
  InboxQueryDto,
  LinkContactCustomerDto,
  MessagingAccountListResponseDto,
} from './dto/channel.dto';

/**
 * Скринька клієнтських розмов, канали й контакти (CHAT-2a). Доступ до самої розмови — не тут:
 * `ConversationAccessService` (гілка `tenant`). Тут лише вибірки й дії з контактом, а RLS тримає тенант.
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChannelController {
  constructor(
    private readonly inbox: ChannelInboxService,
    private readonly accounts: MessagingAccountService,
  ) {}

  @Get('inbox')
  @ApiOkResponse({ type: InboxListResponseDto.Output })
  async inboxList(
    @Query() query: InboxQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<InboxListResponse> {
    // Поля перелічені явно: `query` — інстанс DTO-класу, спред зняв би прототип
    return this.inbox.listInbox(actor, {
      cursor: query.cursor,
      limit: query.limit,
      filter: query.filter,
    });
  }

  @Get('channels')
  @ApiOkResponse({ type: ChannelListResponseDto.Output })
  async channels(): Promise<{ items: ReturnType<typeof toChannelResponse>[] }> {
    return { items: (await this.inbox.listChannels()).map(toChannelResponse) };
  }

  @Get('contacts/:id')
  @ApiOkResponse({ type: ChannelContactResponseDto.Output })
  contact(@Param('id') id: string): Promise<ChannelContactResponse> {
    return this.inbox.getContact(id);
  }

  @Post('contacts/:id/link-customer')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ChannelContactResponseDto.Output })
  linkCustomer(
    @Param('id') id: string,
    @Body() dto: LinkContactCustomerDto,
  ): Promise<ChannelContactResponse> {
    return this.inbox.linkCustomer(id, dto.customerId);
  }

  @Post('contacts/:id/create-customer')
  @ApiCreatedResponse({ type: ChannelContactResponseDto.Output })
  createCustomer(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ChannelContactResponse> {
    return this.inbox.createCustomerFromContact(actor, id);
  }

  @Delete('contacts/:id/customer')
  @ApiOkResponse({ type: ChannelContactResponseDto.Output })
  unlinkCustomer(@Param('id') id: string): Promise<ChannelContactResponse> {
    return this.inbox.unlinkCustomer(id);
  }
}

/**
 * Налаштування каналів тенанта (лише адмін): акаунт, куди провайдер має слати вебхук, чи щось
 * приходило. Облікові дані віддаються як «задано / ні» — у клартексті ніколи.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/messaging')
export class MessagingSettingsController {
  constructor(private readonly accounts: MessagingAccountService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: MessagingAccountListResponseDto.Output })
  async list(): Promise<{ items: MessagingAccountResponse[] }> {
    return { items: await this.accounts.list(true) };
  }
}
