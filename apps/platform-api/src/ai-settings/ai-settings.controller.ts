import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  PlatformAiApiKeyRevealResponse,
  PlatformAiSettingsEventListResponse,
  PlatformAiSettingsResponse,
} from '@saas-skeleton/contracts/platform';
import {
  CurrentOperator,
  type PlatformJwtPayload,
} from '../auth/decorators/current-operator.decorator';
import { AiSettingsService } from './ai-settings.service';
import {
  PlatformAiApiKeyRevealResponseDto,
  PlatformAiSettingsEventListResponseDto,
  PlatformAiSettingsResponseDto,
  UpdatePlatformAiSettingsDto,
} from './dto/ai-settings.dto';

/**
 * Налаштування AI-асистента платформи (AI-5a). Будь-який автентифікований оператор —
 * ролей у control plane поки немає (усі оператори — суперадміни).
 */
@ApiTags('ai-settings')
@ApiBearerAuth()
@Controller('ai/settings')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  @ApiOkResponse({ type: PlatformAiSettingsResponseDto.Output })
  get(): Promise<PlatformAiSettingsResponse> {
    return this.settings.get();
  }

  @Put()
  @ApiOkResponse({ type: PlatformAiSettingsResponseDto.Output })
  update(
    @Body() dto: UpdatePlatformAiSettingsDto,
    @CurrentOperator() operator: PlatformJwtPayload,
  ): Promise<PlatformAiSettingsResponse> {
    return this.settings.update(dto, operator);
  }

  /**
   * POST, а не GET: розкриття — дія з наслідком (подія в журналі), її не повинен
   * повторювати ні префетч, ні кеш браузера. 200, бо ресурс не створюється
   */
  @Post('api-key/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAiApiKeyRevealResponseDto.Output })
  reveal(@CurrentOperator() operator: PlatformJwtPayload): Promise<PlatformAiApiKeyRevealResponse> {
    return this.settings.revealApiKey(operator);
  }

  @Get('events')
  @ApiOkResponse({ type: PlatformAiSettingsEventListResponseDto.Output })
  events(): Promise<PlatformAiSettingsEventListResponse> {
    return this.settings.events();
  }
}
