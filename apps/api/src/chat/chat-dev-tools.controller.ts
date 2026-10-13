import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { Role } from '@saas-skeleton/database';
import type { FakeChannelSetupResponse, SimulateInboundResponse } from '@saas-skeleton/contracts';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatDevToolsGuard } from './chat-dev-tools.guard';
import { ChatDevToolsService } from './chat-dev-tools.service';
import { SimulateInboundDto } from './dto/channel.dto';

/**
 * Лише розробка (`CHAT_DEV_TOOLS`): не потрапляє в OpenAPI і не має клієнта — його викликають
 * симулятор `pnpm chat:simulate` і dev-панель скриньки.
 */
@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(ChatDevToolsGuard)
@Controller('dev/chat')
export class ChatDevToolsController {
  constructor(private readonly tools: ChatDevToolsService) {}

  @Post('fake-channel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  setupFakeChannel(): Promise<FakeChannelSetupResponse> {
    return this.tools.ensureFakeChannel();
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  simulate(@Body() dto: SimulateInboundDto, @Req() req: Request): Promise<SimulateInboundResponse> {
    // Базу береться з запиту (або явної змінної): у dev це адреса самого API; ручка лише для
    // адміна під прапорцем розробки, тож «хост із запиту» не є вектором
    const base =
      process.env.CHAT_SIMULATOR_BASE_URL?.trim().replace(/\/+$/, '') ??
      `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    return this.tools.simulate(dto, base);
  }
}
