import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { AiConversation, AiMessage, Prisma } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  AiCancelChannel,
  MessagePublisher,
  generateAiReplyCommand,
  type AiConfig,
} from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

/** Скільки останніх повідомлень віддавати панелі за один раз */
const TRANSCRIPT_LIMIT = 100;

/**
 * Розмова з асистентом. Дві межі, і вони РІЗНІ:
 *
 * - межу ТЕНАНТА тримає RLS (міграція `ai_assistant_conversations`);
 * - межу ЛЮДИНИ тримає цей сервіс — кожен запит фільтрується по `userId` з
 *   токена. Те саме рішення, що для приватних каналів чату і приватних подій
 *   календаря: «RLS — межа тенанта, а не учасника», тож ADMIN тут прав не має.
 *
 * Чужа (або неіснуюча) розмова дає 404, а не 403: 403 підтвердив би, що вона є.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly publisher: MessagePublisher,
    private readonly cancelChannel: AiCancelChannel,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  /** Гейт інсталяції. Дефолт — вимкнено, тому це перше, що робить кожен роут */
  assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ForbiddenException('AI assistant is disabled for this installation');
    }
  }

  /**
   * Активна розмова зі стрічкою; створюється на вимогу при першому зверненні.
   * Гонку двох вкладок вирішує не перевірка тут, а частковий унікальний індекс
   * у БД: той, хто програв, ловить P2002 і просто перечитує наявну.
   */
  async currentConversation(
    actor: JwtPayload,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const existing = await this.findActive(actor.sub);
    const conversation = existing ?? (await this.createActive(actor.sub));
    return { conversation, messages: await this.transcript(conversation.id) };
  }

  /**
   * Питання. Усе — питання, порожня відповідь і публікація команди — в ОДНІЙ
   * транзакції: або факт і його робота зафіксувались разом, або не сталося нічого.
   */
  async ask(
    actor: JwtPayload,
    text: string,
  ): Promise<{ conversation: AiConversation; question: AiMessage; reply: AiMessage }> {
    return this.transactions.withTenantTx(async (tx) => {
      const conversation =
        (await this.findActive(actor.sub, tx)) ?? (await this.createActive(actor.sub, tx));

      const last = await tx.aiMessage.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { seq: 'desc' },
        select: { seq: true, role: true, status: true },
      });

      // «Зайнята» — це стан ОСТАННЬОЇ відповіді, а не окремий прапорець:
      // менше станів, які можуть розійтися між собою
      if (last?.role === 'ASSISTANT' && (last.status === 'PENDING' || last.status === 'STREAMING')) {
        throw new ConflictException('A reply is still being generated in this conversation');
      }

      const nextSeq = (last?.seq ?? -1) + 1;
      const question = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          seq: nextSeq,
          role: 'USER',
          status: 'COMPLETE',
          content: text,
          completedAt: new Date(),
        },
      });
      const reply = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          seq: nextSeq + 1,
          role: 'ASSISTANT',
          status: 'PENDING',
          content: '',
        },
      });
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // `group` — це справедливість між тенантами: pg-boss не дасть одному
      // тенанту зайняти більше воркерів, ніж `groupConcurrency` у маніфесті.
      // `actor` передається явно, як і в решті продюсерів: CLS-контекст ланцюга
      // на HTTP-вході порожній, і без цього конверт поїхав би від системи
      await this.publisher.publish(
        tx,
        generateAiReplyCommand,
        { conversationId: conversation.id, messageId: reply.id },
        {
          actor: { type: 'user', id: actor.sub, label: actor.email },
          group: { id: actor.tenantId },
        },
      );

      return { conversation, question, reply };
    });
  }

  /**
   * «Нова розмова»: стара стає RETIRED і лишається в БД — скидається КОНТЕКСТ,
   * а не історія. Обидві дії в одній транзакції, бо частковий унікальний індекс
   * не дозволить двом ACTIVE співіснувати навіть на мить.
   */
  async reset(
    actor: JwtPayload,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const conversation = await this.transactions.withTenantTx(async (tx) => {
      await tx.aiConversation.updateMany({
        where: { userId: actor.sub, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      return this.createActive(actor.sub, tx);
    });
    return { conversation, messages: [] };
  }

  /**
   * Зупинити генерацію. Успіх і тоді, коли відповідь уже завершилась: скасувати
   * завершене — за специфікацією no-op, а не помилка.
   */
  async cancel(actor: JwtPayload, messageId: string): Promise<void> {
    const message = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } },
    });
    // Чужа або неіснуюча — однаково 404: існування чужої розмови не розкривається
    if (message?.conversation.userId !== actor.sub) {
      throw new NotFoundException('Message not found');
    }
    if (message.status !== 'PENDING' && message.status !== 'STREAMING') {
      return;
    }
    await this.cancelChannel.requestCancel(messageId);
  }

  private async findActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation | null> {
    const client = tx ?? this.prisma;
    return client.aiConversation.findFirst({ where: { userId, status: 'ACTIVE' } });
  }

  private async createActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation> {
    const client = tx ?? this.prisma;
    try {
      return await client.aiConversation.create({ data: { userId, status: 'ACTIVE' } });
    } catch (error) {
      // P2002 на частковому унікальному індексі = інша вкладка встигла першою
      if (isUniqueViolation(error)) {
        const existing = await this.findActive(userId, tx);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async transcript(conversationId: string): Promise<AiMessage[]> {
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: TRANSCRIPT_LIMIT,
    });
    return messages.reverse();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
