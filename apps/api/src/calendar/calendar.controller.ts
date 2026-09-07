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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  CalendarAgendaResponse,
  CalendarEventListResponse,
  CalendarEventResponse,
} from '@saas-skeleton/contracts';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { CalendarAccessService } from './calendar.access';
import { CalendarService } from './calendar.service';
import {
  CalendarAgendaQueryDto,
  CalendarAgendaResponseDto,
  CalendarEventListResponseDto,
  CalendarEventQueryDto,
  CalendarEventResponseDto,
  CreateCalendarEventDto,
  SetCalendarAttendeesDto,
  SetCalendarEventStatusDto,
  SetCalendarRemindersDto,
  SetCalendarRsvpDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';
import {
  toCalendarAgendaResponse,
  toCalendarEventListResponse,
  toCalendarEventResponse,
} from './calendar.mapper';

/**
 * Календар (docs/calendar.md §10).
 *
 * Дві риси, які відрізняють цей контролер від решти доменних:
 * 1. **Читання вікном** (`from`/`to`), а не сторінками — «сторінка 7 календаря»
 *    не означає нічого. Пагінація лишилась тільки в agenda, де фід справді
 *    нескінченний.
 * 2. **Доступ визначає участь, а не роль**, тому `@Roles(...)` тут немає:
 *    правила живуть у `CalendarAccessService` і застосовуються в сервісі.
 */
@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly access: CalendarAccessService,
  ) {}

  @Get('events')
  @ApiOkResponse({ type: CalendarEventListResponseDto.Output })
  async findWindow(
    @Query() query: CalendarEventQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventListResponse> {
    const { items, from, to } = await this.calendar.findWindow(query, actor);
    return toCalendarEventListResponse(items, { from, to }, actor, this.access);
  }

  /** «Що далі» — курсорний фід; той самий контракт, що в activities */
  @Get('agenda')
  @ApiOkResponse({ type: CalendarAgendaResponseDto.Output })
  async agenda(
    @Query() query: CalendarAgendaQueryDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarAgendaResponse> {
    const { items, nextCursor } = await this.calendar.findAgenda(query, actor);
    return toCalendarAgendaResponse(items, nextCursor, actor, this.access);
  }

  @Get('events/:id')
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.findOne(id, actor), actor);
  }

  @Post('events')
  @ApiCreatedResponse({ type: CalendarEventResponseDto.Output })
  async create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.create(dto, actor), actor);
  }

  @Patch('events/:id')
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.update(id, dto, actor), actor);
  }

  /**
   * Скасування — окремий ресурс, а не поле в PATCH: це подія, про яку треба
   * сповістити учасників і яка лишає слід у журналі. Той самий патерн, що
   * `PATCH /customers/:id/status`.
   */
  @Patch('events/:id/status')
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetCalendarEventStatusDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.setStatus(id, dto.status, actor), actor);
  }

  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    await this.calendar.remove(id, actor);
  }

  /** Повний склад учасників = документ; дифування робить сервер */
  @Put('events/:id/attendees')
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async setAttendees(
    @Param('id') id: string,
    @Body() dto: SetCalendarAttendeesDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.setAttendees(id, dto.attendees, actor), actor);
  }

  /**
   * Моя відповідь. Мого id у шляху немає — суб'єкт із токена.
   *
   * `@HttpCode(200)`, бо ресурс не створюється: POST тут — «операція, яку не
   * виразити станом поля» (та сама форма, що `POST /settings/numbering/:name/next-number`),
   * і дефолтна 201 від Nest вводила б клієнта в оману.
   */
  @Post('events/:id/rsvp')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async setRsvp(
    @Param('id') id: string,
    @Body() dto: SetCalendarRsvpDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.setRsvp(id, dto, actor), actor);
  }

  /**
   * МОЇ нагадування на подію — повний набір, ідемпотентно. Окремого GET немає:
   * вони їдуть у самій події (як контакти в картці кастомера), інакше та сама
   * інформація мала б два шляхи отримання і два стани кешу.
   */
  @Put('events/:id/reminders')
  @ApiOkResponse({ type: CalendarEventResponseDto.Output })
  async setReminders(
    @Param('id') id: string,
    @Body() dto: SetCalendarRemindersDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<CalendarEventResponse> {
    return this.toResponse(await this.calendar.setReminders(id, dto.reminders, actor), actor);
  }

  private toResponse(
    event: Awaited<ReturnType<CalendarService['findOne']>>,
    actor: JwtPayload,
  ): CalendarEventResponse {
    return toCalendarEventResponse(event, actor, this.access);
  }
}
