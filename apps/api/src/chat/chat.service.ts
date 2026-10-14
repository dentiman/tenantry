import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { ChatMessage, Prisma } from '@saas-skeleton/database';
import {
  conversationRoom,
  type CreateConversation,
  type CursorQuery,
  type PostChatMessage,
  type PostTemplateMessage,
  type SetConversationAssignee,
  type SetConversationStatus,
} from '@saas-skeleton/contracts';
import {
  channelsMarkReadCommand,
  chatMessagePostedEvent,
  MessagePublisher,
  NotificationRecorder,
  toPreview,
} from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { ChatRealtime } from './chat-realtime';
import { ConversationAccessService } from './conversation-access.service';
import { isClientMessageIdConflict } from './idempotency';
import { CustomerChatService } from './customer-chat.service';

/** Що віддається як розмова — і в списку, і в картці (форма спільна) */
const CONVERSATION_SELECT = {
  id: true,
  kind: true,
  access: true,
  status: true,
  isDefault: true,
  title: true,
  // CHAT-2a: клієнтська розмова — з ким і з якого номера
  contact: { select: { id: true, displayName: true } },
  assignee: { select: { id: true, name: true, email: true } },
  channel: {
    select: {
      displayPhoneNumber: true,
      provider: true,
      webhookSubscribedAt: true,
    },
  },
  customerLastMessageAt: true,
  lastSeq: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  createdAt: true,
  participants: {
    where: { leftAt: null },
    orderBy: { joinedAt: 'asc' },
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      lastReadSeq: true,
      unreadCount: true,
      user: { select: { id: true, email: true, name: true, avatarFile: true } },
    },
  },
} satisfies Prisma.ConversationSelect;

export type ConversationWithParticipants = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

/**
 * Курсор списку розмов — непрозорий base64url("{lastMessageAt ISO}|{id}"),
 * курсор стрічки — base64url("{seq}"). Формат у обох випадках деталь бекенда:
 * клієнт його не розбирає (та сама угода, що в activities).
 */
function encodeListCursor(lastMessageAt: Date | null, id: string): string {
  return Buffer.from(`${lastMessageAt?.toISOString() ?? ''}|${id}`).toString('base64url');
}

function decodeListCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(at.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id };
}

function encodeSeqCursor(seq: number): string {
  return Buffer.from(String(seq)).toString('base64url');
}

function decodeSeqCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return null;
  }
  const seq = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(seq) || seq < 0) {
    throw new BadRequestException('Invalid cursor');
  }
  return seq;
}

/**
 * Чат (docs/chat.md §7): INTERNAL-розмови, текст, REST + живі зміни через сокет (CHAT-0.2a).
 *
 * Сокет — лише прискорення: кожна зміна, що змінює стрічку чи курсор, реєструє емісію
 * після коміту тієї ж транзакції (`ChatRealtime`), а джерелом правди лишається Postgres.
 * Сповіщення (CHAT-0.2c): `insert()` публікує `chat.message-posted.v1` у тій самій транзакції, а
 * воркер (`chat-notify`) пише їх тим, хто не дивиться на розмову; читання розмови їх гасить.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly access: ConversationAccessService,
    private readonly chatRealtime: ChatRealtime,
    private readonly messages: MessagePublisher,
    private readonly realtime: RealtimeEmitter,
    private readonly tenantContext: TenantContextService,
    private readonly notificationRecorder: NotificationRecorder,
    private readonly customer: CustomerChatService,
  ) {}

  /**
   * «Мої розмови», свіжі згори. Keyset по (lastMessageAt, id) — не offset:
   * у фіді, куди постійно щось прилітає, offset їде між сторінками.
   */
  async list(
    actor: JwtPayload,
    query: CursorQuery,
  ): Promise<{ items: ConversationWithParticipants[]; nextCursor: string | null }> {
    const cursor = decodeListCursor(query.cursor);

    const rows = await this.prisma.conversation.findMany({
      where: {
        // Клієнтські розмови (відповідальний теж учасник) — у скриньці, а не в списку внутрішніх
        kind: 'INTERNAL',
        participants: { some: { userId: actor.sub, leftAt: null } },
        ...(cursor && {
          OR: [
            { lastMessageAt: { lt: cursor.at } },
            { lastMessageAt: cursor.at, id: { lt: cursor.id } },
          ],
        }),
      },
      // nulls: 'last' — страховка: розмова без жодного запису в стрічці не
      // створюється (§ create), але сортування не має від цього залежати
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: query.limit + 1,
      select: CONVERSATION_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeListCursor(last.lastMessageAt, last.id) : null,
    };
  }

  /** Картка розмови. Доступ — через єдину функцію, як і всюди в модулі */
  async findOne(actor: JwtPayload, conversationId: string): Promise<ConversationWithParticipants> {
    await this.access.assertAccess(conversationId, actor.sub);
    // Перечитуємо повною формою: assertAccess віддає лише членство того,
    // хто питає, а картці потрібні всі учасники
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: CONVERSATION_SELECT,
    });
  }

  /**
   * Нова розмова. Учасники, членство і системні записи — в одній транзакції:
   * розмова без стрічки і без учасників не є проміжним станом, який хтось
   * може побачити.
   */
  async create(actor: JwtPayload, dto: CreateConversation): Promise<ConversationWithParticipants> {
    // Автор завжди учасник: дозволити створити розмову, у яку сам не потрапив,
    // означало б створити недосяжний для автора обʼєкт
    const memberIds = [...new Set([actor.sub, ...dto.participantUserIds])];

    // Чужий тенант сюди не долетить (RLS), але «немає такого юзера» треба
    // повернути як помилку поля, а не як 500 на FK
    const members = await this.prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, email: true },
    });
    if (members.length !== memberIds.length) {
      throw fieldValidationException('participantUserIds', 'Unknown participant');
    }

    const id = await this.transactions.withTenantTx(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          kind: 'INTERNAL',
          access: 'private',
          title: dto.title ?? null,
        },
        select: { id: true },
      });

      await tx.conversationParticipant.createMany({
        data: members.map((member) => ({
          conversationId: conversation.id,
          userId: member.id,
          role: 'member',
        })),
      });

      // Системні записи пишуться локальною нумерацією, а не інкрементом рядка:
      // розмову щойно створено в цій же транзакції, ніхто інший її не бачить —
      // конкурувати за seq нема з ким
      const entries: Prisma.ChatMessageCreateManyInput[] = [
        {
          conversationId: conversation.id,
          seq: 1,
          kind: 'SYSTEM',
          senderType: 'user',
          senderUserId: actor.sub,
          senderLabel: labelOf(
            members.find((m) => m.id === actor.sub) ?? { name: null, email: actor.email },
          ),
          payload: { type: 'conversation.created' },
        },
        ...members.map((member, index) => ({
          conversationId: conversation.id,
          seq: index + 2,
          kind: 'SYSTEM' as const,
          senderType: 'user',
          senderUserId: actor.sub,
          senderLabel: labelOf(
            members.find((m) => m.id === actor.sub) ?? { name: null, email: actor.email },
          ),
          payload: {
            type: 'member.added',
            member: { id: member.id, label: labelOf(member) },
          } satisfies Prisma.InputJsonValue,
        })),
      ];
      await tx.chatMessage.createMany({ data: entries });

      const lastSeq = entries.length;
      await tx.conversation.update({
        where: { id: conversation.id },
        // lastMessagePreview НЕ чіпаємо: системний запис тексту не має, і прев'ю
        // лишається null до першої репліки (design.md D5)
        data: { lastSeq, lastMessageAt: new Date() },
      });
      // Приєднання не створює непрочитаних: курсор кожного стартує на кінці
      await tx.conversationParticipant.updateMany({
        where: { conversationId: conversation.id },
        data: { joinSeq: lastSeq, lastReadSeq: lastSeq },
      });

      // Склад відомий — це `memberIds`; системні записи 1..n окремою подією не летять:
      // стрічки ніхто ще не тримає, тож досить сигналу про появу розмови
      await this.chatRealtime.conversationChanged(tx, conversation.id, 'created', memberIds);

      return conversation.id;
    });

    this.logger.log(`Conversation ${id} created by ${actor.sub}`);
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      select: CONVERSATION_SELECT,
    });
  }

  /** Стрічка: keyset по seq вниз. Найсвіжіша сторінка — без курсора */
  async transcript(
    actor: JwtPayload,
    conversationId: string,
    query: CursorQuery,
  ): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
    await this.access.assertAccess(conversationId, actor.sub);
    const before = decodeSeqCursor(query.cursor);

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(before !== null && { seq: { lt: before } }),
      },
      orderBy: { seq: 'desc' },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeSeqCursor(last.seq) : null };
  }

  /**
   * Надіслати репліку.
   *
   * Ідемпотентність (design.md D2): арбітр — частковий унікальний індекс, а не
   * перевірка в коді. Перед-читання лише робить звичайний повтор дешевим;
   * гонку двох однакових запитів ловить БД, і тоді ми просто перечитуємо рядок,
   * який записав переможець. Catch поза транзакцією свідомо: unique-порушення
   * обриває транзакцію Postgres, і «впіймати P2002 та зробити SELECT усередині»
   * не спрацювало б.
   */
  async post(
    actor: JwtPayload,
    conversationId: string,
    dto: PostChatMessage,
  ): Promise<ChatMessage> {
    const conversation = await this.access.assertAccess(conversationId, actor.sub);
    // Клієнтська розмова — відповідь провайдеру або нотатка колегам; правила інші (черга, вікно),
    // тож це окремий сервіс (CHAT-2b)
    if (conversation.kind === 'CUSTOMER') {
      return this.customer.post(actor, conversation, dto);
    }
    if (dto.visibility === 'INTERNAL') {
      throw fieldValidationException(
        'visibility',
        'Internal notes exist only in customer conversations',
      );
    }
    if (!conversation.membership) {
      throw new UnprocessableEntityException(
        'Only participants can post to an internal conversation',
      );
    }

    const replayed = await this.findByClientMessageId(conversationId, dto.clientMessageId);
    if (replayed) {
      return replayed;
    }

    // Хто дивиться на розмову ЗАРАЗ — до транзакції: запит до adapter-а це зовнішній виклик, а
    // рядок розмови далі буде заблоковано (design.md D2). Повтор і відмова доступу сюди не доходять
    const viewerIds = await this.realtime.userIdsInRoom(
      conversationRoom(this.tenantContext.requireTenantId(), conversation.id),
    );

    try {
      return await this.insert(
        conversation.id,
        conversation.membership.label,
        actor.sub,
        dto,
        viewerIds,
      );
    } catch (error) {
      if (!isClientMessageIdConflict(error)) {
        throw error;
      }
      // Паралельний запит із тим самим clientMessageId уже записав рядок —
      // повертаємо ЙОГО, а не 409: для клієнта це той самий успішний send
      const existing = await this.findByClientMessageId(conversationId, dto.clientMessageId);
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }

  /** Шаблон у клієнтську розмову (CHAT-3a): єдиний спосіб писати поза вікном */
  async postTemplate(
    actor: JwtPayload,
    conversationId: string,
    dto: PostTemplateMessage,
  ): Promise<ChatMessage> {
    const conversation = await this.access.assertAccess(conversationId, actor.sub);
    if (conversation.kind !== 'CUSTOMER') {
      throw new NotFoundException('Conversation not found');
    }
    return this.customer.postTemplate(actor, conversation, dto);
  }

  /** Повторити відправку невдалого вихідного повідомлення клієнтської розмови (CHAT-2b) */
  async resend(actor: JwtPayload, conversationId: string, messageId: string): Promise<ChatMessage> {
    const conversation = await this.access.assertAccess(conversationId, actor.sub);
    if (conversation.kind !== 'CUSTOMER') {
      throw new NotFoundException('Message not found');
    }
    return this.customer.resend(actor, conversation, messageId);
  }

  async setStatus(
    actor: JwtPayload,
    conversationId: string,
    dto: SetConversationStatus,
  ): Promise<void> {
    const conversation = await this.access.assertAccess(conversationId, actor.sub);
    await this.customer.setStatus(actor, conversation, dto);
  }

  async setAssignee(
    actor: JwtPayload,
    conversationId: string,
    dto: SetConversationAssignee,
  ): Promise<void> {
    const conversation = await this.access.assertAccess(conversationId, actor.sub);
    await this.customer.setAssignee(actor, conversation, dto);
  }

  /**
   * Рух курсора прочитаного. Тільки вперед: умова `lastReadSeq < seq` у WHERE
   * дає семантику GREATEST без сирого SQL, а застарілий запит стає no-op —
   * не помилкою (клієнт не має ловити гонку власних вкладок).
   */
  async markRead(userId: string, conversationId: string, seq: number): Promise<void> {
    await this.access.assertAccess(conversationId, userId);

    await this.transactions.withTenantTx(async (tx) => {
      // Перерахунок, а не `unreadCount = 0`: курсор можуть посунути НЕ на кінець
      // (прочитано до середини), і обнулення тоді з'їло б реальні непрочитані.
      // Системні записи не рахуються — вони не піднімають бейдж (design.md D5)
      const unreadCount = await tx.chatMessage.count({
        where: {
          conversationId,
          seq: { gt: seq },
          kind: 'TEXT',
          deletedAt: null,
          senderUserId: { not: userId },
        },
      });

      const { count } = await tx.conversationParticipant.updateMany({
        where: { conversationId, userId, leftAt: null, lastReadSeq: { lt: seq } },
        data: { lastReadSeq: seq, lastReadAt: new Date(), unreadCount },
      });

      // Курсор справді зрушився — кажемо його власнику, в УСІ його вкладки. Застарілий чи
      // повторний запит (`count = 0`) мовчить: інакше дві вкладки, що читають одне й те саме,
      // гойдали б одна одну подіями (design.md D2). Чужі позиції прочитаного нікому не шлемо
      // CHAT-3b3: вхідні клієнта до цього місця «забираємо» для провайдера й ставимо одну роботу «прочитано».
      // Умовне UPDATE … IS NULL — дедуп: повторний рух курсора чи другий агент нічого не забере. Лише
      // клієнтські розмови (JOIN), вхідні з id провайдера й не старші за 30 днів (старіше Meta відхилить)
      const claimed = await tx.$queryRaw<{ id: string; seq: number }[]>`
        UPDATE chat_messages m SET provider_read_at = now()
        FROM conversations c
        WHERE c.id = ${conversationId} AND m.conversation_id = c.id AND c.kind = 'CUSTOMER'
          AND m.direction = 'INBOUND' AND m.seq <= ${seq}::int AND m.provider_read_at IS NULL
          AND m.external_id IS NOT NULL AND m.deleted_at IS NULL
          AND m.provider_sent_at > now() - interval '30 days'
        RETURNING m.id, m.seq`;
      const newest = claimed.reduce<{ id: string; seq: number } | null>(
        (best, row) => (best === null || row.seq > best.seq ? row : best),
        null,
      );
      if (newest) {
        await this.messages.publish(tx, channelsMarkReadCommand, {
          conversationId,
          messageId: newest.id,
        });
      }

      if (count > 0) {
        await this.chatRealtime.conversationChanged(tx, conversationId, 'read', [userId]);
        // Прочитав — сповіщення про цю розмову втратило сенс, у кожній вкладці (design.md D5)
        await this.notificationRecorder.markReadByTarget(tx, userId, {
          kind: 'conversation',
          id: conversationId,
        });
      }
    });
  }

  private async findByClientMessageId(
    conversationId: string,
    clientMessageId: string,
  ): Promise<ChatMessage | null> {
    return this.prisma.chatMessage.findFirst({ where: { conversationId, clientMessageId } });
  }

  private async insert(
    conversationId: string,
    senderLabel: string,
    senderUserId: string,
    dto: PostChatMessage,
    viewerIds: string[],
  ): Promise<ChatMessage> {
    return this.transactions.withTenantTx(async (tx) => {
      const now = new Date();

      // Інкремент-і-повернення (design.md D1): рядок розмови й так треба
      // оновити, а його блокування серіалізує вставки В МЕЖАХ цієї розмови і
      // лишає інші розмови повністю паралельними. Порядок, курсор і детектор
      // дірок — усе з цього одного числа, а не з created_at
      const { lastSeq } = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastSeq: { increment: 1 },
          lastMessageAt: now,
          lastMessagePreview: toPreview(dto.body),
        },
        select: { lastSeq: true },
      });

      const message = await tx.chatMessage.create({
        data: {
          conversationId,
          seq: lastSeq,
          kind: 'TEXT',
          visibility: 'PUBLIC',
          status: 'SENT',
          senderType: 'user',
          senderUserId,
          senderLabel,
          body: dto.body,
          clientMessageId: dto.clientMessageId,
        },
      });

      // Один UPDATE на всіх, крім автора: учасників одиниці, а бейдж має
      // читатися зі списку без COUNT (docs/chat.md §4.3)
      await tx.conversationParticipant.updateMany({
        where: { conversationId, userId: { not: senderUserId }, leftAt: null },
        data: { unreadCount: { increment: 1 } },
      });

      // Живе оновлення: усім активним учасникам, автора включно (його інші вкладки),
      // ПІСЛЯ коміту. Повтор з тим самим clientMessageId сюди не доходить — `post()`
      // повертає збережений рядок раніше, а гонку двох однакових відсікає унікальний
      // індекс, і транзакція програвшого відкочується разом із реєстрацією емісії
      await this.chatRealtime.messageCreated(tx, message);

      // Сповіщення не пишемо тут: це per-отримувач upsert під замком розмови, а збій у ньому відкотив
      // би САМУ репліку. Подія в тій самій транзакції — воркер (`chat-notify`) напише їх після коміту,
      // і відкочена репліка подію теж не залишає (design.md D1)
      await this.messages.publish(
        tx,
        chatMessagePostedEvent,
        { conversationId, messageId: message.id, viewerIds },
        { actor: { type: 'user', id: senderUserId, label: senderLabel } },
      );

      return message;
    });
  }
}

function labelOf(user: { name: string | null; email: string }): string {
  return user.name ?? user.email;
}

/**
 * 400 із прив'язкою до поля. Саме 400, а не `fieldConflictException` (409):
 * «такого юзера немає» — це невалідний ВХІД, а не зіткнення з наявним рядком.
 * `AllExceptionsFilter` пробросить `fieldErrors` у конверт, і форма підсвітить поле.
 */
function fieldValidationException(field: string, message: string): BadRequestException {
  return new BadRequestException({
    message,
    fieldErrors: [{ field, message, code: 'invalid_value' }],
  });
}
