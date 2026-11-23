import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import { ActivityAccessRegistry } from '../activities/activity-access.registry';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { CalendarAccessService } from './calendar.access';

/**
 * Внесок календаря в доступ до стрічки активності (docs/modules.md §4.2). Активність події
 * лежить у стрічці клієнта (`customer`-лінк) і в стрічці самої події, але приватна подія не
 * має бути видна нікому, крім учасників. `activities` календаря не знає, тому календар
 * реєструє охоронця `calendar_event`, і рішення — та сама `visibilityFilter`, що фільтрує
 * списки подій: ще одного правила «хто що бачить» не з'являється.
 */
@Injectable()
export class CalendarActivityGuard implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CalendarAccessService,
    private readonly registry: ActivityAccessRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.guard('calendar_event', {
      visibleIds: (viewer, ids) => this.visibleIds(viewer, ids),
    });
  }

  private async visibleIds(
    viewer: JwtPayload,
    candidateIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    // Видалена подія (DELETE — жорстке) тут не знайдеться, а отже її записи не покажуться:
    // видимість приватної події після видалення не відновити, а помилка в бік «показати»
    // віддала б заголовок чужої зустрічі
    const events = await this.prisma.calendarEvent.findMany({
      where: { id: { in: [...candidateIds] }, AND: [this.access.visibilityFilter(viewer)] },
      select: { id: true },
    });
    return new Set(events.map((event) => event.id));
  }
}
