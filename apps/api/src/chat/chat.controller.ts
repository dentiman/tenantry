import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ChatMessageListResponse,
  ChatMessageResponse,
  ConversationListResponse,
  ConversationResponse,
} from '@saas-skeleton/contracts';
import { StorageService } from '@saas-skeleton/shared';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import type { ConversationWithParticipants } from './chat.service';
import { toChatMessageResponse, toConversationResponse } from './chat.mapper';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PostChatMessageDto } from './dto/post-chat-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { ChatMessageListQueryDto, ConversationListQueryDto } from './dto/chat-query.dto';
import {
  ChatMessageListResponseDto,
  ChatMessageResponseDto,
  ConversationListResponseDto,
  ConversationResponseDto,
} from './dto/chat-response.dto';

/**
 * Чат, фаза CHAT-0.1. Поверхня свідомо вужча за docs/chat.md §4.13: ні PATCH
 * статусу, ні керування учасниками, ні вебхука — вони приходять зі своїми фазами.
 *
 * Доступ до КОЖНОГО роута — через `ConversationAccessService` у сервісі; окремих
 * guard-ів тут немає саме тому, що перевірка має бути ОДНА (docs/chat.md §5 п. 6).
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('conversations')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ConversationListResponseDto.Output })
  async findAll(
    @Query() query: ConversationListQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ConversationListResponse> {
    const { items, nextCursor } = await this.chat.list(actor, query);
    return { items: await this.toResponses(items, actor.sub), nextCursor };
  }

  @Post()
  @ApiCreatedResponse({ type: ConversationResponseDto.Output })
  async create(
    @Body() dto: CreateConversationDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ConversationResponse> {
    return toConversationResponse(await this.chat.create(actor, dto), actor.sub, this.storage);
  }

  @Get(':id')
  @ApiOkResponse({ type: ConversationResponseDto.Output })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ConversationResponse> {
    return toConversationResponse(await this.chat.findOne(actor, id), actor.sub, this.storage);
  }

  /**
   * Стрічка від найсвіжішого вниз. Клієнт розвертає сторінку для рендеру —
   * так перша (найпотрібніша) сторінка приходить без читання всієї історії.
   */
  @Get(':id/messages')
  @ApiOkResponse({ type: ChatMessageListResponseDto.Output })
  async transcript(
    @Param('id') id: string,
    @Query() query: ChatMessageListQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ChatMessageListResponse> {
    const { items, nextCursor } = await this.chat.transcript(actor, id, query);
    return { items: items.map(toChatMessageResponse), nextCursor };
  }

  /** 201 і на повторі з тим самим `clientMessageId`: для клієнта це той самий send */
  @Post(':id/messages')
  @ApiCreatedResponse({ type: ChatMessageResponseDto.Output })
  async post(
    @Param('id') id: string,
    @Body() dto: PostChatMessageDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<ChatMessageResponse> {
    return toChatMessageResponse(await this.chat.post(actor, id, dto));
  }

  /**
   * Рух курсора прочитаного. 204: клієнт і так перечитує список, а тіло тут
   * означало б, що курсор можна «не застосувати» — а він або рухається вперед,
   * або лишається на місці.
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async markRead(
    @Param('id') id: string,
    @Body() dto: MarkConversationReadDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<void> {
    await this.chat.markRead(actor, id, dto.seq);
  }

  private async toResponses(
    conversations: ConversationWithParticipants[],
    viewerId: string,
  ): Promise<ConversationResponse[]> {
    return Promise.all(
      conversations.map((conversation) =>
        toConversationResponse(conversation, viewerId, this.storage),
      ),
    );
  }
}
