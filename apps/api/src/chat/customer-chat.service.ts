import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { ChatMessage, Prisma } from '@saas-skeleton/database';
import type {
  PostChatMessage,
  PostTemplateMessage,
  SetConversationAssignee,
  SetConversationStatus,
} from '@saas-skeleton/contracts';
import {
  ChannelAdapterRegistry,
  type ChannelAdapter,
  ConversationWorkflow,
  MessagePublisher,
  channelsDeliverOutboundCommand,
  isFreeformAllowed,
  toPreview,
  type WorkflowActor,
} from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ChatRealtime } from './chat-realtime';
import { isClientMessageIdConflict } from './idempotency';
import type { ConversationWithMembership } from './conversation-access.service';

interface CustomerConversationRow {
  id: string;
  status: 'OPEN' | 'PENDING' | 'SNOOZED' | 'RESOLVED';
  channelId: string | null;
  customerLastMessageAt: Date | null;
  channel: { provider: string; isEnabled: boolean; providerMissingAt: Date | null } | null;
}

/** Що кладемо в `chat_messages` для відповіді клієнтові: текст або шаблон (`payload.template`) */
interface ReplyInput {
  body: string;
  clientMessageId: string;
  payload?: Prisma.InputJsonObject;
}

/**
 * Усе, що агент робить із КЛІЄНТСЬКОЮ розмовою (CHAT-2b): відповідь, нотатка, повторна відправка,
 * статус, призначення. Відділено від `ChatService` (внутрішні розмови), бо правила інші: чергa
 * доставки, вікно, учасник = відповідальний. Доступ — та сама єдина функція (`assertAccess`), її
 * результат приходить від викликача.
 *
 * Кожен метод — ОДНА транзакція `withTenantTx`; зміни робочого процесу пишуться в ній же разом із
 * системним записом і активністю (`ConversationWorkflow`), а сигнал браузеру реєструється
 * after-commit. Виклику провайдера тут немає взагалі: це робота воркера.
 */
@Injectable()
export class CustomerChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly workflow: ConversationWorkflow,
    private readonly messages: MessagePublisher,
    private readonly registry: ChannelAdapterRegistry,
    private readonly chatRealtime: ChatRealtime,
  ) {}

  /** Відповідь клієнтові (`PUBLIC`) або нотатка для колег (`INTERNAL`) */
  async post(
    actor: JwtPayload,
    conversation: ConversationWithMembership,
    dto: PostChatMessage,
  ): Promise<ChatMessage> {
    const isNote = dto.visibility === 'INTERNAL';

    // Повтор ідемпотентності раніше за все: повторна відправка вже прийнятого не має впасти на
    // вікні, що тим часом закрилось
    const replayed = await this.prisma.chatMessage.findFirst({
      where: { conversationId: conversation.id, clientMessageId: dto.clientMessageId },
    });
    if (replayed) {
      return replayed;
    }

    const row = await this.loadConversation(conversation.id);
    if (!isNote) {
      this.assertCanReply(row, dto.body);
    }
    const label = await this.actorLabel(actor);

    try {
      return await this.transactions.withTenantTx(async (tx) =>
        isNote
          ? this.insertNote(tx, row, actor, label, dto)
          : this.insertReply(tx, row, actor, label, dto),
      );
    } catch (error) {
      if (!isClientMessageIdConflict(error)) {
        throw error;
      }
      // Паралельний запит із тим самим clientMessageId уже записав рядок: для клієнта це той самий
      // успішний send. Програвша транзакція відкотилась разом зі своїм `publish`
      const existing = await this.prisma.chatMessage.findFirst({
        where: { conversationId: conversation.id, clientMessageId: dto.clientMessageId },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  /**
   * Схвалений шаблон за іменем і мовою (CHAT-3a, design.md D7): звичайна відповідь у черзі, але без
   * перевірки вікна. У `payload.template` — що слати, у `body` — імʼя (для прев'ю й пошуку).
   */
  async postTemplate(
    actor: JwtPayload,
    conversation: ConversationWithMembership,
    dto: PostTemplateMessage,
  ): Promise<ChatMessage> {
    const replayed = await this.prisma.chatMessage.findFirst({
      where: { conversationId: conversation.id, clientMessageId: dto.clientMessageId },
    });
    if (replayed) {
      return replayed;
    }
    const row = await this.loadConversation(conversation.id);
    this.assertCanSendTemplate(row);
    const label = await this.actorLabel(actor);
    const input: ReplyInput = {
      body: dto.name,
      clientMessageId: dto.clientMessageId,
      payload: { template: { name: dto.name, language: dto.language } },
    };

    try {
      return await this.transactions.withTenantTx((tx) =>
        this.insertReply(tx, row, actor, label, input),
      );
    } catch (error) {
      if (!isClientMessageIdConflict(error)) {
        throw error;
      }
      const existing = await this.prisma.chatMessage.findFirst({
        where: { conversationId: conversation.id, clientMessageId: dto.clientMessageId },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  /** Повторити відправку невдалого вихідного: те саме повідомлення знову в `QUEUED` */
  async resend(
    actor: JwtPayload,
    conversation: ConversationWithMembership,
    messageId: string,
  ): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        visibility: 'PUBLIC',
      },
      select: { id: true, body: true, payload: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    const row = await this.loadConversation(conversation.id);
    if ((message.payload as { template?: unknown } | null)?.template) {
      this.assertCanSendTemplate(row);
    } else {
      this.assertCanReply(row, message.body ?? '');
    }

    return this.transactions.withTenantTx(async (tx) => {
      // Умовний UPDATE — арбітр: два одночасні «повторити» ставлять у чергу одну доставку
      const requeued = await tx.$executeRaw`
        UPDATE chat_messages
        SET status = 'QUEUED', failure = NULL, attempts = 0, sending_started_at = NULL
        WHERE id = ${messageId} AND status = 'FAILED' AND direction = 'OUTBOUND'`;
      if (requeued === 0) {
        throw new ConflictException('Only a failed message can be resent');
      }
      await this.publishDelivery(tx, conversation.id, messageId, actor);
      this.chatRealtime.messageUpdated(tx, conversation.id, messageId);
      return tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
    });
  }

  async setStatus(
    actor: JwtPayload,
    conversation: ConversationWithMembership,
    dto: SetConversationStatus,
  ): Promise<void> {
    this.assertCustomerConversation(conversation);
    const label = await this.actorLabel(actor);
    await this.transactions.withTenantTx(async (tx) => {
      const result = await this.workflow.setStatus(
        tx,
        conversation.id,
        dto.status,
        userActor(actor, label),
      );
      if (result === 'blocked') {
        throw new ConflictException('The contact already has another open conversation');
      }
      if (result === 'changed') {
        this.chatRealtime.inboxChanged(tx, conversation.id);
      }
    });
  }

  async setAssignee(
    actor: JwtPayload,
    conversation: ConversationWithMembership,
    dto: SetConversationAssignee,
  ): Promise<void> {
    this.assertCustomerConversation(conversation);

    let assignee: { id: string; label: string } | null = null;
    if (dto.userId !== null) {
      // RLS показує лише користувачів цього тенанта: чужий id відповідає так само, як неіснуючий
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, name: true, email: true, isActive: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (!user.isActive) {
        throw new BadRequestException({
          message: 'The user is deactivated',
          fieldErrors: [
            { field: 'userId', message: 'The user is deactivated', code: 'invalid_value' },
          ],
        });
      }
      assignee = { id: user.id, label: user.name ?? user.email };
    }

    const label = await this.actorLabel(actor);
    await this.transactions.withTenantTx(async (tx) => {
      const changed = await this.workflow.assign(
        tx,
        conversation.id,
        assignee,
        userActor(actor, label),
      );
      if (changed) {
        this.chatRealtime.inboxChanged(tx, conversation.id);
      }
    });
  }

  // -------------------------------------------------------------------------

  private async insertReply(
    tx: Prisma.TransactionClient,
    row: CustomerConversationRow,
    actor: JwtPayload,
    label: string,
    dto: ReplyInput,
  ): Promise<ChatMessage> {
    const author = userActor(actor, label);

    // Спершу зміни процесу (вони теж беруть `seq` системними записами): відповідь лягає ПІСЛЯ
    // «призначено»/«відкрито», як це й сталось по часу
    await this.workflow.claimIfUnassigned(tx, row.id, { id: actor.sub, label });
    if (row.status === 'RESOLVED') {
      const result = await this.workflow.setStatus(tx, row.id, 'OPEN', author);
      if (result === 'blocked') {
        throw new ConflictException('The contact already has another open conversation');
      }
    }

    const { lastSeq } = await tx.conversation.update({
      where: { id: row.id },
      data: {
        lastSeq: { increment: 1 },
        lastMessageAt: new Date(),
        lastMessagePreview: toPreview(dto.body),
      },
      select: { lastSeq: true },
    });
    const message = await tx.chatMessage.create({
      data: {
        conversationId: row.id,
        seq: lastSeq,
        kind: 'TEXT',
        visibility: 'PUBLIC',
        status: 'QUEUED',
        senderType: 'user',
        senderUserId: actor.sub,
        senderLabel: label,
        body: dto.body,
        ...(dto.payload && { payload: dto.payload }),
        clientMessageId: dto.clientMessageId,
        direction: 'OUTBOUND',
        channelId: row.channelId,
      },
    });

    await this.publishDelivery(tx, row.id, message.id, actor);
    this.chatRealtime.inboxChanged(tx, row.id);
    return message;
  }

  /** Нотатка: лише для колег — без вікна, без черги, не чіпає порядок скриньки (design.md D12) */
  private async insertNote(
    tx: Prisma.TransactionClient,
    row: CustomerConversationRow,
    actor: JwtPayload,
    label: string,
    dto: PostChatMessage,
  ): Promise<ChatMessage> {
    const { lastSeq } = await tx.conversation.update({
      where: { id: row.id },
      data: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    });
    const message = await tx.chatMessage.create({
      data: {
        conversationId: row.id,
        seq: lastSeq,
        kind: 'TEXT',
        visibility: 'INTERNAL',
        status: 'SENT',
        senderType: 'user',
        senderUserId: actor.sub,
        senderLabel: label,
        body: dto.body,
        clientMessageId: dto.clientMessageId,
      },
    });
    this.chatRealtime.inboxChanged(tx, row.id);
    return message;
  }

  private async publishDelivery(
    tx: Prisma.TransactionClient,
    conversationId: string,
    messageId: string,
    actor: JwtPayload,
  ): Promise<void> {
    // Суворий FIFO по розмові: ключ обов'язковий (топологія), порядок — як агент писав
    await this.messages.publish(
      tx,
      channelsDeliverOutboundCommand,
      { messageId },
      { singletonKey: conversationId, actor: { type: 'user', id: actor.sub, label: actor.email } },
    );
  }

  private async loadConversation(id: string): Promise<CustomerConversationRow> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        channelId: true,
        customerLastMessageAt: true,
        channel: { select: { provider: true, isEnabled: true, providerMissingAt: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Conversation not found');
    }
    return row;
  }

  /** Канал існує, увімкнений, не зник у провайдера й має адаптер; повертає адаптер */
  private usableAdapter(row: CustomerConversationRow): ChannelAdapter {
    const adapter = row.channel ? this.registry.get(row.channel.provider) : undefined;
    if (!row.channel || !row.channelId || !adapter) {
      throw new UnprocessableEntityException('The conversation has no usable channel');
    }
    if (!row.channel.isEnabled || row.channel.providerMissingAt !== null) {
      throw new ConflictException('The channel is disabled');
    }
    return adapter;
  }

  /** Швидка відмова до запису: канал увімкнений, довжина в межах, вікно відкрите (D3) */
  private assertCanReply(row: CustomerConversationRow, body: string): void {
    const adapter = this.usableAdapter(row);
    if (body.length > adapter.capabilities.maxTextLength) {
      throw new BadRequestException({
        message: 'The message is too long for this channel',
        fieldErrors: [
          { field: 'body', message: 'The message is too long for this channel', code: 'too_big' },
        ],
      });
    }
    if (!isFreeformAllowed(adapter, row.customerLastMessageAt, new Date())) {
      throw new UnprocessableEntityException({
        code: 'CHANNEL_WINDOW_CLOSED',
        message: 'The freeform reply window of this channel is closed',
      });
    }
  }

  /** Шаблон — єдиний спосіб писати поза вікном: вікно не перевіряється, але адаптер має вміти шаблони */
  private assertCanSendTemplate(row: CustomerConversationRow): void {
    const adapter = this.usableAdapter(row);
    if (!adapter.capabilities.templates) {
      throw new UnprocessableEntityException('This channel cannot send templates');
    }
  }

  private assertCustomerConversation(conversation: ConversationWithMembership): void {
    if (conversation.kind !== 'CUSTOMER') {
      throw new BadRequestException('Only customer conversations have a workflow');
    }
  }

  private async actorLabel(actor: JwtPayload): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { name: true, email: true },
    });
    return user?.name ?? user?.email ?? actor.email;
  }
}

function userActor(actor: JwtPayload, label: string): WorkflowActor {
  return { type: 'user', id: actor.sub, label };
}
