import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { RATE_LIMITS, RateLimit } from '@saas-skeleton/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ChannelWebhookService } from './channel-webhook.service';

/**
 * Публічний вебхук каналів (CHAT-2a). Не частина OpenAPI-контракту: його викликає провайдер,
 * а не наш фронтенд, тож клієнт для нього не генерується.
 *
 * Тіло приходить Buffer-ом: `express.raw` змонтований на цей шлях у `configureApp()`, бо підпис
 * рахується над точними байтами.
 */
@ApiExcludeController()
@Controller('public/channels/:provider/:webhookKey')
export class ChannelWebhookController {
  constructor(private readonly webhook: ChannelWebhookService) {}

  @Public()
  @Get()
  @RateLimit(RATE_LIMITS.channelWebhook)
  // Провайдер очікує challenge як чистий текст
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async handshake(
    @Param('provider') provider: string,
    @Param('webhookKey') key: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<string> {
    const challenge = await this.webhook.handshake(provider, key, query);
    if (challenge === null) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  @Public()
  @Post()
  @RateLimit(RATE_LIMITS.channelWebhook)
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('provider') provider: string,
    @Param('webhookKey') key: string,
    @Req() req: Request,
  ): Promise<{ status: 'ok' }> {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
    }

    const outcome = await this.webhook.receive(provider, key, { headers, body }, req.ip);
    if (outcome.status === 'bad-signature') {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return { status: 'ok' };
  }
}
