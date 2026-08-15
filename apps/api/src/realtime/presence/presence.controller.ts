import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '@saas-skeleton/database';
import type { PresenceSnapshot } from '@saas-skeleton/contracts';
import { PresenceService } from './presence.service';
import { PresenceSnapshotDto } from './dto/presence-response.dto';

/**
 * Snapshot присутності. Socket надсилає лише delta — повний стан завжди береться
 * звідси: на старті, після reconnect і на кожному revision-gap. Це і робить
 * втрату socket-події нешкідливою.
 */
@ApiTags('presence')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    // Явний tenantId тут — НЕ порушення §6 плану мультитенантності, а його межа:
    // у Postgres ізоляцію робить RLS, а у Valkey enforcement-у немає взагалі —
    // там ізоляція забезпечується структурою ключів, тобто дисципліною коду.
    // Presence — інфраструктура (як auth і storage), і це легальне місце для tenantId.
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @ApiOkResponse({ type: PresenceSnapshotDto.Output })
  get(): Promise<PresenceSnapshot> {
    return this.presence.snapshot(this.tenantContext.requireTenantId());
  }
}
