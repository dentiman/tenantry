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
  AiMessageStateService,
  MessagePublisher,
  generateAiReplyCommand,
  type AiConfig,
} from '@saas-skeleton/shared';
import type { AiConversationChanged } from '@saas-skeleton/contracts';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { RealtimeEmitter } from '../realtime/realtime.emitter';

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
    private readonly state: AiMessageStateService,
    private readonly realtime: RealtimeEmitter,
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
   * у БД: той, хто програв, читає рядок переможця через `createMany`+`findActive`
   * (design.md D5) — без ловлі винятку в перерваній транзакції.
   *
   * Перед читанням стрічки закриваються ПОКИНУТІ відповіді (design.md D3): інакше
   * реплика, чию генерацію ніхто не довів до кінця, показувала б «у роботі» вічно.
   */
  async currentConversation(
    actor: JwtPayload,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const existing = await this.findActive(actor.sub);
    const conversation = existing ?? (await this.createActive(actor.sub));

    await this.transactions.withTenantTx(async (tx) => {
      const closed = await this.state.closeAbandoned(tx, conversation.id);
      if (closed > 0) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(conversation.tenantId, actor.sub, conversation.id, 'reply-closed');
        });
      }
    });

    return { conversation, messages: await this.transcript(conversation.id) };
  }

  /**
   * Питання. Усе — питання, порожня відповідь і публікація команди — в ОДНІЙ
   * транзакції: або факт і його робота зафіксувались разом, або не сталося нічого.
   *
   * Порядок кроків навмисний (design.md D3, D5):
   *  1. UPDATE розмови (бере її рядковий лок — конкурентні `ask()` серіалізуються);
   *  2. закрити покинуті відповіді — мертва відповідь не має тримати «зайнято» вічно;
   *  3. лише ТЕПЕР перевірити «зайнято» і створити нове питання/відповідь.
   */
  async ask(
    actor: JwtPayload,
    text: string,
  ): Promise<{ conversation: AiConversation; question: AiMessage; reply: AiMessage }> {
    return this.transactions.withTenantTx(async (tx) => {
      const conversation =
        (await this.findActive(actor.sub, tx)) ?? (await this.createActive(actor.sub, tx));

      // Крок 1: лок рядка розмови ПЕРШИМ — це і є арбітр гонки двох конкурентних
      // ask() в тій самій розмові (замість перегонів до унікального індексу `seq`)
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // Крок 2: покинута відповідь — не привід тримати розмову зайнятою
      const closed = await this.state.closeAbandoned(tx, conversation.id);

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
          // Оренда з моменту створення (design.md D3): якщо жодна доставка job-у
          // так і не захопить рядок, він закриється сам на наступному читанні,
          // а не триматиме розмову «зайнятою» вічно
          leaseExpiresAt: new Date(Date.now() + this.config.pendingTimeoutMs),
        },
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

      if (closed > 0) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(conversation.tenantId, actor.sub, conversation.id, 'reply-closed');
        });
      }
      // Інші вкладки того самого юзера не бачать нового рядка інакше (design.md D7,
      // фікс §6.3): дельта прийде лише туди, де відповідь уже в кеші, а перше
      // питання ходу дельти не має взагалі
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(conversation.tenantId, actor.sub, conversation.id, 'turn-created');
      });

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
      const created = await this.createActive(actor.sub, tx);
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(created.tenantId, actor.sub, created.id, 'reset');
      });
      return created;
    });
    return { conversation, messages: [] };
  }

  /**
   * Зупинити генерацію. Успіх і тоді, коли відповідь уже завершилась: скасувати
   * завершене — за специфікацією no-op, а не помилка.
   *
   * Stop — ФАКТ У БД РАНІШЕ за pub/sub-сигнал (design.md D4): для `PENDING` це
   * фінальне й миттєве `CANCELLED` (claim() у воркері такий рядок більше не
   * знайде), для `STREAMING` — маркер `cancelRequestedAt`, і сигнал швидкого
   * шляху публікується лише тоді, коли маркер дійсно поставлено на живому рядку.
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

    const cancelledPending = await this.transactions.withTenantTx(async (tx) => {
      const cancelled = await this.state.cancelPending(tx, messageId);
      if (cancelled) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(
            message.tenantId,
            actor.sub,
            message.conversationId,
            'reply-closed',
          );
        });
      }
      return cancelled;
    });
    if (cancelledPending) {
      return;
    }

    // Рядок уже STREAMING (не PENDING, інакше крок вище б спрацював): записуємо
    // маркер і лише за успіху публікуємо швидкий сигнал — на термінальному рядку
    // (worker встиг фіналізувати між нашими двома читаннями) публікувати нічого
    const marked = await this.transactions.withTenantTx((tx) => this.state.requestCancel(tx, messageId));
    if (marked) {
      await this.cancelChannel.requestCancel(messageId);
    }
  }

  /**
   * «Видалити мої розмови» (ai-1e, docs/ai-assistant.md §9.2): негайний, жорсткий DELETE
   * усіх розмов юзера, без черги. Межа тенанта — RLS (tenantTx), межа людини — явний
   * `userId`, як і скрізь у цьому сервісі (клас-коментар); `AiMessage` каскадиться разом
   * з розмовою. Нову активну розмову тут НЕ створюємо — наступний `ask()`/читання
   * лінькво заведе її так само, як для юзера, що ще ніколи не питав (design.md D5)
   */
  async deleteAllConversations(actor: JwtPayload): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await tx.aiConversation.deleteMany({ where: { userId: actor.sub } });
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(actor.tenantId, actor.sub, null, 'deleted');
      });
    });
  }

  private async findActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation | null> {
    const client = tx ?? this.prisma;
    return client.aiConversation.findFirst({ where: { userId, status: 'ACTIVE' } });
  }

  /**
   * `createMany` + `skipDuplicates` — Postgres `INSERT ... ON CONFLICT DO NOTHING`
   * (design.md D5). На відміну від `create()` + catch(P2002), тут НІЧОГО не кидає,
   * тож транзакція не переривається: unique violation у Postgres обриває саму
   * транзакцію, і читання одразу після неї без rollback/savepoint не відновило б
   * її (docs/ai-assistant-review-gaps.md п.4).
   */
  private async createActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation> {
    const client = tx ?? this.prisma;
    await client.aiConversation.createMany({
      data: [{ userId, status: 'ACTIVE' }],
      skipDuplicates: true,
    });
    const conversation = await this.findActive(userId, tx);
    if (!conversation) {
      // Неможливо за конструкцією: або ми, або конкурент щойно вставили ACTIVE-рядок
      throw new Error(`AiService.createActive: no active conversation for user ${userId} after insert`);
    }
    return conversation;
  }

  private async transcript(conversationId: string): Promise<AiMessage[]> {
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: TRANSCRIPT_LIMIT,
    });
    return messages.reverse();
  }

  private emitConversationChanged(
    tenantId: string,
    userId: string,
    conversationId: string | null,
    reason: AiConversationChanged['reason'],
  ): void {
    this.realtime.aiConversationChanged(tenantId, userId, {
      conversationId,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }
}
