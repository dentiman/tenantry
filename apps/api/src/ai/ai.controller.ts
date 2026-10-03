import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RATE_LIMITS, RateLimit } from '@saas-skeleton/shared';
import type {
  AiCitationContentResponse,
  AiConversationResponse,
  AskAiResponse,
} from '@saas-skeleton/contracts';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { toAiConversationResponse, toAiMessageResponse } from './ai.mapper';
import {
  AiCitationContentResponseDto,
  AiConversationResponseDto,
  AskAiRequestDto,
  AskAiResponseDto,
} from './dto/ai.dto';

/**
 * AI-асистент. Жоден роут не приймає id розмови — суб'єкт завжди з токена, як в
 * `/account` і `/settings`. Єдиний id у шляху — id ВІДПОВІДІ (у `cancel` і
 * `citations`), і він звіряється з власником.
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('conversation')
  @ApiOkResponse({ type: AiConversationResponseDto.Output })
  async conversation(@CurrentUser() actor: JwtPayload): Promise<AiConversationResponse> {
    this.ai.assertEnabled();
    const { conversation, messages } = await this.ai.currentConversation(actor);
    return toAiConversationResponse(conversation, messages);
  }

  /**
   * 202, а не 201: відповідь ще не існує, вона лише поставлена в чергу. Обидва
   * рядки повертаються одразу, щоб панель намалювала хід до того, як воркер
   * узяв job.
   */
  @Post('conversation/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(RATE_LIMITS.aiAsk)
  @ApiAcceptedResponse({ type: AskAiResponseDto.Output })
  async ask(
    @Body() dto: AskAiRequestDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<AskAiResponse> {
    this.ai.assertEnabled();
    const { conversation, question, reply } = await this.ai.ask(actor, dto.text);
    return {
      conversationId: conversation.id,
      question: toAiMessageResponse(question),
      reply: toAiMessageResponse(reply),
    };
  }

  /**
   * 200, а не дефолтний для POST 201: ресурсу за цим шляхом не створюється —
   * повертається ПОТОЧНИЙ стан розмови після скидання контексту. Той самий
   * вибір, що в `POST /auth/logout` (204 замість 201)
   */
  @Post('conversation/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AiConversationResponseDto.Output })
  async reset(@CurrentUser() actor: JwtPayload): Promise<AiConversationResponse> {
    this.ai.assertEnabled();
    const { conversation, messages } = await this.ai.reset(actor);
    return toAiConversationResponse(conversation, messages);
  }

  /**
   * Текст цитати `[n]` відповіді (AI-2a.3, design.md D8). Доступ перевіряється при
   * КОЖНОМУ відкритті: власник відповіді, фрагмент опублікований і видимий поточній
   * ролі. Усе інше — 404, без розрізнення причини
   */
  @Get('conversation/messages/:id/citations/:n')
  @ApiOkResponse({ type: AiCitationContentResponseDto.Output })
  @ApiNotFoundResponse()
  async citation(
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
    @CurrentUser() actor: JwtPayload,
  ): Promise<AiCitationContentResponse> {
    this.ai.assertEnabled();
    return this.ai.citation(actor, id, n);
  }

  @Post('conversation/messages/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancel(@Param('id') id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    this.ai.assertEnabled();
    await this.ai.cancel(actor, id);
  }

  /**
   * «Видалити мої розмови» (ai-1e): негайний, синхронний DELETE усіх розмов юзера — не
   * лише активної. Множина, на відміну від `conversation` вище: та адресує ЄДИНУ поточну
   * розмову, ця — всю колекцію, так само без id (суб'єкт з токена)
   */
  @Delete('conversations')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteAllConversations(@CurrentUser() actor: JwtPayload): Promise<void> {
    this.ai.assertEnabled();
    await this.ai.deleteAllConversations(actor);
  }
}
