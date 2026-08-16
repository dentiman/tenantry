import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { Notification, Prisma } from '@saas-skeleton/database';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
} from '@saas-skeleton/contracts';
import type {
  NotificationChanged,
  NotificationPreference,
  NotificationQuery,
  NotificationSummary,
  UpdateNotification,
  UpdateNotificationPreferences,
} from '@saas-skeleton/contracts';
import { NotificationDispatcherRegistry, NotificationStateService } from '@saas-skeleton/shared';

/** Курсор — непрозорий base64url("{updatedAt ISO}|{id}"), як в activities */
function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { updatedAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const updatedAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(updatedAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { updatedAt, id };
}

type StateChange = NotificationChanged['change'];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly tenantContext: TenantContextService,
    private readonly state: NotificationStateService,
    private readonly dispatcher: NotificationDispatcherRegistry,
  ) {}

  /**
   * Keyset по (updatedAt, id) DESC. Саме updatedAt, а не createdAt: колапс мусить
   * піднімати групу нагору, інакше «3 нові події» лишались би там, де сталася перша.
   *
   * recipientId ЗАВЖДИ з токена — параметра «чужий інбокс» у контракті не існує.
   * RLS ізолює тенанти, але не юзерів усередині тенанта; це відповідальність сервісу,
   * і вона мусить бути в одному місці.
   */
  async findAll(
    userId: string,
    query: NotificationQuery,
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        ...this.filterWhere(query.filter),
        ...(cursor && {
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  private filterWhere(filter: NotificationQuery['filter']): Prisma.NotificationWhereInput {
    switch (filter) {
      case 'unread':
        return { readAt: null, archivedAt: null };
      case 'archived':
        return { archivedAt: { not: null } };
      // 'all' — усе, крім архіву: архів це «прибрано з очей», окрема вкладка
      default:
        return { archivedAt: null };
    }
  }

  summary(userId: string): Promise<NotificationSummary> {
    return this.state.summary(userId);
  }

  /**
   * Стан одного рядка. Неіснуючий або чужий id → 404 (не 403): існування чужого
   * рядка не підтверджуємо. Фільтр по recipientId у where робить це автоматично —
   * updateMany поверне count 0.
   */
  async update(userId: string, id: string, data: UpdateNotification): Promise<Notification> {
    const changes: StateChange[] = [];
    const updated = await this.tenantTx.withTenantTx(async (tx) => {
      const patch: Prisma.NotificationUpdateManyMutationInput = {};
      if (data.read !== undefined) {
        patch.readAt = data.read ? new Date() : null;
        changes.push(data.read ? 'read' : 'unread');
      }
      if (data.archived !== undefined) {
        patch.archivedAt = data.archived ? new Date() : null;
        changes.push('archived');
        // Архівувати непрочитане = прочитати його: інакше лічильник показував би
        // те, чого юзер уже не бачить у списку
        if (data.archived && data.read === undefined) {
          patch.readAt = new Date();
        }
      }

      const result = await tx.notification.updateMany({
        where: { id, recipientId: userId },
        data: patch,
      });
      if (result.count === 0) {
        throw new NotFoundException(`Notification with id "${id}" not found`);
      }

      await this.state.bumpRevision(tx, userId);
      this.emitChangedAfterCommit(tx, userId, changes.at(-1) ?? 'read', { kind: 'ids', ids: [id] });

      return tx.notification.findFirstOrThrow({ where: { id, recipientId: userId } });
    });

    this.logger.debug(`Notification ${id} updated for user ${userId}`);
    return updated;
  }

  /** Масово. Повертає свіжий summary — фронту не треба другого запиту за лічильником */
  async markAllRead(userId: string): Promise<NotificationSummary> {
    await this.tenantTx.withTenantTx(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { recipientId: userId, readAt: null, archivedAt: null },
        data: { readAt: new Date() },
      });
      // Ревізію рухаємо навіть на нулі змін: клієнт міг розійтися з сервером, і
      // «нічого не змінилось» — теж стан, який варто підтвердити однією подією
      await this.state.bumpRevision(tx, userId);
      this.emitChangedAfterCommit(tx, userId, 'read', { kind: 'all' });
      this.logger.log(`Marked ${String(result.count)} notification(s) read for user ${userId}`);
    });
    return this.state.summary(userId);
  }

  /** Панель відкрито: бейдж гасне, жирні рядки лишаються жирними */
  async markSeen(userId: string): Promise<NotificationSummary> {
    await this.tenantTx.withTenantTx(async (tx) => {
      await this.state.markSeen(tx, userId);
      this.emitChangedAfterCommit(tx, userId, 'seen', { kind: 'all' });
    });
    return this.state.summary(userId);
  }

  /**
   * Ефективні преференси: дефолти з NOTIFICATION_TYPE_META, перекриті рядками БД.
   * Віддаємо ЗАВЖДИ повний список типів — фронт не має знати реєстр, щоб намалювати екран.
   */
  async preferences(userId: string): Promise<NotificationPreference[]> {
    const overrides = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byKey = new Map(overrides.map((pref) => [`${pref.type}:${pref.channel}`, pref.enabled]));

    return NOTIFICATION_TYPES.flatMap((type) =>
      NOTIFICATION_CHANNELS.map((channel) => {
        const meta = NOTIFICATION_TYPE_META[type];
        return {
          type,
          channel,
          enabled: meta.muteable ? (byKey.get(`${type}:${channel}`) ?? meta.defaultEnabled) : true,
          category: meta.category,
          muteable: meta.muteable,
        };
      }),
    );
  }

  /**
   * Upsert набору. Немутабельний тип — 400, а не тихе ігнорування: клієнт, який
   * шле вимкнення security-сповіщення, має дізнатись, що воно не застосувалось.
   *
   * `tenantId` передається явно (PK композитний — без нього не скласти `where`);
   * той самий випадок і те саме обґрунтування, що в NotificationStateService.
   */
  async setPreferences(
    userId: string,
    data: UpdateNotificationPreferences,
  ): Promise<NotificationPreference[]> {
    const immutable = data.items.filter((item) => !NOTIFICATION_TYPE_META[item.type].muteable);
    if (immutable.length > 0) {
      throw new BadRequestException({
        message: 'Some notification types cannot be muted',
        fieldErrors: immutable.map((item) => ({
          field: 'items',
          message: `${item.type} cannot be muted`,
          code: 'not_muteable',
        })),
      });
    }

    const tenantId = this.tenantContext.requireTenantId();
    await this.tenantTx.withTenantTx(async (tx) => {
      for (const item of data.items) {
        await tx.notificationPreference.upsert({
          where: {
            tenantId_userId_type_channel: {
              tenantId,
              userId,
              type: item.type,
              channel: item.channel,
            },
          },
          create: { tenantId, userId, type: item.type, channel: item.channel, enabled: item.enabled },
          update: { enabled: item.enabled },
        });
      }
    });

    return this.preferences(userId);
  }

  /**
   * Емісія реєструється хуком after-commit — до коміту клієнт пішов би за списком
   * і побачив стан «до». Летить в особистий room, тобто в УСІ вкладки й на всі
   * пристрої юзера, включно з тим, де дію зробили.
   */
  private emitChangedAfterCommit(
    tx: Prisma.TransactionClient,
    userId: string,
    change: StateChange,
    scope: NotificationChanged['scope'],
  ): void {
    const tenantId = this.tenantContext.requireTenantId();
    this.tenantTx.onCommit(tx, async () => {
      const summary = await this.state.summary(userId);
      this.dispatcher.changed(tenantId, userId, {
        change,
        scope,
        unreadCount: summary.unreadCount,
        newCount: summary.newCount,
        revision: summary.revision,
        occurredAt: new Date().toISOString(),
      });
    });
  }
}
