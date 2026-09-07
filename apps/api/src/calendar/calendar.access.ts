import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@saas-skeleton/database';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

/** Мінімум, якого достатньо для рішення про доступ — не весь рядок */
export interface AccessSubject {
  ownerId: string | null;
  createdById: string | null;
  customerId: string | null;
  visibility: 'DEFAULT' | 'PRIVATE';
  attendees: { userId: string }[];
}

/**
 * Хто що бачить і хто редагує (docs/calendar.md §9.8). ОДНЕ місце — інакше
  * перевірка «у `where` списку» розійдеться з перевіркою на `GET /:id`, і чуже
 * стане видно рівно через один рефакторинг.
 *
 * Право на подію визначає **участь**, а не роль, тому `@Roles(ADMIN)` тут не
 * годиться взагалі: календар — єдиний модуль скелетона, де рівень доступу не
 * виводиться з токена.
 */
@Injectable()
export class CalendarAccessService {
  /**
   * Фільтр видимості для списків. Мусить давати РІВНО ту саму відповідь, що
   * `canView` — тому вони й лежать поруч і читаються разом.
   */
  visibilityFilter(actor: JwtPayload): Prisma.CalendarEventWhereInput {
    const conditions: Prisma.CalendarEventWhereInput[] = [
      { ownerId: actor.sub },
      { createdById: actor.sub },
      { attendees: { some: { userId: actor.sub } } },
      /**
       * Подія, привʼязана до кастомера, — робота КОМПАНІЇ, а не особиста справа:
       * саме для цього її й привʼязували, і без цієї гілки блок «Історія
       * зустрічей» на картці клієнта показував би кожному лише його власні
       * дзвінки (уточнення до §9.8: там перелічені тільки учасники).
       * `PRIVATE` з цієї гілки випадає — приватне лишається приватним.
       */
      { customerId: { not: null }, visibility: 'DEFAULT' },
    ];
    if (actor.role === Role.ADMIN) {
      // Безхазяйну подію (організатора видалили разом із юзером) хтось мусить
      // бачити й розгрібати. Це ЄДИНЕ право адміна на чужу подію — на чужі
      // приватні події з живим організатором воно не поширюється
      conditions.push({ ownerId: null });
    }
    return { OR: conditions };
  }

  canView(event: AccessSubject, actor: JwtPayload): boolean {
    if (this.isParticipant(event, actor)) {
      return true;
    }
    if (event.customerId && event.visibility === 'DEFAULT') {
      return true;
    }
    return event.ownerId === null && actor.role === Role.ADMIN;
  }

  /** Редагує організатор; безхазяйну подію — ADMIN (рішення 2026-09-06) */
  canEdit(event: AccessSubject, actor: JwtPayload): boolean {
    if (event.ownerId === actor.sub) {
      return true;
    }
    return event.ownerId === null && actor.role === Role.ADMIN;
  }

  /**
   * 404, а не 403, коли подія недосяжна: 403 підтвердив би її існування, а
   * заголовок чужої зустрічі часом промовистіший за сам факт. Та сама логіка,
   * що з чужим tenant-ом (`tenant-isolation.e2e-spec`).
   */
  assertCanView(event: AccessSubject, actor: JwtPayload, id: string): void {
    if (!this.canView(event, actor)) {
      throw new NotFoundException(`Calendar event with id "${id}" not found`);
    }
  }

  /**
   * 403, а не 404: подію видно, і приховувати нічого — клієнт має дізнатись
   * саме те, що сталось («редагує організатор»), а не що зустріч зникла.
   */
  assertCanEdit(event: AccessSubject, actor: JwtPayload, id: string): void {
    this.assertCanView(event, actor, id);
    if (!this.canEdit(event, actor)) {
      throw new ForbiddenException('Only the organizer can modify this event');
    }
  }

  private isParticipant(event: AccessSubject, actor: JwtPayload): boolean {
    return (
      event.ownerId === actor.sub ||
      event.createdById === actor.sub ||
      event.attendees.some((attendee) => attendee.userId === actor.sub)
    );
  }
}
