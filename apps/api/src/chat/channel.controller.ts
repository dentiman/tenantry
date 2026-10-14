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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@saas-skeleton/database';
import type {
  AdminChannelResponse,
  ChannelContactResponse,
  ChannelLogEntry,
  SyncResult,
  WebhookEvent,
  WebhookStatus,
  InboxListResponse,
  MessagingAccountResponse,
} from '@saas-skeleton/contracts';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ChannelAdapterRegistry,
  RATE_LIMITS,
  RateLimit,
  StorageService,
} from '@saas-skeleton/shared';
import { OutreachService } from './outreach.service';
import { ChatService } from './chat.service';
import { ConversationResponseDto } from './dto/chat-response.dto';
import { toConversationResponse } from './chat.mapper';
import type { ConversationResponse } from '@saas-skeleton/contracts';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { ChannelInboxService } from './channel-inbox.service';
import { toChannelResponse } from './channel.mapper';
import { MessagingAccountService } from './messaging-account.service';
import {
  AdminChannelResponseDto,
  ChannelContactResponseDto,
  ChannelLogListResponseDto,
  ChannelLogQueryDto,
  SubscribeWebhookDto,
  WebhookEventListResponseDto,
  WebhookEventsQueryDto,
  WebhookStatusDto,
  ConnectMessagingAccountDto,
  MessagingAccountResponseDto,
  StartConversationDto,
  SyncResultDto,
  UpdateAccountCredentialsDto,
  UpdateChannelDto,
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
    private readonly outreach: OutreachService,
    private readonly chat: ChatService,
    private readonly storage: StorageService,
    private readonly registry: ChannelAdapterRegistry,
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

  /** Агент починає розмову з номера (CHAT-3a): відкрита розмова контакта або нова порожня */
  @Post('outreach')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ConversationResponseDto.Output })
  async startConversation(
    @Body() dto: StartConversationDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ConversationResponse> {
    const { conversationId } = await this.outreach.start(dto);
    return toConversationResponse(
      await this.chat.findOne(actor, conversationId),
      actor.sub,
      this.storage,
      this.registry,
    );
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
  constructor(
    private readonly accounts: MessagingAccountService,
    private readonly connection: WhatsAppConnectionService,
    private readonly subscription: WebhookSubscriptionService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: MessagingAccountListResponseDto.Output })
  async list(): Promise<{ items: MessagingAccountResponse[] }> {
    return { items: await this.accounts.list(true) };
  }

  /** Підключити WhatsApp Business: перевірка в Meta ДО збереження, потім синхронізація номерів */
  @Post('accounts')
  @Roles(Role.ADMIN)
  @RateLimit(RATE_LIMITS.messagingConnect)
  @ApiCreatedResponse({ type: MessagingAccountResponseDto.Output })
  connect(@Body() dto: ConnectMessagingAccountDto): Promise<MessagingAccountResponse> {
    return this.connection.connect(dto);
  }

  /** Новий токен: перевіряється так само, замінює старий лише після успіху */
  @Put('accounts/:id/credentials')
  @Roles(Role.ADMIN)
  @RateLimit(RATE_LIMITS.messagingConnect)
  @ApiOkResponse({ type: MessagingAccountResponseDto.Output })
  reauthenticate(
    @Param('id') id: string,
    @Body() dto: UpdateAccountCredentialsDto,
  ): Promise<MessagingAccountResponse> {
    return this.connection.reauthenticate(id, dto);
  }

  @Post('accounts/:id/sync')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @RateLimit(RATE_LIMITS.messagingConnect)
  @ApiOkResponse({ type: SyncResultDto.Output })
  sync(@Param('id') id: string): Promise<SyncResult> {
    return this.connection.sync(id);
  }

  @Post('accounts/:id/disconnect')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: MessagingAccountResponseDto.Output })
  disconnect(@Param('id') id: string): Promise<MessagingAccountResponse> {
    return this.connection.disconnect(id);
  }

  /** Увімкнути / вимкнути номер і зробити його default (один на акаунт) */
  @Patch('channels/:id')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: AdminChannelResponseDto.Output })
  updateChannel(
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<AdminChannelResponse> {
    return this.connection.updateChannel(id, dto);
  }

  /** Останні виклики до провайдера: що сталося, без секретів і без вмісту */
  @Get('accounts/:id/logs')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: ChannelLogListResponseDto.Output })
  logs(
    @Param('id') id: string,
    @Query() query: ChannelLogQueryDto,
  ): Promise<{ items: ChannelLogEntry[]; nextCursor: string | null }> {
    return this.connection.logsOf(id, { cursor: query.cursor, limit: query.limit });
  }

  /** Куди зараз ідуть вебхуки номера: живе читання з Meta, лише хости (CHAT-3b1) */
  @Get('channels/:id/webhook')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: WebhookStatusDto.Output })
  webhookStatus(@Param('id') id: string): Promise<WebhookStatus> {
    return this.subscription.status(id);
  }

  /** Явна підписка номера на адресу цього акаунта; чужі події — лише з названим хостом */
  @Post('channels/:id/webhook/subscribe')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @RateLimit(RATE_LIMITS.messagingConnect)
  @ApiOkResponse({ type: WebhookStatusDto.Output })
  subscribeWebhook(
    @Param('id') id: string,
    @Body() dto: SubscribeWebhookDto,
  ): Promise<WebhookStatus> {
    return this.subscription.subscribe(id, dto);
  }

  @Post('channels/:id/webhook/unsubscribe')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @RateLimit(RATE_LIMITS.messagingConnect)
  @ApiOkResponse({ type: WebhookStatusDto.Output })
  unsubscribeWebhook(@Param('id') id: string): Promise<WebhookStatus> {
    return this.subscription.unsubscribe(id);
  }

  /** Захоплені вебхуки акаунта як збережено: тіло, заголовки, результат підпису (CHAT-3b1) */
  @Get('accounts/:id/webhook-events')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: WebhookEventListResponseDto.Output })
  webhookEventList(
    @Param('id') id: string,
    @Query() query: WebhookEventsQueryDto,
  ): Promise<{ items: WebhookEvent[]; nextCursor: string | null }> {
    return this.webhookEvents.list(id, { cursor: query.cursor, limit: query.limit });
  }
}
