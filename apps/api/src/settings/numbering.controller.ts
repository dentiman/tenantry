import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  NUMBER_SERIES_NAMES,
  type NumberSeriesListResponse,
  type NumberSeriesName,
  type NumberSeriesResponse,
} from '@saas-skeleton/contracts';
import { NumberingService } from '@saas-skeleton/shared';
import { Role } from '@saas-skeleton/database';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator';
import { ActivityRecorder } from '@saas-skeleton/shared';
import { TenantTransactions } from '@saas-skeleton/database';
import {
  NumberSeriesListResponseDto,
  NumberSeriesResponseDto,
  SetNextNumberDto,
  UpdateNumberSeriesDto,
} from './dto/numbering.dto';

/**
 * Нумерація — секція налаштувань ОРГАНІЗАЦІЇ (docs/settings.md), тому і шлях
 * `/settings/numbering`. При цьому це НЕ «секція-документ» на кшталт
 * general: тут колекція серій (`PATCH /:name`) плюс операція, яку станом поля
 * не виразиш (`POST /:name/next-number` — монотонний зсув). Саме тому PUT-
 * семантика секцій сюди не натягується, і це нормально: форма ресурсу диктує
 * дієслова, а не навпаки.
 *
 * Запис — тільки ADMIN: зсув нумерації незворотний і стосується всієї компанії.
 * Читання відкрите (наступний номер видно в UI створення).
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/numbering')
export class NumberingController {
  constructor(
    private readonly numbering: NumberingService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
  ) {}

  @Get()
  @ApiOkResponse({ type: NumberSeriesListResponseDto.Output })
  async list(): Promise<NumberSeriesListResponse> {
    return { items: await this.numbering.list() };
  }

  /** Формат і початковий номер. `startValue` діє на майбутні періоди, не на поточний */
  @Patch(':name')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: NumberSeriesResponseDto.Output })
  async update(
    @Param('name') name: string,
    @Body() dto: UpdateNumberSeriesDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<NumberSeriesResponse> {
    const series = this.assertKnown(name);
    await this.numbering.update(series, dto);
    await this.recordActivity('settings.updated', { section: 'numbering' }, actor);
    return this.numbering.describe(series);
  }

  /**
   * Зсув лічильника. Тільки вгору — і це не UI-обмеження, а вимога цілісності:
   * попередні номери вже видані, зниження гарантує колізію на унікальному індексі.
   * Спроба знизити — тихий no-op, у відповіді видно реальний наступний номер.
   */
  @Post(':name/next-number')
  @Roles(Role.ADMIN)
  // 200, а не дефолтний 201: ресурс не створюється — зсувається лічильник
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: NumberSeriesResponseDto.Output })
  async setNextNumber(
    @Param('name') name: string,
    @Body() dto: SetNextNumberDto,
    @CurrentUser() actor: JwtPayload,
  ): Promise<NumberSeriesResponse> {
    const series = this.assertKnown(name);
    await this.numbering.setNextNumber(series, dto.nextNumber);
    // Незворотна дія з наслідками для всієї компанії — у журнал іде саме
    // значення, а не «щось змінили»: аудиту потрібен номер
    const described = await this.numbering.describe(series);
    await this.recordActivity(
      'settings.numbering_shifted',
      { series, nextNumber: described.nextNumber },
      actor,
    );
    return described;
  }

  /**
   * Невідома серія — 404, а не 400: у шляху стоїть ідентифікатор ресурсу, і
   * «такого ресурсу немає» — саме те, що сталося
   */
  private assertKnown(name: string): NumberSeriesName {
    const known = NUMBER_SERIES_NAMES.find((candidate) => candidate === name);
    if (!known) {
      throw new NotFoundException(`Unknown number series "${name}"`);
    }
    return known;
  }

  /**
   * Журнал пишеться ОКРЕМОЮ транзакцією, а не разом зі зміною: NumberingService
   * живе в libs/shared і не знає про activities, а тягнути recorder усередину
   * інфраструктурного сервісу заради одного споживача — гірше, ніж мати тут
   * два комміти. Ціна відома: аварія рівно між ними лишить зміну без запису
   * (для налаштувань прийнятно; для грошей так робити не можна).
   */
  private async recordActivity(
    type: 'settings.updated' | 'settings.numbering_shifted',
    payload: Record<string, unknown>,
    actor: JwtPayload,
  ): Promise<void> {
    await this.tenantTx.withTenantTx(async (tx) => {
      await this.activities.record(tx, {
        type,
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload,
        links: [{ entityType: 'tenant', entityId: actor.tenantId, role: 'subject' }],
      });
    });
  }
}
